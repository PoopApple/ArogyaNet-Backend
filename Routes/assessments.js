const express = require('express');
const router = express.Router();
const Joi = require('joi');

const LiverAssessment = require('../Models/LiverAssessment');
const { authenticateAccessToken } = require('../Middlewares/auth');

// Validation schema
const measurementsSchema = Joi.object({
  Age: Joi.number().min(0).required(),
  TB: Joi.number().min(0).required(),
  DB: Joi.number().min(0).required(),
  ALKP: Joi.number().min(0).required(),
  SGPT: Joi.number().min(0).required(),
  SGOT: Joi.number().min(0).required(),
  TP: Joi.number().min(0).required(),
  ALB: Joi.number().min(0).required(),
  AGR: Joi.number().min(0).required(),
  Gender: Joi.number().valid(0,1).required(),
});

// Helper: format
function formatAssessment(doc, patient) {
  return {
    id: doc._id.toString(),
    patientId: doc.patientId?._id?.toString?.() || doc.patientId?.toString?.(),
    patientName: patient?.name,
    patientEmail: patient?.email,
    measurements: doc.measurements,
    result: doc.result || null,
    createdAt: doc.createdAt,
  };
}

// POST /api/assessments/liver
// Patients submit measurements. We call local ML server and store result.
router.post('/liver', authenticateAccessToken, async (req, res) => {
  try {
    const user = req.user; // from auth middleware
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    // Only patient can submit for themselves unless admin
    const isAdmin = user.role && user.role.toLowerCase() === 'admin';
    const isPatient = user.role && user.role.toLowerCase() === 'patient';
    if (!isPatient && !isAdmin) {
      return res.status(403).json({ message: 'Only patients can submit assessments' });
    }

    const { error, value } = measurementsSchema.validate(req.body);
    if (error) {
      return res.status(400).json({ message: 'Invalid input', details: error.details });
    }

    const patientId = isAdmin && req.body.patientId ? req.body.patientId : user.id;

    // Create record first (without result) so we always keep a trace
    let record = await LiverAssessment.create({ patientId, measurements: value });

    // Enforce latest 10 per patient: delete older ones beyond 10
    const count = await LiverAssessment.countDocuments({ patientId });
    if (count > 10) {
      const oldOnes = await LiverAssessment.find({ patientId })
        .sort({ createdAt: 1 })
        .limit(count - 10)
        .select('_id');
      const ids = oldOnes.map(d => d._id);
      if (ids.length) await LiverAssessment.deleteMany({ _id: { $in: ids } });
    }

    // Call ML server (transform keys to common ILPD naming the model likely expects)
    const mlUrl = process.env.ML_SERVER_URL || 'http://localhost:5000/predict';
    let mlResult = null;
    // Your ML server expects short keys exactly as below
    const payloadForML = {
      Age: value.Age,
      TB: value.TB,
      DB: value.DB,
      ALKP: value.ALKP,
      SGPT: value.SGPT,
      SGOT: value.SGOT,
      TP: value.TP,
      ALB: value.ALB,
      AGR: value.AGR,
      Gender: value.Gender, // 0=male,1=female per project mapping
    };
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const resp = await fetch(mlUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payloadForML),
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (resp.ok) {
        mlResult = await resp.json();
      } else {
        const text = await resp.text();
        console.error('ML server non-200:', resp.status, text);
      }
    } catch (mlErr) {
      // don't fail submission if ML server down; keep record without result
      console.error('ML server call failed:', mlErr.message || mlErr);
    }

    if (mlResult) {
      console.log(mlResult)
      // Normalize result fields
      let probability = mlResult.probability || mlResult.probabilities || null;
      if (probability && typeof probability === 'object') {
        // Map numeric keys to named keys if needed
        if (Object.prototype.hasOwnProperty.call(probability, '0') || Object.prototype.hasOwnProperty.call(probability, '1')) {
          probability = {
            no_disease: probability['0'] ?? probability.no_disease,
            disease: probability['1'] ?? probability.disease,
          };
        }
      }

      let prediction = mlResult.prediction;
      let prediction_label = mlResult.prediction_label || mlResult.label;
      if (!prediction_label && typeof prediction === 'number') {
        prediction_label = prediction === 1 ? 'disease' : 'no_disease';
      }

      let confidence = mlResult.confidence;
      if (confidence == null && probability && typeof probability === 'object') {
        const vals = [probability.no_disease, probability.disease].filter((v) => typeof v === 'number');
        if (vals.length) confidence = Math.max(...vals);
      }

      record.result = {
        prediction,
        prediction_label,
        probability: probability || undefined,
        confidence,
        input_data: new Map(Object.entries(value)),
        raw: mlResult,
      };
      await record.save();
    }

    return res.status(201).json({
      message: 'Assessment submitted',
      assessment: formatAssessment(record),
    });
  } catch (err) {
    console.error('POST /assessments/liver error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

// GET /api/assessments/liver
// Patients: get own 10 latest
// Doctors/Admin: get assessments for their patients (current simple: all patients) with patient info
router.get('/liver', authenticateAccessToken, async (req, res) => {
  try {
    const user = req.user;
    if (!user) return res.status(401).json({ message: 'Unauthorized' });

    const role = (user.role || '').toLowerCase();

    if (role === 'patient') {
      const records = await LiverAssessment.find({ patientId: user.id })
        .sort({ createdAt: -1 })
        .limit(10);
      // Patients shouldn't see the model result per requirements
      const safe = records.map(r => ({
        id: r._id.toString(),
        patientId: user.id,
        measurements: r.measurements,
        result: null,
        createdAt: r.createdAt,
      }));
      return res.json({ assessments: safe });
    }

    if (role === 'admin') {
      const records = await LiverAssessment.find({})
        .sort({ createdAt: -1 })
        .limit(1000)
        .populate('patientId', 'name email');
      const formatted = records.map(r => formatAssessment(r, r.patientId));
      return res.json({ assessments: formatted });
    }

    if (role === 'doctor') {
      // Limit to patients who have appointments with this doctor (excluding cancelled)
      const Appointment = require('../Models/Appointment');
      const appts = await Appointment.find({ doctorId: user.id, status: { $ne: 'cancelled' } }).select('patientId');
      const patientIds = [...new Set(appts.map(a => a.patientId?.toString()))].filter(Boolean);
      if (patientIds.length === 0) return res.json({ assessments: [] });

      const records = await LiverAssessment.find({ patientId: { $in: patientIds } })
        .sort({ createdAt: -1 })
        .limit(1000)
        .populate('patientId', 'name email');
      const formatted = records.map(r => formatAssessment(r, r.patientId));
      return res.json({ assessments: formatted });
    }

    return res.status(403).json({ message: 'Forbidden' });
  } catch (err) {
    console.error('GET /assessments/liver error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
});

module.exports = router;

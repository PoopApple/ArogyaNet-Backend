const Joi = require('joi');
const Prescription = require('../Models/Prescription');
const User = require('../Models/User');

const prescriptionSchema = Joi.object({
  patientId: Joi.string().required(),
  medication: Joi.string().trim().min(2).required(),
  dosage: Joi.string().trim().min(2).required(),
  instructions: Joi.string().allow('', null),
});

const formatPrescription = (doc) => ({
  id: doc._id,
  patient: doc.patientId
    ? {
        id: doc.patientId._id || doc.patientId,
        name: doc.patientId.name,
        email: doc.patientId.email,
      }
    : null,
  doctor: doc.doctorId
    ? {
        id: doc.doctorId._id || doc.doctorId,
        name: doc.doctorId.name,
        email: doc.doctorId.email,
      }
    : null,
  medication: doc.medication,
  dosage: doc.dosage,
  instructions: doc.instructions,
  createdAt: doc.createdAt,
});

const createPrescription = async (req, res) => {
  if (req.user.role !== 'doctor' && req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Only doctors or admins can create prescriptions' });
  }

  if (req.user.role === 'doctor') {
    const doctor = await User.findById(req.user.id);
    if (!doctor || !doctor.doctorApproved) {
      return res.status(403).json({ message: 'Doctor approval required' });
    }
  }

  const { error, value } = prescriptionSchema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });

  try {
    const prescription = await Prescription.create({
      patientId: value.patientId,
      doctorId: req.user.id,
      medication: value.medication,
      dosage: value.dosage,
      instructions: value.instructions,
    });

    await prescription.populate([
      { path: 'patientId', select: 'name email phone' },
      { path: 'doctorId', select: 'name email phone' },
    ]);

    return res.status(201).json(formatPrescription(prescription));
  } catch (err) {
    console.error('[prescriptionController] create error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const listPrescriptions = async (req, res) => {
  const query = {};
  if (req.user.role === 'patient') query.patientId = req.user.id;
  if (req.user.role === 'doctor') {
    const doctor = await User.findById(req.user.id);
    if (!doctor || !doctor.doctorApproved) {
      return res.status(403).json({ message: 'Doctor approval required' });
    }
    query.doctorId = req.user.id;
  }

  try {
    const prescriptions = await Prescription.find(query)
      .sort({ createdAt: -1 })
      .limit(200)
      .populate([
        { path: 'patientId', select: 'name email phone' },
        { path: 'doctorId', select: 'name email phone' },
      ]);

    return res.json(prescriptions.map(formatPrescription));
  } catch (err) {
    console.error('[prescriptionController] list error:', err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { createPrescription, listPrescriptions };


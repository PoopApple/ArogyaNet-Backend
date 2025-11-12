const Joi = require('joi');
const Appointment = require('../Models/Appointment');
const User = require('../Models/User');

const formatAppointment = (doc) => ({
  id: doc._id,
  startAt: doc.startAt,
  endAt: doc.endAt,
  status: doc.status,
  notes: doc.notes,
  patient: doc.patientId
    ? {
        id: doc.patientId._id || doc.patientId,
        name: doc.patientId.name,
        email: doc.patientId.email,
        phone: doc.patientId.phone,
      }
    : null,
  doctor: doc.doctorId
    ? {
        id: doc.doctorId._id || doc.doctorId,
        name: doc.doctorId.name,
        email: doc.doctorId.email,
        phone: doc.doctorId.phone,
      }
    : null,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt,
});

const createAppointment = async (req, res) => {
  const schema = Joi.object({
    doctorId: Joi.string().required(),
    startAt: Joi.date().required(),
    endAt: Joi.date().optional(),
    notes: Joi.string().optional(),
  });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });

  try {
    const doctor = await User.findById(value.doctorId);
    if (!doctor || doctor.role !== 'doctor') {
      return res.status(400).json({ message: 'Doctor not found' });
    }
    if (!doctor.doctorApproved) {
      return res.status(403).json({ message: 'Doctor is not approved' });
    }

    const appointment = await Appointment.create({ patientId: req.user.id, doctorId: value.doctorId, startAt: value.startAt, endAt: value.endAt, notes: value.notes });
    // emit socket notification if doctor online
    await appointment.populate([
      { path: 'patientId', select: 'name email phone' },
      { path: 'doctorId', select: 'name email phone' },
    ]);

    const io = req.app.get('io');
    io && io.emit('notification', { to: value.doctorId, message: 'New appointment requested' });
    return res.status(201).json(formatAppointment(appointment));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const listAppointments = async (req, res) => {
  try {
    const q = {};
    if (req.user.role === 'patient') q.patientId = req.user.id;
    else if (req.user.role === 'doctor') {
      const doctor = await User.findById(req.user.id);
      if (!doctor || !doctor.doctorApproved) {
        return res.status(403).json({ message: 'Doctor approval required' });
      }
      q.doctorId = req.user.id;
    }
    const appointments = await Appointment.find(q)
      .sort({ startAt: 1 })
      .limit(500)
      .populate([
        { path: 'patientId', select: 'name email phone' },
        { path: 'doctorId', select: 'name email phone' },
      ]);
    res.json(appointments.map(formatAppointment));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

const updateAppointment = async (req, res) => {
  const { id } = req.params;
  const schema = Joi.object({ startAt: Joi.date().optional(), endAt: Joi.date().optional(), status: Joi.string().valid('requested','confirmed','cancelled','completed').optional(), notes: Joi.string().optional() });
  const { error, value } = schema.validate(req.body);
  if (error) return res.status(400).json({ message: error.message });

  try {
    const appt = await Appointment.findById(id);
    if (!appt) return res.status(404).json({ message: 'Not found' });

    // Only doctor for that appointment or admin can update status/times
    if (req.user.role !== 'admin') {
      if (String(req.user.id) !== String(appt.doctorId)) {
        return res.status(403).json({ message: 'Forbidden' });
      }
      const doctor = await User.findById(req.user.id);
      if (!doctor || !doctor.doctorApproved) {
        return res.status(403).json({ message: 'Doctor approval required' });
      }
    }

    Object.assign(appt, value);
    await appt.save();

    await appt.populate([
      { path: 'patientId', select: 'name email phone' },
      { path: 'doctorId', select: 'name email phone' },
    ]);

    const io = req.app.get('io');
    io && io.emit('notification', { to: appt.patientId, message: 'Appointment updated' });

    res.json(formatAppointment(appt));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { createAppointment, listAppointments, updateAppointment };

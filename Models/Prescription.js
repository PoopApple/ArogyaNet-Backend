const mongoose = require('mongoose');

const PrescriptionSchema = new mongoose.Schema(
  {
    patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    medication: { type: String, required: true },
    dosage: { type: String, required: true },
    instructions: { type: String },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Prescription', PrescriptionSchema);


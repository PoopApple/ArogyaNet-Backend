const mongoose = require('mongoose');

const MeasurementsSchema = new mongoose.Schema({
  Age: { type: Number, required: true },
  TB: { type: Number, required: true },
  DB: { type: Number, required: true },
  ALKP: { type: Number, required: true },
  SGPT: { type: Number, required: true },
  SGOT: { type: Number, required: true },
  TP: { type: Number, required: true },
  ALB: { type: Number, required: true },
  AGR: { type: Number, required: true },
  Gender: { type: Number, required: true }, // 0 = male, 1 = female
}, { _id: false });

const ResultSchema = new mongoose.Schema({
  prediction: { type: Number },
  prediction_label: { type: String },
  probability: {
    no_disease: { type: Number },
    disease: { type: Number },
  },
  confidence: { type: Number },
  input_data: { type: Map, of: Number },
  raw: { type: mongoose.Schema.Types.Mixed },
}, { _id: false });

const LiverAssessmentSchema = new mongoose.Schema({
  patientId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  measurements: { type: MeasurementsSchema, required: true },
  result: { type: ResultSchema },
}, { timestamps: true });

module.exports = mongoose.model('LiverAssessment', LiverAssessmentSchema);

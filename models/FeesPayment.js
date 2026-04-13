const mongoose = require('mongoose');

const FeesPaymentSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student', required: true },
  fullName: { type: String, required: true },
  phone: { type: String, required: true },
  batchName: { type: String, required: true },
  centre: { type: String, required: true },
  amount: { type: Number, required: true },
  month: { type: String, required: true },
  year: { type: Number, required: true },
  paymentDate: { type: Date, default: Date.now },
  status: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending' },
  transactionId: { type: String, default: '' },
  paymentMethod: { type: String, default: 'upi' },
  screenshotUrl: { type: String, default: '' },
  verifiedBy: { type: String, default: '' },
  verifiedAt: { type: Date },
  remarks: { type: String, default: '' },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('FeesPayment', FeesPaymentSchema);

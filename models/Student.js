const mongoose = require('mongoose');
const bcrypt = require('bcrypt');

const StudentSchema = new mongoose.Schema({
  fullName: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  phone: { type: String, required: true },
  passwordHash: { type: String, required: true },
  dateOfBirth: { type: String, default: '' },
  beltLevel: { type: String, default: 'White' },
  centre: { type: String, default: '' },
  batch: { type: String, default: '' },
  address: { type: String, default: '' },
  emergencyContact: { type: String, default: '' },
  role: { type: String, default: 'student' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

StudentSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.passwordHash);
};

module.exports = mongoose.model('Student', StudentSchema);

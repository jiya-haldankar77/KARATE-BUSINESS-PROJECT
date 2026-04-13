const mongoose = require('mongoose');

const InstructorSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  beltLevel: { type: String, default: '' },
  photoUrl: { type: String, default: '' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Instructor', InstructorSchema);

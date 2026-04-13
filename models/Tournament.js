const mongoose = require('mongoose');

const TournamentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  date: { type: Date, required: true },
  venue: { type: String, default: '' },
  registrationDeadline: { type: Date },
  categories: [{ type: String }],
  entryFee: { type: Number, default: 0 },
  imageUrl: { type: String, default: '' },
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Tournament', TournamentSchema);

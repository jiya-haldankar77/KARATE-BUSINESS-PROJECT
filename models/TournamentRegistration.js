const mongoose = require('mongoose');

const TournamentRegistrationSchema = new mongoose.Schema(
  {
    tournament_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Tournament', required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, required: true, trim: true },
    centre: { type: String, required: true, trim: true },
    batch: { type: String, required: true, trim: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

TournamentRegistrationSchema.set('toJSON', {
  transform: function (_doc, ret) {
    ret.id = String(ret._id);
    // legacy field
    ret.tournament_id = String(ret.tournament_id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('TournamentRegistration', TournamentRegistrationSchema);

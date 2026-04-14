const mongoose = require('mongoose');

const AnnouncementSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    message: { type: String, required: true, trim: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

AnnouncementSchema.set('toJSON', {
  transform: function (_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Announcement', AnnouncementSchema);

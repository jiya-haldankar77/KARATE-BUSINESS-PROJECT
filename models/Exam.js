const mongoose = require('mongoose');

const ExamSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    location: { type: String, default: '' },
    description: { type: String, default: '' }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

ExamSchema.set('toJSON', {
  transform: function (_doc, ret) {
    ret.id = String(ret._id);
    if (ret.date instanceof Date) {
      ret.date = ret.date.toISOString().slice(0, 10);
    }
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Exam', ExamSchema);

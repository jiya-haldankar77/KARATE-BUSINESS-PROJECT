const mongoose = require('mongoose');

const AttendanceSchema = new mongoose.Schema(
  {
    student_id: { type: String, required: true, trim: true },
    student_name: { type: String, required: true, trim: true },
    batch: { type: String, required: true, trim: true },
    date: { type: Date, required: true },
    status: { type: String, default: 'Present', trim: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

AttendanceSchema.set('toJSON', {
  transform: function (_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Attendance', AttendanceSchema);

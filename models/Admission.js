const mongoose = require('mongoose');

const AdmissionSchema = new mongoose.Schema(
  {
    first_name: { type: String, required: true, trim: true },
    last_name: { type: String, required: true, trim: true },
    email: { type: String, default: '', trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },
    age: { type: Number },
    belt_level: { type: String, default: '' },
    address: { type: String, default: '' },
    centre: { type: String, default: '' },
    batch_timing: { type: String, default: '' },
    photo_url: { type: String, default: '' }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

AdmissionSchema.set('toJSON', {
  transform: function (_doc, ret) {
    ret.id = String(ret._id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('Admission', AdmissionSchema);

const mongoose = require('mongoose');

const StoreOrderSchema = new mongoose.Schema(
  {
    store_item_id: { type: mongoose.Schema.Types.ObjectId, ref: 'StoreItem', required: true },
    student_name: { type: String, required: true, trim: true },
    student_email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },
    centre: { type: String, default: '', trim: true },
    batch: { type: String, default: '', trim: true },
    quantity: { type: Number, required: true, min: 1 },
    status: { type: String, default: 'Pending', trim: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

StoreOrderSchema.set('toJSON', {
  transform: function (_doc, ret) {
    ret.id = String(ret._id);
    // legacy field
    ret.store_item_id = String(ret.store_item_id);
    delete ret._id;
    delete ret.__v;
    return ret;
  }
});

module.exports = mongoose.model('StoreOrder', StoreOrderSchema);

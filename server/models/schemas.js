const mongoose = require('mongoose');
const { Schema } = mongoose;

const userSchema = new Schema(
  {
    discord_id: { type: String, required: true, unique: true, index: true },
    username: { type: String, required: true },
    avatar: { type: String, default: null },
    role: {
      type: String,
      enum: ['admin', 'appraiser', 'clerk', 'user'],
      default: 'user'
    }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const businessSchema = new Schema(
  {
    name: { type: String, required: true },
    license_id: { type: String, required: true, unique: true },
    type: { type: String, required: true },
    ceo_name: { type: String, required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const propertySchema = new Schema(
  {
    parcel_id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    type: {
      type: String,
      enum: ['Residential', 'Commercial', 'Government', 'Vacant Land'],
      required: true
    },
    address: { type: String, required: true },
    geojson: { type: Schema.Types.Mixed, required: true },
    owner_type: { type: String, enum: ['Individual', 'Business'], required: true },
    owner_name: { type: String, required: true },
    business_id: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
    purchase_price: { type: Number, default: 0 },
    purchase_date: { type: Date, default: null },
    assessed_value: { type: Number, default: 0 },
    tax_rate: { type: Number, default: 0 },
    annual_tax: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['Owned', 'For Sale', 'Foreclosed', 'Government Seized'],
      default: 'Owned'
    },
    notes: { type: String, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const propertyTransactionSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true },
    from_owner: { type: String, required: true },
    to_owner: { type: String, required: true },
    sale_price: { type: Number, default: 0 },
    transfer_date: { type: Date, required: true },
    notes: { type: String, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const auditLogSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    action: { type: String, required: true },
    table_name: { type: String, required: true },
    record_id: { type: Schema.Types.Mixed, required: true },
    old_data: { type: Schema.Types.Mixed, default: null },
    new_data: { type: Schema.Types.Mixed, default: null }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

const loginLogSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ip_address: { type: String, required: true },
    user_agent: { type: String, required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

const mapConfigSchema = new Schema(
  {
    map_image_path: { type: String, required: true },
    bounds: { type: Schema.Types.Mixed, required: true },
    min_zoom: { type: Number, required: true },
    max_zoom: { type: Number, required: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

module.exports = {
  User: mongoose.models.User || mongoose.model('User', userSchema),
  Business: mongoose.models.Business || mongoose.model('Business', businessSchema),
  Property: mongoose.models.Property || mongoose.model('Property', propertySchema),
  PropertyTransaction:
    mongoose.models.PropertyTransaction || mongoose.model('PropertyTransaction', propertyTransactionSchema),
  AuditLog: mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema),
  LoginLog: mongoose.models.LoginLog || mongoose.model('LoginLog', loginLogSchema),
  MapConfig: mongoose.models.MapConfig || mongoose.model('MapConfig', mapConfigSchema)
};

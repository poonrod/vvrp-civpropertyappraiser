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
    square_footage: { type: Number, default: 0 },
    tax_zone: { type: String, default: null },
    tax_rate: { type: Number, default: 0 },
    annual_tax: { type: Number, default: 0 },
    status: {
      type: String,
      enum: ['Owned', 'For Sale', 'Foreclosed', 'Government Seized'],
      default: 'Owned'
    },
    notes: { type: String, default: null },
    residential_owners: {
      type: [
        {
          name: { type: String, required: true },
          owner_type: { type: String, enum: ['Individual', 'Business'], default: 'Individual' }
        }
      ],
      default: []
    },
    hide_details_public: { type: Boolean, default: false },
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

const taxPresetSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    residential_rate: { type: Number, required: true, default: 1.1 },
    commercial_rate: { type: Number, required: true, default: 1.25 },
    government_rate: { type: Number, default: 0 },
    vacant_land_rate: { type: Number, default: 0.5 }
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

const appSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const propertyRequestSchema = new Schema(
  {
    type: {
      type: String,
      enum: ['Residential', 'Commercial'],
      required: true
    },
    owner_name: { type: String, required: true },
    owner_type: { type: String, enum: ['Individual', 'Business'], default: 'Individual' },
    business_name: { type: String, default: null },
    address: { type: String, default: '' },
    postal: { type: String, default: '' },
    purchase_price: { type: Number, default: 0 },
    square_footage: { type: Number, default: 0 },
    residential_owners: {
      type: [
        {
          name: { type: String, required: true },
          owner_type: { type: String, enum: ['Individual', 'Business'], default: 'Individual' }
        }
      ],
      default: []
    },
    notes: { type: String, default: null },
    discord_name: { type: String, default: '' },
    status: {
      type: String,
      enum: ['pending', 'completed', 'cancelled'],
      default: 'pending'
    }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const loginLogSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ip_address: { type: String, required: true },
    user_agent: { type: String, required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

module.exports = {
  User: mongoose.models.User || mongoose.model('User', userSchema),
  Business: mongoose.models.Business || mongoose.model('Business', businessSchema),
  Property: mongoose.models.Property || mongoose.model('Property', propertySchema),
  PropertyTransaction:
    mongoose.models.PropertyTransaction || mongoose.model('PropertyTransaction', propertyTransactionSchema),
  TaxPreset: mongoose.models.TaxPreset || mongoose.model('TaxPreset', taxPresetSchema),
  AuditLog: mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema),
  LoginLog: mongoose.models.LoginLog || mongoose.model('LoginLog', loginLogSchema),
  AppSetting: mongoose.models.AppSetting || mongoose.model('AppSetting', appSettingSchema),
  PropertyRequest: mongoose.models.PropertyRequest || mongoose.model('PropertyRequest', propertyRequestSchema)
};

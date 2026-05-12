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
    license_id: { type: String },
    type: { type: String, default: null },
    ceo_name: { type: String, default: null }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);
businessSchema.index({ license_id: 1 }, { unique: true, partialFilterExpression: { license_id: { $type: 'string' } } });

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
      enum: ['Owned', 'For Sale', 'Foreclosed', 'Government Seized', 'Requires Survey'],
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

/* ── Module: law_liens ─────────────────────────────── */
const lienSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    lien_type: { type: String, enum: ['Tax Lien', 'Court Order', 'Asset Freeze', 'Mechanics Lien', 'Other'], required: true },
    description: { type: String, default: '' },
    amount: { type: Number, default: 0 },
    placed_by: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    resolved_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    resolved_at: { type: Date, default: null },
    status: { type: String, enum: ['Active', 'Resolved'], default: 'Active' }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: tax_ledger ────────────────────────────── */
const taxBillSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    period: { type: String, required: true },
    amount_due: { type: Number, required: true },
    amount_paid: { type: Number, default: 0 },
    due_date: { type: Date, required: true },
    paid_date: { type: Date, default: null },
    status: { type: String, enum: ['Unpaid', 'Partial', 'Paid', 'Overdue'], default: 'Unpaid' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);
taxBillSchema.index({ property_id: 1, period: 1 }, { unique: true });

/* ── Module: leases ────────────────────────────────── */
const leaseSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    tenant_name: { type: String, required: true },
    monthly_rent: { type: Number, default: 0 },
    start_date: { type: Date, required: true },
    end_date: { type: Date, default: null },
    status: { type: String, enum: ['Active', 'Expired', 'Terminated'], default: 'Active' },
    notes: { type: String, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: photos ────────────────────────────────── */
const propertyPhotoSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    filename: { type: String, required: true },
    original_name: { type: String, default: '' },
    mime_type: { type: String, default: 'image/jpeg' },
    size_bytes: { type: Number, default: 0 },
    caption: { type: String, default: '' },
    uploaded_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: staff_notes ───────────────────────────── */
const staffNoteSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true },
    mentions: [{ type: Schema.Types.ObjectId, ref: 'User' }]
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: mortgages ─────────────────────────────── */
const mortgageSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    lender_business_id: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
    lender_name: { type: String, required: true },
    principal: { type: Number, required: true },
    interest_rate: { type: Number, default: 0 },
    monthly_payment: { type: Number, default: 0 },
    remaining_balance: { type: Number, default: 0 },
    start_date: { type: Date, required: true },
    term_months: { type: Number, default: 360 },
    status: { type: String, enum: ['Active', 'Paid Off', 'Default', 'Foreclosed'], default: 'Active' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: insurance ─────────────────────────────── */
const insurancePolicySchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    provider_business_id: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
    provider_name: { type: String, required: true },
    policy_number: { type: String, default: '' },
    coverage_amount: { type: Number, default: 0 },
    monthly_premium: { type: Number, default: 0 },
    start_date: { type: Date, required: true },
    end_date: { type: Date, default: null },
    status: { type: String, enum: ['Active', 'Expired', 'Cancelled', 'Claim Filed'], default: 'Active' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const insuranceClaimSchema = new Schema(
  {
    policy_id: { type: Schema.Types.ObjectId, ref: 'InsurancePolicy', required: true, index: true },
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    description: { type: String, required: true },
    claim_amount: { type: Number, default: 0 },
    status: { type: String, enum: ['Filed', 'Under Review', 'Approved', 'Denied', 'Paid'], default: 'Filed' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: auctions ──────────────────────────────── */
const auctionSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    starting_bid: { type: Number, required: true },
    min_increment: { type: Number, default: 100 },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    status: { type: String, enum: ['Scheduled', 'Active', 'Ended', 'Cancelled'], default: 'Scheduled' },
    winner_name: { type: String, default: null },
    winning_bid: { type: Number, default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const auctionBidSchema = new Schema(
  {
    auction_id: { type: Schema.Types.ObjectId, ref: 'Auction', required: true, index: true },
    bidder_name: { type: String, required: true },
    amount: { type: Number, required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: false } }
);

/* ── Module: tax_exemptions ─────────────────────────── */
const taxExemptionSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    exemption_type: { type: String, enum: ['Veteran', 'Senior', 'Nonprofit', 'Government', 'Historical', 'Other'], required: true },
    percentage: { type: Number, default: 100, min: 0, max: 100 },
    description: { type: String, default: '' },
    status: { type: String, enum: ['Pending', 'Approved', 'Denied', 'Expired'], default: 'Pending' },
    approved_by: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: market_analytics ──────────────────────── */
const valuationCycleSchema = new Schema(
  {
    name: { type: String, required: true },
    effective_date: { type: Date, required: true },
    multiplier: { type: Number, default: 1.0 },
    zone_filter: { type: String, default: null },
    type_filter: { type: String, default: null },
    properties_affected: { type: Number, default: 0 },
    status: { type: String, enum: ['Draft', 'Applied', 'Reverted'], default: 'Draft' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: annotations ───────────────────────────── */
const mapAnnotationSchema = new Schema(
  {
    title: { type: String, required: true },
    description: { type: String, default: '' },
    category: { type: String, enum: ['Development', 'Road Project', 'POI', 'Event', 'Other'], default: 'Other' },
    position: { lat: Number, lng: Number },
    icon: { type: String, default: 'pin' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: districts ─────────────────────────────── */
const districtSchema = new Schema(
  {
    name: { type: String, required: true, unique: true },
    description: { type: String, default: '' },
    geojson: { type: Schema.Types.Mixed, required: true },
    color: { type: String, default: '#3498db' },
    tax_multiplier: { type: Number, default: 1.0 },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: webhook_events ─────────────────────────── */
const webhookEndpointSchema = new Schema(
  {
    url: { type: String, required: true },
    name: { type: String, default: 'Webhook' },
    events: [{ type: String }],
    active: { type: Boolean, default: true },
    secret: { type: String, default: '' },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: reminders ─────────────────────────────── */
const reminderSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    message: { type: String, required: true },
    remind_at: { type: Date, required: true, index: true },
    sent: { type: Boolean, default: false },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: leaderboard ────────────────────────────── */
const staffMetricSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    period: { type: String, required: true },
    surveys_completed: { type: Number, default: 0 },
    properties_created: { type: Number, default: 0 },
    work_orders_completed: { type: Number, default: 0 },
    edits: { type: Number, default: 0 }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);
staffMetricSchema.index({ user_id: 1, period: 1 }, { unique: true });

/* ── Module: seasonal_events ───────────────────────── */
const seasonalEventSchema = new Schema(
  {
    name: { type: String, required: true },
    description: { type: String, default: '' },
    start_date: { type: Date, required: true },
    end_date: { type: Date, required: true },
    event_type: { type: String, enum: ['Contest', 'Discount', 'Theme', 'Other'], default: 'Other' },
    config: { type: Schema.Types.Mixed, default: {} },
    active: { type: Boolean, default: true },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: bookmarks ─────────────────────────────── */
const savedViewSchema = new Schema(
  {
    user_id: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true },
    center: { lat: Number, lng: Number },
    zoom: { type: Number, default: 0 },
    filters: { type: Schema.Types.Mixed, default: {} }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

/* ── Module: hoa_fees ──────────────────────────────── */
const hoaFeeSchema = new Schema(
  {
    property_id: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
    district_name: { type: String, default: '' },
    monthly_fee: { type: Number, default: 0 },
    status: { type: String, enum: ['Current', 'Delinquent', 'Exempt'], default: 'Current' },
    balance_owed: { type: Number, default: 0 },
    created_by: { type: Schema.Types.ObjectId, ref: 'User', required: true }
  },
  { timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' } }
);

const BusinessModel = mongoose.models.Business || mongoose.model('Business', businessSchema);
BusinessModel.syncIndexes().catch((e) => console.error('[Business] syncIndexes:', e.message));

module.exports = {
  User: mongoose.models.User || mongoose.model('User', userSchema),
  Business: BusinessModel,
  Property: mongoose.models.Property || mongoose.model('Property', propertySchema),
  PropertyTransaction:
    mongoose.models.PropertyTransaction || mongoose.model('PropertyTransaction', propertyTransactionSchema),
  TaxPreset: mongoose.models.TaxPreset || mongoose.model('TaxPreset', taxPresetSchema),
  AuditLog: mongoose.models.AuditLog || mongoose.model('AuditLog', auditLogSchema),
  LoginLog: mongoose.models.LoginLog || mongoose.model('LoginLog', loginLogSchema),
  AppSetting: mongoose.models.AppSetting || mongoose.model('AppSetting', appSettingSchema),
  PropertyRequest: mongoose.models.PropertyRequest || mongoose.model('PropertyRequest', propertyRequestSchema),
  Lien: mongoose.models.Lien || mongoose.model('Lien', lienSchema),
  TaxBill: mongoose.models.TaxBill || mongoose.model('TaxBill', taxBillSchema),
  Lease: mongoose.models.Lease || mongoose.model('Lease', leaseSchema),
  PropertyPhoto: mongoose.models.PropertyPhoto || mongoose.model('PropertyPhoto', propertyPhotoSchema),
  StaffNote: mongoose.models.StaffNote || mongoose.model('StaffNote', staffNoteSchema),
  Mortgage: mongoose.models.Mortgage || mongoose.model('Mortgage', mortgageSchema),
  InsurancePolicy: mongoose.models.InsurancePolicy || mongoose.model('InsurancePolicy', insurancePolicySchema),
  InsuranceClaim: mongoose.models.InsuranceClaim || mongoose.model('InsuranceClaim', insuranceClaimSchema),
  Auction: mongoose.models.Auction || mongoose.model('Auction', auctionSchema),
  AuctionBid: mongoose.models.AuctionBid || mongoose.model('AuctionBid', auctionBidSchema),
  TaxExemption: mongoose.models.TaxExemption || mongoose.model('TaxExemption', taxExemptionSchema),
  ValuationCycle: mongoose.models.ValuationCycle || mongoose.model('ValuationCycle', valuationCycleSchema),
  MapAnnotation: mongoose.models.MapAnnotation || mongoose.model('MapAnnotation', mapAnnotationSchema),
  District: mongoose.models.District || mongoose.model('District', districtSchema),
  WebhookEndpoint: mongoose.models.WebhookEndpoint || mongoose.model('WebhookEndpoint', webhookEndpointSchema),
  Reminder: mongoose.models.Reminder || mongoose.model('Reminder', reminderSchema),
  StaffMetric: mongoose.models.StaffMetric || mongoose.model('StaffMetric', staffMetricSchema),
  SeasonalEvent: mongoose.models.SeasonalEvent || mongoose.model('SeasonalEvent', seasonalEventSchema),
  SavedView: mongoose.models.SavedView || mongoose.model('SavedView', savedViewSchema),
  HoaFee: mongoose.models.HoaFee || mongoose.model('HoaFee', hoaFeeSchema)
};

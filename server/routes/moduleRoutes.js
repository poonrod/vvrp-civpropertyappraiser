const express = require('express');
const multer = require('multer');
const path = require('path');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const { requireModule } = require('../middleware/moduleMiddleware');
const {
  Lien, TaxBill, Lease, PropertyPhoto, StaffNote,
  Mortgage, InsurancePolicy, InsuranceClaim, Auction, AuctionBid,
  TaxExemption, ValuationCycle, Property,
  MapAnnotation, District, PropertyTransaction,
  WebhookEndpoint, Reminder, AuditLog,
  StaffMetric, SeasonalEvent, SavedView, HoaFee, User,
  Foreclosure, ZoningPermit, EminentDomain, CodeEnforcement,
  AccessList, Parking, Inspection, Improvement, DamageReport,
  UtilityConnection, EnvironmentalHazard, Landmark, PropertyDispute,
  TaxPreset
} = require('../models/schemas');

const router = express.Router();

const STAFF = ['admin', 'appraiser', 'clerk'];

function getCentroid(geojson) {
  let coords;
  if (geojson.type === 'Polygon') coords = geojson.coordinates[0];
  else if (geojson.type === 'MultiPolygon') coords = geojson.coordinates[0][0];
  else return null;
  if (!coords || coords.length === 0) return null;
  let cx = 0, cy = 0;
  for (const c of coords) { cx += c[0]; cy += c[1]; }
  return [cx / coords.length, cy / coords.length];
}

function pointInPolygon(point, geojson) {
  let rings;
  if (geojson.type === 'Polygon') rings = geojson.coordinates;
  else if (geojson.type === 'MultiPolygon') rings = geojson.coordinates[0];
  else return false;
  const [px, py] = point;
  const ring = rings[0];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/* ── Photo Upload Config ───────────────────────────── */
const storage = multer.diskStorage({
  destination: path.join(__dirname, '..', 'uploads', 'photos'),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype.split('/')[1])) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

/* ═══════════════════════════════════════════════════
   MODULE: law_liens -- Warrants & Liens
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/liens', requireModule('law_liens'), async (req, res) => {
  try {
    const liens = await Lien.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(liens);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/liens', requireAuth, requireRole(...STAFF), requireModule('law_liens'), async (req, res) => {
  try {
    const lien = await Lien.create({
      property_id: req.params.id,
      lien_type: req.body.lien_type,
      description: req.body.description || '',
      amount: Number(req.body.amount) || 0,
      placed_by: req.session.user.id
    });
    res.status(201).json(lien);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/liens/:id/resolve', requireAuth, requireRole(...STAFF), requireModule('law_liens'), async (req, res) => {
  try {
    const lien = await Lien.findByIdAndUpdate(req.params.id, {
      status: 'Resolved',
      resolved_by: req.session.user.id,
      resolved_at: new Date()
    }, { new: true });
    if (!lien) return res.status(404).json({ error: 'Lien not found' });
    res.json(lien);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: tax_ledger -- Tax Payment Tracking
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/tax-bills', requireModule('tax_ledger'), async (req, res) => {
  try {
    const bills = await TaxBill.find({ property_id: req.params.id }).sort({ due_date: -1 }).lean();
    res.json(bills);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/tax-bills', requireAuth, requireRole(...STAFF), requireModule('tax_ledger'), async (req, res) => {
  try {
    const bill = await TaxBill.create({
      property_id: req.params.id,
      period: req.body.period,
      amount_due: Number(req.body.amount_due) || 0,
      due_date: req.body.due_date,
      created_by: req.session.user.id
    });
    res.status(201).json(bill);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'Bill already exists for this period' });
    res.status(500).json({ error: e.message });
  }
});

router.patch('/tax-bills/:id/payment', requireAuth, requireRole(...STAFF), requireModule('tax_ledger'), async (req, res) => {
  try {
    const bill = await TaxBill.findById(req.params.id);
    if (!bill) return res.status(404).json({ error: 'Bill not found' });
    const payment = Number(req.body.amount) || 0;
    bill.amount_paid = Math.min(bill.amount_paid + payment, bill.amount_due);
    bill.status = bill.amount_paid >= bill.amount_due ? 'Paid' : 'Partial';
    if (bill.status === 'Paid') bill.paid_date = new Date();
    await bill.save();
    res.json(bill);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: leases -- Rental & Lease Agreements
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/leases', requireModule('leases'), async (req, res) => {
  try {
    const leases = await Lease.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(leases);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/leases', requireAuth, requireRole(...STAFF), requireModule('leases'), async (req, res) => {
  try {
    const lease = await Lease.create({
      property_id: req.params.id,
      tenant_name: req.body.tenant_name,
      monthly_rent: Number(req.body.monthly_rent) || 0,
      start_date: req.body.start_date,
      end_date: req.body.end_date || null,
      notes: req.body.notes || '',
      created_by: req.session.user.id
    });
    res.status(201).json(lease);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/leases/:id', requireAuth, requireRole(...STAFF), requireModule('leases'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.end_date) update.end_date = req.body.end_date;
    if (req.body.monthly_rent != null) update.monthly_rent = Number(req.body.monthly_rent);
    if (req.body.notes != null) update.notes = req.body.notes;
    const lease = await Lease.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!lease) return res.status(404).json({ error: 'Lease not found' });
    res.json(lease);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: photos -- Property Photos
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/photos', requireModule('photos'), async (req, res) => {
  try {
    const photos = await PropertyPhoto.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(photos);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/photos', requireAuth, requireRole(...STAFF), requireModule('photos'), upload.single('photo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    let filename = req.file.filename;
    try {
      const sharp = require('sharp');
      const thumbPath = path.join(req.file.destination, `thumb-${req.file.filename}`);
      await sharp(req.file.path).resize(800, 600, { fit: 'inside', withoutEnlargement: true }).toFile(thumbPath);
    } catch { /* sharp optional -- use original */ }

    const photo = await PropertyPhoto.create({
      property_id: req.params.id,
      filename,
      original_name: req.file.originalname,
      mime_type: req.file.mimetype,
      size_bytes: req.file.size,
      caption: req.body.caption || '',
      uploaded_by: req.session.user.id
    });
    res.status(201).json(photo);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/photos/:id', requireAuth, requireRole(...STAFF), requireModule('photos'), async (req, res) => {
  try {
    const photo = await PropertyPhoto.findByIdAndDelete(req.params.id);
    if (!photo) return res.status(404).json({ error: 'Photo not found' });
    const fs = require('fs');
    const filePath = path.join(__dirname, '..', 'uploads', 'photos', photo.filename);
    fs.unlink(filePath, () => {});
    const thumbPath = path.join(__dirname, '..', 'uploads', 'photos', `thumb-${photo.filename}`);
    fs.unlink(thumbPath, () => {});
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: staff_notes -- Internal Staff Notes
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/notes', requireAuth, requireRole(...STAFF), requireModule('staff_notes'), async (req, res) => {
  try {
    const notes = await StaffNote.find({ property_id: req.params.id })
      .sort({ created_at: -1 })
      .populate('author', 'username')
      .lean();
    res.json(notes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/notes', requireAuth, requireRole(...STAFF), requireModule('staff_notes'), async (req, res) => {
  try {
    const note = await StaffNote.create({
      property_id: req.params.id,
      author: req.session.user.id,
      text: req.body.text,
      mentions: req.body.mentions || []
    });
    const populated = await StaffNote.findById(note._id).populate('author', 'username').lean();
    res.status(201).json(populated);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/notes/:id', requireAuth, requireRole(...STAFF), requireModule('staff_notes'), async (req, res) => {
  try {
    const note = await StaffNote.findByIdAndDelete(req.params.id);
    if (!note) return res.status(404).json({ error: 'Note not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: mortgages -- Mortgages & Loans
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/mortgages', requireModule('mortgages'), async (req, res) => {
  try {
    const mortgages = await Mortgage.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(mortgages);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/mortgages', requireAuth, requireRole(...STAFF), requireModule('mortgages'), async (req, res) => {
  try {
    const mortgage = await Mortgage.create({
      property_id: req.params.id,
      lender_business_id: req.body.lender_business_id || null,
      lender_name: req.body.lender_name,
      principal: Number(req.body.principal) || 0,
      interest_rate: Number(req.body.interest_rate) || 0,
      monthly_payment: Number(req.body.monthly_payment) || 0,
      remaining_balance: Number(req.body.remaining_balance || req.body.principal) || 0,
      start_date: req.body.start_date,
      term_months: Number(req.body.term_months) || 360,
      created_by: req.session.user.id
    });
    res.status(201).json(mortgage);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/mortgages/:id', requireAuth, requireRole(...STAFF), requireModule('mortgages'), async (req, res) => {
  try {
    const update = {};
    if (req.body.remaining_balance != null) update.remaining_balance = Number(req.body.remaining_balance);
    if (req.body.status) update.status = req.body.status;
    if (req.body.monthly_payment != null) update.monthly_payment = Number(req.body.monthly_payment);
    const mortgage = await Mortgage.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!mortgage) return res.status(404).json({ error: 'Mortgage not found' });
    res.json(mortgage);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: insurance -- Property Insurance
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/insurance', requireModule('insurance'), async (req, res) => {
  try {
    const policies = await InsurancePolicy.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(policies);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/insurance', requireAuth, requireRole(...STAFF), requireModule('insurance'), async (req, res) => {
  try {
    const policy = await InsurancePolicy.create({
      property_id: req.params.id,
      provider_business_id: req.body.provider_business_id || null,
      provider_name: req.body.provider_name,
      policy_number: req.body.policy_number || '',
      coverage_amount: Number(req.body.coverage_amount) || 0,
      monthly_premium: Number(req.body.monthly_premium) || 0,
      start_date: req.body.start_date,
      end_date: req.body.end_date || null,
      created_by: req.session.user.id
    });
    res.status(201).json(policy);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/insurance/:id/claims', requireAuth, requireRole(...STAFF), requireModule('insurance'), async (req, res) => {
  try {
    const policy = await InsurancePolicy.findById(req.params.id);
    if (!policy) return res.status(404).json({ error: 'Policy not found' });
    const claim = await InsuranceClaim.create({
      policy_id: req.params.id,
      property_id: policy.property_id,
      description: req.body.description,
      claim_amount: Number(req.body.claim_amount) || 0,
      created_by: req.session.user.id
    });
    res.status(201).json(claim);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/properties/:id/claims', requireModule('insurance'), async (req, res) => {
  try {
    const claims = await InsuranceClaim.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(claims);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/claims/:id', requireAuth, requireRole(...STAFF), requireModule('insurance'), async (req, res) => {
  try {
    const claim = await InsuranceClaim.findByIdAndUpdate(req.params.id, { status: req.body.status }, { new: true });
    if (!claim) return res.status(404).json({ error: 'Claim not found' });
    res.json(claim);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: auctions -- Property Auctions
   ═══════════════════════════════════════════════════ */
router.get('/auctions', requireModule('auctions'), async (req, res) => {
  try {
    const filter = req.query.status ? { status: req.query.status } : {};
    const auctions = await Auction.find(filter).sort({ start_date: -1 }).populate('property_id', 'name parcel_id address').lean();
    res.json(auctions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/properties/:id/auctions', requireModule('auctions'), async (req, res) => {
  try {
    const auctions = await Auction.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    for (const a of auctions) {
      a.bid_count = await AuctionBid.countDocuments({ auction_id: a._id });
      const topBid = await AuctionBid.findOne({ auction_id: a._id }).sort({ amount: -1 }).lean();
      a.current_bid = topBid ? topBid.amount : null;
    }
    res.json(auctions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/auctions', requireAuth, requireRole('admin'), requireModule('auctions'), async (req, res) => {
  try {
    const auction = await Auction.create({
      property_id: req.params.id,
      starting_bid: Number(req.body.starting_bid) || 0,
      min_increment: Number(req.body.min_increment) || 100,
      start_date: req.body.start_date,
      end_date: req.body.end_date,
      created_by: req.session.user.id
    });
    res.status(201).json(auction);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/auctions/:id/bids', requireAuth, requireModule('auctions'), async (req, res) => {
  try {
    const auction = await Auction.findById(req.params.id);
    if (!auction || auction.status !== 'Active') return res.status(400).json({ error: 'Auction not active' });
    const topBid = await AuctionBid.findOne({ auction_id: req.params.id }).sort({ amount: -1 }).lean();
    const minBid = topBid ? topBid.amount + auction.min_increment : auction.starting_bid;
    if (Number(req.body.amount) < minBid) return res.status(400).json({ error: `Minimum bid is $${minBid}` });
    const bid = await AuctionBid.create({
      auction_id: req.params.id,
      bidder_name: req.body.bidder_name,
      amount: Number(req.body.amount)
    });
    res.status(201).json(bid);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/auctions/:id/bids', requireModule('auctions'), async (req, res) => {
  try {
    const bids = await AuctionBid.find({ auction_id: req.params.id }).sort({ amount: -1 }).lean();
    res.json(bids);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/auctions/:id', requireAuth, requireRole('admin'), requireModule('auctions'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.winner_name) update.winner_name = req.body.winner_name;
    if (req.body.winning_bid != null) update.winning_bid = Number(req.body.winning_bid);
    const auction = await Auction.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!auction) return res.status(404).json({ error: 'Auction not found' });
    res.json(auction);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: tax_exemptions -- Tax Exemptions
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/exemptions', requireModule('tax_exemptions'), async (req, res) => {
  try {
    const exemptions = await TaxExemption.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(exemptions);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/exemptions', requireAuth, requireRole(...STAFF), requireModule('tax_exemptions'), async (req, res) => {
  try {
    const exemption = await TaxExemption.create({
      property_id: req.params.id,
      exemption_type: req.body.exemption_type,
      percentage: Number(req.body.percentage) || 100,
      description: req.body.description || '',
      created_by: req.session.user.id
    });
    res.status(201).json(exemption);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/exemptions/:id', requireAuth, requireRole('admin'), requireModule('tax_exemptions'), async (req, res) => {
  try {
    const update = { status: req.body.status };
    if (req.body.status === 'Approved') update.approved_by = req.session.user.id;
    const exemption = await TaxExemption.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!exemption) return res.status(404).json({ error: 'Exemption not found' });
    res.json(exemption);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: market_analytics -- Market Analytics
   ═══════════════════════════════════════════════════ */
router.get('/analytics/summary', requireAuth, requireRole(...STAFF), requireModule('market_analytics'), async (req, res) => {
  try {
    const props = await Property.find().lean();
    const byType = {};
    const byZone = {};
    let totalValue = 0;
    let totalTax = 0;

    for (const p of props) {
      const type = p.type || 'Unknown';
      const zone = p.tax_zone || 'No Zone';
      byType[type] = (byType[type] || 0) + 1;
      byZone[zone] = byZone[zone] || { count: 0, value: 0, tax: 0 };
      byZone[zone].count++;
      byZone[zone].value += Number(p.assessed_value || 0);
      byZone[zone].tax += Number(p.annual_tax || 0);
      totalValue += Number(p.assessed_value || 0);
      totalTax += Number(p.annual_tax || 0);
    }

    res.json({ total: props.length, totalValue, totalTax, byType, byZone });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/analytics/valuation-cycles', requireAuth, requireRole(...STAFF), requireModule('market_analytics'), async (req, res) => {
  try {
    const cycles = await ValuationCycle.find().sort({ created_at: -1 }).lean();
    res.json(cycles);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/analytics/valuation-cycles', requireAuth, requireRole('admin'), requireModule('market_analytics'), async (req, res) => {
  try {
    const cycle = await ValuationCycle.create({
      name: req.body.name,
      effective_date: req.body.effective_date,
      multiplier: Number(req.body.multiplier) || 1.0,
      zone_filter: req.body.zone_filter || null,
      type_filter: req.body.type_filter || null,
      created_by: req.session.user.id
    });
    res.status(201).json(cycle);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/analytics/valuation-cycles/:id/apply', requireAuth, requireRole('admin'), requireModule('market_analytics'), async (req, res) => {
  try {
    const cycle = await ValuationCycle.findById(req.params.id);
    if (!cycle || cycle.status !== 'Draft') return res.status(400).json({ error: 'Cycle not applicable' });

    const filter = {};
    if (cycle.zone_filter) filter.tax_zone = cycle.zone_filter;
    if (cycle.type_filter) filter.type = cycle.type_filter;

    const result = await Property.updateMany(filter, [
      { $set: { assessed_value: { $multiply: ['$assessed_value', cycle.multiplier] } } }
    ]);

    cycle.properties_affected = result.modifiedCount;
    cycle.status = 'Applied';
    await cycle.save();
    res.json({ applied: result.modifiedCount });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: heatmaps -- Heatmap data endpoint
   ═══════════════════════════════════════════════════ */
router.get('/heatmap/data', requireModule('heatmaps'), async (req, res) => {
  try {
    const layer = req.query.layer || 'value';
    const props = await Property.find({}, 'geojson assessed_value annual_tax status').lean();
    const points = [];
    for (const p of props) {
      if (!p.geojson) continue;
      let coords;
      if (p.geojson.type === 'Polygon' && p.geojson.coordinates?.[0]) {
        const ring = p.geojson.coordinates[0];
        const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
        const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length;
        coords = [lat, lng];
      } else continue;

      let intensity = 1;
      if (layer === 'value') intensity = Number(p.assessed_value) || 1;
      else if (layer === 'tax') intensity = Number(p.annual_tax) || 1;
      else if (layer === 'vacancy') intensity = p.status === 'Requires Survey' || p.status === 'Foreclosed' ? 5 : 0;

      if (intensity > 0) points.push([...coords, intensity]);
    }
    res.json(points);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: timeline -- Historical property snapshots
   ═══════════════════════════════════════════════════ */
router.get('/timeline/events', requireModule('timeline'), async (req, res) => {
  try {
    const transactions = await PropertyTransaction.find()
      .sort({ transfer_date: 1 })
      .populate('property_id', 'name parcel_id')
      .limit(500)
      .lean();
    const properties = await Property.find({}, 'name parcel_id created_at status').sort({ created_at: 1 }).lean();

    const events = [];
    for (const p of properties) {
      events.push({ type: 'created', date: p.created_at, property: p.name, parcel: p.parcel_id });
    }
    for (const t of transactions) {
      events.push({
        type: 'transaction', date: t.transfer_date,
        property: t.property_id?.name || 'Unknown', parcel: t.property_id?.parcel_id || '',
        from: t.from_owner, to: t.to_owner, price: t.sale_price
      });
    }
    events.sort((a, b) => new Date(a.date) - new Date(b.date));
    res.json(events);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: annotations -- Map Annotations & Pins
   ═══════════════════════════════════════════════════ */
router.get('/annotations', requireModule('annotations'), async (req, res) => {
  try {
    const annotations = await MapAnnotation.find().sort({ created_at: -1 }).lean();
    res.json(annotations);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/annotations', requireAuth, requireRole(...STAFF), requireModule('annotations'), async (req, res) => {
  try {
    const annotation = await MapAnnotation.create({
      title: req.body.title,
      description: req.body.description || '',
      category: req.body.category || 'Other',
      position: { lat: Number(req.body.lat), lng: Number(req.body.lng) },
      created_by: req.session.user.id
    });
    res.status(201).json(annotation);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/annotations/:id', requireAuth, requireRole(...STAFF), requireModule('annotations'), async (req, res) => {
  try {
    await MapAnnotation.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: districts -- Neighborhood Districts
   ═══════════════════════════════════════════════════ */
router.get('/districts', requireModule('districts'), async (req, res) => {
  try {
    const districts = await District.find().sort({ name: 1 }).lean();
    res.json(districts);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/districts', requireAuth, requireRole('admin'), requireModule('districts'), async (req, res) => {
  try {
    const district = await District.create({
      name: req.body.name,
      description: req.body.description || '',
      geojson: req.body.geojson,
      color: req.body.color || '#3498db',
      tax_multiplier: Number(req.body.tax_multiplier) || 1.0,
      hoa_fee: Number(req.body.hoa_fee) || 0,
      created_by: req.session.user.id
    });
    res.status(201).json(district);
  } catch (e) {
    if (e.code === 11000) return res.status(409).json({ error: 'District name already exists' });
    res.status(500).json({ error: e.message });
  }
});

router.put('/districts/:id', requireAuth, requireRole('admin'), requireModule('districts'), async (req, res) => {
  try {
    const update = {};
    if (req.body.name) update.name = req.body.name;
    if (req.body.description != null) update.description = req.body.description;
    if (req.body.color) update.color = req.body.color;
    if (req.body.tax_multiplier != null) update.tax_multiplier = Number(req.body.tax_multiplier);
    if (req.body.hoa_fee != null) update.hoa_fee = Number(req.body.hoa_fee);
    if (req.body.geojson) update.geojson = req.body.geojson;
    const district = await District.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!district) return res.status(404).json({ error: 'District not found' });
    res.json(district);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/districts/for-property/:propertyId', requireModule('districts'), async (req, res) => {
  try {
    const property = await Property.findById(req.params.propertyId).lean();
    if (!property || !property.geojson) return res.json(null);
    const centroid = getCentroid(property.geojson);
    if (!centroid) return res.json(null);
    const districts = await District.find().lean();
    for (const d of districts) {
      if (!d.geojson) continue;
      if (pointInPolygon(centroid, d.geojson)) return res.json(d);
    }
    res.json(null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/districts/:id', requireAuth, requireRole('admin'), requireModule('districts'), async (req, res) => {
  try {
    await District.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: fivem_bridge -- FiveM REST API
   ═══════════════════════════════════════════════════ */
router.get('/fivem/property-at', requireModule('fivem_bridge'), async (req, res) => {
  try {
    const { x, y } = req.query;
    if (!x || !y) return res.status(400).json({ error: 'x and y required' });
    const props = await Property.find({}, 'name parcel_id address owner_name status geojson type').lean();
    const point = [Number(x), Number(y)];
    const found = props.find((p) => {
      if (!p.geojson?.coordinates?.[0]) return false;
      return pointInPolygon(point, p.geojson.coordinates[0]);
    });
    res.json(found || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/fivem/by-owner', requireModule('fivem_bridge'), async (req, res) => {
  try {
    const name = req.query.name;
    if (!name) return res.status(400).json({ error: 'name required' });
    const props = await Property.find({
      $or: [
        { owner_name: { $regex: name, $options: 'i' } },
        { 'residential_owners.name': { $regex: name, $options: 'i' } }
      ]
    }, 'name parcel_id address owner_name status type assessed_value').lean();
    res.json(props);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/fivem/for-sale', requireModule('fivem_bridge'), async (_req, res) => {
  try {
    const props = await Property.find({ status: 'For Sale' }, 'name parcel_id address purchase_price type geojson').lean();
    res.json(props);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

function pointInPolygon(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > point[1]) !== (yj > point[1])) &&
      (point[0] < (xj - xi) * (point[1] - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/* ═══════════════════════════════════════════════════
   MODULE: webhook_events -- Outbound Webhooks
   ═══════════════════════════════════════════════════ */
router.get('/webhooks', requireAuth, requireRole('admin'), requireModule('webhook_events'), async (req, res) => {
  try {
    const endpoints = await WebhookEndpoint.find().sort({ created_at: -1 }).lean();
    res.json(endpoints);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/webhooks', requireAuth, requireRole('admin'), requireModule('webhook_events'), async (req, res) => {
  try {
    const endpoint = await WebhookEndpoint.create({
      url: req.body.url,
      name: req.body.name || 'Webhook',
      events: req.body.events || [],
      secret: req.body.secret || '',
      created_by: req.session.user.id
    });
    res.status(201).json(endpoint);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/webhooks/:id', requireAuth, requireRole('admin'), requireModule('webhook_events'), async (req, res) => {
  try {
    await WebhookEndpoint.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/webhooks/:id', requireAuth, requireRole('admin'), requireModule('webhook_events'), async (req, res) => {
  try {
    const update = {};
    if (req.body.active != null) update.active = req.body.active;
    if (req.body.events) update.events = req.body.events;
    if (req.body.url) update.url = req.body.url;
    if (req.body.name) update.name = req.body.name;
    const endpoint = await WebhookEndpoint.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!endpoint) return res.status(404).json({ error: 'Not found' });
    res.json(endpoint);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: reminders -- Scheduled Reminders
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/reminders', requireAuth, requireRole(...STAFF), requireModule('reminders'), async (req, res) => {
  try {
    const reminders = await Reminder.find({ property_id: req.params.id }).sort({ remind_at: 1 }).lean();
    res.json(reminders);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/reminders', requireAuth, requireRole(...STAFF), requireModule('reminders'), async (req, res) => {
  try {
    const reminder = await Reminder.create({
      property_id: req.params.id,
      message: req.body.message,
      remind_at: req.body.remind_at,
      created_by: req.session.user.id
    });
    res.status(201).json(reminder);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/reminders/:id', requireAuth, requireRole(...STAFF), requireModule('reminders'), async (req, res) => {
  try {
    await Reminder.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: audit_digest -- Weekly Audit Summary
   ═══════════════════════════════════════════════════ */
router.get('/audit-digest', requireAuth, requireRole('admin'), requireModule('audit_digest'), async (req, res) => {
  try {
    const days = Number(req.query.days) || 7;
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const logs = await AuditLog.find({ created_at: { $gte: since } })
      .sort({ created_at: -1 })
      .populate('user_id', 'username')
      .limit(200)
      .lean();

    const summary = {};
    for (const log of logs) {
      const user = log.user_id?.username || 'Unknown';
      if (!summary[user]) summary[user] = { creates: 0, updates: 0, deletes: 0 };
      if (log.action === 'CREATE') summary[user].creates++;
      else if (log.action === 'UPDATE') summary[user].updates++;
      else if (log.action === 'DELETE') summary[user].deletes++;
    }

    res.json({ period_days: days, total_actions: logs.length, by_user: summary, recent: logs.slice(0, 20) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: leaderboard -- Staff Metrics & Rankings
   ═══════════════════════════════════════════════════ */
router.get('/leaderboard', requireAuth, requireRole(...STAFF), requireModule('leaderboard'), async (req, res) => {
  try {
    const period = req.query.period || new Date().toISOString().slice(0, 7);
    const metrics = await StaffMetric.find({ period })
      .sort({ properties_created: -1 })
      .populate('user_id', 'username avatar')
      .lean();
    res.json(metrics);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/leaderboard/all-time', requireAuth, requireRole(...STAFF), requireModule('leaderboard'), async (req, res) => {
  try {
    const pipeline = [
      { $group: {
        _id: '$user_id',
        total_surveys: { $sum: '$surveys_completed' },
        total_properties: { $sum: '$properties_created' },
        total_work_orders: { $sum: '$work_orders_completed' },
        total_edits: { $sum: '$edits' }
      }},
      { $sort: { total_properties: -1 } },
      { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'user' } },
      { $unwind: { path: '$user', preserveNullAndEmptyArrays: true } }
    ];
    const results = await StaffMetric.aggregate(pipeline);
    res.json(results.map((r) => ({
      username: r.user?.username || 'Unknown',
      avatar: r.user?.avatar || null,
      ...r, user: undefined
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: gazette -- Monthly Property Gazette
   ═══════════════════════════════════════════════════ */
router.get('/gazette/generate', requireAuth, requireRole(...STAFF), requireModule('gazette'), async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const recentTransactions = await PropertyTransaction.find({ transfer_date: { $gte: thirtyDaysAgo } })
      .sort({ sale_price: -1 }).limit(10)
      .populate('property_id', 'name parcel_id address').lean();

    const newProperties = await Property.find({ created_at: { $gte: thirtyDaysAgo } })
      .sort({ created_at: -1 }).limit(10).lean();

    const totalProperties = await Property.countDocuments();
    const totalValue = await Property.aggregate([{ $group: { _id: null, total: { $sum: '$assessed_value' } } }]);
    const forSaleCount = await Property.countDocuments({ status: 'For Sale' });
    const foreclosedCount = await Property.countDocuments({ status: 'Foreclosed' });

    res.json({
      generated_at: new Date(),
      period: '30 days',
      stats: {
        total_properties: totalProperties,
        total_value: totalValue[0]?.total || 0,
        for_sale: forSaleCount,
        foreclosed: foreclosedCount
      },
      top_transactions: recentTransactions.map((t) => ({
        property: t.property_id?.name || 'Unknown',
        parcel: t.property_id?.parcel_id || '',
        from: t.from_owner, to: t.to_owner,
        price: t.sale_price, date: t.transfer_date
      })),
      new_properties: newProperties.map((p) => ({
        name: p.name, parcel_id: p.parcel_id, type: p.type, address: p.address, created: p.created_at
      }))
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/gazette', requireModule('gazette'), async (req, res) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const recentSales = await PropertyTransaction.find({ transfer_date: { $gte: thirtyDaysAgo } })
      .sort({ sale_price: -1 }).limit(10).populate('property_id', 'name parcel_id').lean();
    const newProps = await Property.find({ created_at: { $gte: thirtyDaysAgo } }).sort({ created_at: -1 }).limit(10).lean();
    const total = await Property.countDocuments();
    const forSale = await Property.countDocuments({ status: 'For Sale' });
    const agg = await Property.aggregate([{ $group: { _id: null, avg: { $avg: '$assessed_value' } } }]);
    res.json({
      generated_at: new Date(),
      summary: `Property gazette covering the last 30 days. ${recentSales.length} sales recorded, ${newProps.length} new properties added.`,
      recent_sales: recentSales.map((t) => ({ property_name: t.property_id?.name, parcel_id: t.property_id?.parcel_id, sale_price: t.sale_price })),
      new_properties: newProps.map((p) => ({ name: p.name, parcel_id: p.parcel_id, type: p.type })),
      stats: { total, for_sale: forSale, avg_value: Math.round(agg[0]?.avg || 0) }
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: seasonal_events -- Seasonal Events
   ═══════════════════════════════════════════════════ */
router.get('/seasonal-events/active', requireModule('seasonal_events'), async (req, res) => {
  try {
    const now = new Date();
    const events = await SeasonalEvent.find({ start_date: { $lte: now }, end_date: { $gte: now } }).sort({ start_date: -1 }).lean();
    res.json(events);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/events', requireModule('seasonal_events'), async (req, res) => {
  try {
    const events = await SeasonalEvent.find().sort({ start_date: -1 }).lean();
    res.json(events);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/events', requireAuth, requireRole('admin'), requireModule('seasonal_events'), async (req, res) => {
  try {
    const event = await SeasonalEvent.create({
      name: req.body.name,
      description: req.body.description || '',
      start_date: req.body.start_date,
      end_date: req.body.end_date,
      event_type: req.body.event_type || 'Other',
      config: req.body.config || {},
      created_by: req.session.user.id
    });
    res.status(201).json(event);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/events/:id', requireAuth, requireRole('admin'), requireModule('seasonal_events'), async (req, res) => {
  try {
    const update = {};
    if (req.body.active != null) update.active = req.body.active;
    if (req.body.name) update.name = req.body.name;
    if (req.body.description != null) update.description = req.body.description;
    const event = await SeasonalEvent.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/events/:id', requireAuth, requireRole('admin'), requireModule('seasonal_events'), async (req, res) => {
  try {
    await SeasonalEvent.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: bookmarks -- Saved Map Views
   ═══════════════════════════════════════════════════ */
router.get('/bookmarks', requireAuth, requireModule('bookmarks'), async (req, res) => {
  try {
    const views = await SavedView.find({ user_id: req.session.user.id }).sort({ created_at: -1 }).lean();
    res.json(views);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/bookmarks', requireAuth, requireModule('bookmarks'), async (req, res) => {
  try {
    const view = await SavedView.create({
      user_id: req.session.user.id,
      name: req.body.name,
      center: { lat: Number(req.body.lat), lng: Number(req.body.lng) },
      zoom: Number(req.body.zoom) || 0,
      filters: req.body.filters || {}
    });
    res.status(201).json(view);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/bookmarks/:id', requireAuth, requireModule('bookmarks'), async (req, res) => {
  try {
    await SavedView.findOneAndDelete({ _id: req.params.id, user_id: req.session.user.id });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: hoa_fees -- HOA & Community Fees
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/hoa', requireModule('hoa_fees'), async (req, res) => {
  try {
    const fees = await HoaFee.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(fees);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/hoa', requireAuth, requireRole(...STAFF), requireModule('hoa_fees'), async (req, res) => {
  try {
    const fee = await HoaFee.create({
      property_id: req.params.id,
      district_name: req.body.district_name || '',
      monthly_fee: Number(req.body.monthly_fee) || 0,
      created_by: req.session.user.id
    });
    res.status(201).json(fee);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/hoa/:id', requireAuth, requireRole(...STAFF), requireModule('hoa_fees'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.balance_owed != null) update.balance_owed = Number(req.body.balance_owed);
    if (req.body.monthly_fee != null) update.monthly_fee = Number(req.body.monthly_fee);
    const fee = await HoaFee.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!fee) return res.status(404).json({ error: 'HOA fee not found' });
    res.json(fee);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: foreclosure -- Property Foreclosures
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/foreclosure', requireModule('foreclosure'), async (req, res) => {
  try {
    const records = await Foreclosure.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(records);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/foreclosure', requireAuth, requireRole(...STAFF), requireModule('foreclosure'), async (req, res) => {
  try {
    const record = await Foreclosure.create({
      property_id: req.params.id,
      reason: req.body.reason || '',
      amount_owed: Number(req.body.amount_owed) || 0,
      initiated_by: req.session.user.id
    });
    res.status(201).json(record);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/foreclosure/:id', requireAuth, requireRole(...STAFF), requireModule('foreclosure'), async (req, res) => {
  try {
    const update = {};
    if (req.body.stage) update.stage = req.body.stage;
    if (req.body.status) update.status = req.body.status;
    if (req.body.notes != null) update.notes = req.body.notes;
    const record = await Foreclosure.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!record) return res.status(404).json({ error: 'Foreclosure not found' });
    res.json(record);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: zoning_permits -- Zoning Permits & Violations
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/zoning', requireModule('zoning_permits'), async (req, res) => {
  try {
    const permits = await ZoningPermit.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(permits);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/zoning', requireAuth, requireRole(...STAFF), requireModule('zoning_permits'), async (req, res) => {
  try {
    const permit = await ZoningPermit.create({
      property_id: req.params.id,
      permit_type: req.body.permit_type,
      description: req.body.description || '',
      requested_zone: req.body.requested_zone || '',
      created_by: req.session.user.id
    });
    res.status(201).json(permit);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/zoning/:id', requireAuth, requireRole(...STAFF), requireModule('zoning_permits'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.notes != null) update.notes = req.body.notes;
    const permit = await ZoningPermit.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!permit) return res.status(404).json({ error: 'Zoning permit not found' });
    res.json(permit);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/zoning/:id/violations', requireAuth, requireRole(...STAFF), requireModule('zoning_permits'), async (req, res) => {
  try {
    const permit = await ZoningPermit.findById(req.params.id);
    if (!permit) return res.status(404).json({ error: 'Zoning permit not found' });
    const violation = {
      description: req.body.description,
      severity: req.body.severity || 'Minor',
      reported_by: req.session.user.id,
      reported_at: new Date()
    };
    permit.violations = permit.violations || [];
    permit.violations.push(violation);
    await permit.save();
    res.status(201).json(permit);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: eminent_domain -- Eminent Domain Cases
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/eminent-domain', requireModule('eminent_domain'), async (req, res) => {
  try {
    const cases = await EminentDomain.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(cases);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/eminent-domain', requireAuth, requireRole('admin'), requireModule('eminent_domain'), async (req, res) => {
  try {
    const edCase = await EminentDomain.create({
      property_id: req.params.id,
      reason: req.body.reason,
      offering_price: Number(req.body.offering_price) || 0,
      initiated_by: req.session.user.id
    });
    res.status(201).json(edCase);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/eminent-domain/:id', requireAuth, requireRole('admin'), requireModule('eminent_domain'), async (req, res) => {
  try {
    const update = {};
    if (req.body.stage) update.stage = req.body.stage;
    if (req.body.votes != null) update.votes = req.body.votes;
    if (req.body.status) update.status = req.body.status;
    if (req.body.notes != null) update.notes = req.body.notes;
    const edCase = await EminentDomain.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!edCase) return res.status(404).json({ error: 'Eminent domain case not found' });
    res.json(edCase);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: code_enforcement -- Code Enforcement Citations
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/citations', requireModule('code_enforcement'), async (req, res) => {
  try {
    const citations = await CodeEnforcement.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(citations);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/citations', requireAuth, requireRole(...STAFF), requireModule('code_enforcement'), async (req, res) => {
  try {
    const citation = await CodeEnforcement.create({
      property_id: req.params.id,
      violation_type: req.body.violation_type,
      description: req.body.description || '',
      fine_amount: Number(req.body.fine_amount) || 0,
      issued_by: req.session.user.id
    });
    res.status(201).json(citation);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/citations/:id', requireAuth, requireRole(...STAFF), requireModule('code_enforcement'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.notes != null) update.notes = req.body.notes;
    const citation = await CodeEnforcement.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!citation) return res.status(404).json({ error: 'Citation not found' });
    res.json(citation);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: access_lists -- Property Access Lists
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/access-list', requireModule('access_lists'), async (req, res) => {
  try {
    const list = await AccessList.findOne({ property_id: req.params.id }).lean();
    res.json(list || { property_id: req.params.id, entries: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/access-list', requireAuth, requireRole(...STAFF), requireModule('access_lists'), async (req, res) => {
  try {
    const list = await AccessList.findOneAndUpdate(
      { property_id: req.params.id },
      { property_id: req.params.id, entries: req.body.entries || [], updated_by: req.session.user.id },
      { new: true, upsert: true }
    );
    res.status(201).json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/access-list/:id/entries', requireAuth, requireRole(...STAFF), requireModule('access_lists'), async (req, res) => {
  try {
    const list = await AccessList.findById(req.params.id);
    if (!list) return res.status(404).json({ error: 'Access list not found' });
    const entry = {
      name: req.body.name,
      role: req.body.role || 'Guest',
      added_by: req.session.user.id,
      added_at: new Date()
    };
    list.entries = list.entries || [];
    list.entries.push(entry);
    await list.save();
    res.status(201).json(list);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: parking -- Property Parking Management
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/parking', requireModule('parking'), async (req, res) => {
  try {
    const parking = await Parking.findOne({ property_id: req.params.id }).lean();
    res.json(parking || { property_id: req.params.id, spaces: 0, vehicles: [] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/parking', requireAuth, requireRole(...STAFF), requireModule('parking'), async (req, res) => {
  try {
    const parking = await Parking.create({
      property_id: req.params.id,
      spaces: Number(req.body.spaces) || 0,
      capacity: Number(req.body.capacity) || 0,
      type: req.body.type || 'Standard',
      created_by: req.session.user.id
    });
    res.status(201).json(parking);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/parking/:id', requireAuth, requireRole(...STAFF), requireModule('parking'), async (req, res) => {
  try {
    const update = {};
    if (req.body.spaces != null) update.spaces = Number(req.body.spaces);
    if (req.body.capacity != null) update.capacity = Number(req.body.capacity);
    if (req.body.type) update.type = req.body.type;
    const parking = await Parking.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!parking) return res.status(404).json({ error: 'Parking record not found' });
    res.json(parking);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/parking/:id/vehicles', requireAuth, requireRole(...STAFF), requireModule('parking'), async (req, res) => {
  try {
    const parking = await Parking.findById(req.params.id);
    if (!parking) return res.status(404).json({ error: 'Parking record not found' });
    const vehicle = {
      plate: req.body.plate,
      owner_name: req.body.owner_name || '',
      model: req.body.model || '',
      added_by: req.session.user.id,
      added_at: new Date()
    };
    parking.vehicles = parking.vehicles || [];
    parking.vehicles.push(vehicle);
    await parking.save();
    res.status(201).json(parking);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: inspections -- Property Inspections
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/inspections', requireModule('inspections'), async (req, res) => {
  try {
    const inspections = await Inspection.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(inspections);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/inspections', requireAuth, requireRole(...STAFF), requireModule('inspections'), async (req, res) => {
  try {
    const inspection = await Inspection.create({
      property_id: req.params.id,
      inspection_type: req.body.inspection_type,
      description: req.body.description || '',
      scheduled_date: req.body.scheduled_date || null,
      inspector: req.session.user.id
    });
    res.status(201).json(inspection);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/inspections/:id', requireAuth, requireRole(...STAFF), requireModule('inspections'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.result) update.result = req.body.result;
    if (req.body.notes != null) update.notes = req.body.notes;
    if (req.body.completed_at) update.completed_at = req.body.completed_at;
    const inspection = await Inspection.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!inspection) return res.status(404).json({ error: 'Inspection not found' });
    res.json(inspection);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: improvements -- Property Improvements
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/improvements', requireModule('improvements'), async (req, res) => {
  try {
    const improvements = await Improvement.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(improvements);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/improvements', requireAuth, requireRole(...STAFF), requireModule('improvements'), async (req, res) => {
  try {
    const improvement = await Improvement.create({
      property_id: req.params.id,
      title: req.body.title,
      description: req.body.description || '',
      estimated_cost: Number(req.body.estimated_cost) || 0,
      requested_by: req.session.user.id
    });
    res.status(201).json(improvement);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/improvements/:id', requireAuth, requireRole(...STAFF), requireModule('improvements'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.notes != null) update.notes = req.body.notes;
    if (req.body.actual_cost != null) update.actual_cost = Number(req.body.actual_cost);
    if (req.body.status === 'Approved') update.approved_by = req.session.user.id;
    const improvement = await Improvement.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!improvement) return res.status(404).json({ error: 'Improvement not found' });
    res.json(improvement);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: damage_reports -- Property Damage Reports
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/damage-reports', requireModule('damage_reports'), async (req, res) => {
  try {
    const reports = await DamageReport.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(reports);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/damage-reports', requireAuth, requireRole(...STAFF), requireModule('damage_reports'), async (req, res) => {
  try {
    const report = await DamageReport.create({
      property_id: req.params.id,
      damage_type: req.body.damage_type,
      description: req.body.description || '',
      severity: req.body.severity || 'Moderate',
      estimated_repair_cost: Number(req.body.estimated_repair_cost) || 0,
      reported_by: req.session.user.id
    });
    res.status(201).json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/damage-reports/:id', requireAuth, requireRole(...STAFF), requireModule('damage_reports'), async (req, res) => {
  try {
    const update = {};
    if (req.body.repaired != null) update.repaired = req.body.repaired;
    if (req.body.repaired_at) update.repaired_at = req.body.repaired_at;
    if (req.body.notes != null) update.notes = req.body.notes;
    if (req.body.status) update.status = req.body.status;
    const report = await DamageReport.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!report) return res.status(404).json({ error: 'Damage report not found' });
    res.json(report);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: utilities -- Utility Connections
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/utilities', requireModule('utilities'), async (req, res) => {
  try {
    const connections = await UtilityConnection.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(connections);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/utilities', requireAuth, requireRole(...STAFF), requireModule('utilities'), async (req, res) => {
  try {
    const connection = await UtilityConnection.create({
      property_id: req.params.id,
      utility_type: req.body.utility_type,
      provider: req.body.provider || '',
      account_number: req.body.account_number || '',
      monthly_cost: Number(req.body.monthly_cost) || 0,
      created_by: req.session.user.id
    });
    res.status(201).json(connection);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/utilities/:id', requireAuth, requireRole(...STAFF), requireModule('utilities'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.monthly_cost != null) update.monthly_cost = Number(req.body.monthly_cost);
    if (req.body.provider) update.provider = req.body.provider;
    const connection = await UtilityConnection.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!connection) return res.status(404).json({ error: 'Utility connection not found' });
    res.json(connection);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: environmental -- Environmental Hazards
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/environmental', requireModule('environmental'), async (req, res) => {
  try {
    const hazards = await EnvironmentalHazard.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(hazards);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/environmental', requireAuth, requireRole(...STAFF), requireModule('environmental'), async (req, res) => {
  try {
    const hazard = await EnvironmentalHazard.create({
      property_id: req.params.id,
      hazard_type: req.body.hazard_type,
      description: req.body.description || '',
      severity: req.body.severity || 'Moderate',
      flagged_by: req.session.user.id
    });
    res.status(201).json(hazard);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/environmental/:id', requireAuth, requireRole(...STAFF), requireModule('environmental'), async (req, res) => {
  try {
    const hazard = await EnvironmentalHazard.findByIdAndDelete(req.params.id);
    if (!hazard) return res.status(404).json({ error: 'Hazard not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: landmarks -- Landmark Designations
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/landmark', requireModule('landmarks'), async (req, res) => {
  try {
    const landmark = await Landmark.findOne({ property_id: req.params.id }).lean();
    res.json(landmark || null);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/landmark', requireAuth, requireRole('admin'), requireModule('landmarks'), async (req, res) => {
  try {
    const landmark = await Landmark.create({
      property_id: req.params.id,
      designation: req.body.designation,
      description: req.body.description || '',
      designated_by: req.session.user.id
    });
    res.status(201).json(landmark);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.delete('/landmarks/:id', requireAuth, requireRole('admin'), requireModule('landmarks'), async (req, res) => {
  try {
    const landmark = await Landmark.findByIdAndDelete(req.params.id);
    if (!landmark) return res.status(404).json({ error: 'Landmark not found' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: property_disputes -- Property Disputes
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/disputes', requireModule('property_disputes'), async (req, res) => {
  try {
    const disputes = await PropertyDispute.find({ property_id: req.params.id }).sort({ created_at: -1 }).lean();
    res.json(disputes);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/:id/disputes', requireModule('property_disputes'), async (req, res) => {
  try {
    const dispute = await PropertyDispute.create({
      property_id: req.params.id,
      disputant_name: req.body.disputant_name,
      dispute_type: req.body.dispute_type,
      description: req.body.description || '',
      contact_info: req.body.contact_info || ''
    });
    res.status(201).json(dispute);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.patch('/disputes/:id', requireAuth, requireRole(...STAFF), requireModule('property_disputes'), async (req, res) => {
  try {
    const update = {};
    if (req.body.status) update.status = req.body.status;
    if (req.body.resolution) update.resolution = req.body.resolution;
    if (req.body.assigned_to) update.assigned_to = req.body.assigned_to;
    if (req.body.notes != null) update.notes = req.body.notes;
    const dispute = await PropertyDispute.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!dispute) return res.status(404).json({ error: 'Dispute not found' });
    res.json(dispute);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: public_portal -- Public Property Portal
   ═══════════════════════════════════════════════════ */
router.get('/public-properties', requireModule('public_portal'), async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
    const skip = (page - 1) * limit;

    const filter = {};
    if (req.query.search) {
      const search = { $regex: req.query.search, $options: 'i' };
      filter.$or = [{ name: search }, { address: search }, { parcel_id: search }, { owner_name: search }];
    }
    if (req.query.type) filter.type = req.query.type;
    if (req.query.status) filter.status = req.query.status;
    if (req.query.zone) filter.tax_zone = req.query.zone;

    const total = await Property.countDocuments(filter);
    const properties = await Property.find(filter, 'name parcel_id address type status tax_zone owner_name assessed_value square_footage')
      .sort({ name: 1 })
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({ properties, total, page, pages: Math.ceil(total / limit) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: for_sale_listings -- For Sale Listings
   ═══════════════════════════════════════════════════ */
router.get('/for-sale', requireModule('for_sale_listings'), async (_req, res) => {
  try {
    const properties = await Property.find({ status: 'For Sale' }, 'name parcel_id address type purchase_price assessed_value square_footage').lean();
    res.json(properties);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: tax_calculator -- Tax Estimation Calculator
   ═══════════════════════════════════════════════════ */
router.get('/tax-calculator/estimate', requireModule('tax_calculator'), async (req, res) => {
  try {
    const value = Number(req.query.value) || 0;
    const type = req.query.type || '';
    const zone = req.query.zone || '';

    const presets = await TaxPreset.find().lean();
    let rate = 0.01;
    const matched = presets.find((p) => p.zone === zone || p.name === zone);
    if (matched) rate = Number(matched.rate) || 0.01;

    const annual_tax = value * rate;
    res.json({
      assessed_value: value,
      type,
      zone,
      rate,
      annual_tax: Math.round(annual_tax * 100) / 100,
      formula: `${value} × ${rate} = ${Math.round(annual_tax * 100) / 100}`
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: split_merge -- Property Split & Merge
   ═══════════════════════════════════════════════════ */
router.post('/properties/:id/split', requireAuth, requireRole('admin'), requireModule('split_merge'), async (req, res) => {
  try {
    const original = await Property.findById(req.params.id);
    if (!original) return res.status(404).json({ error: 'Property not found' });

    const dividing_line = req.body.dividing_line;
    const base = original.toObject();
    delete base._id;
    delete base.__v;

    const idA = `${original.parcel_id}-A`;
    const idB = `${original.parcel_id}-B`;

    const propA = await Property.create({
      ...base,
      parcel_id: idA,
      name: `${original.name} (A)`,
      split_from: original._id,
      dividing_line
    });
    const propB = await Property.create({
      ...base,
      parcel_id: idB,
      name: `${original.name} (B)`,
      split_from: original._id,
      dividing_line
    });

    await Property.findByIdAndDelete(original._id);
    res.status(201).json({ original_id: original._id, new_properties: [propA, propB] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.post('/properties/merge', requireAuth, requireRole('admin'), requireModule('split_merge'), async (req, res) => {
  try {
    const { property_ids } = req.body;
    if (!property_ids || property_ids.length !== 2) {
      return res.status(400).json({ error: 'Exactly 2 property_ids required' });
    }

    const propA = await Property.findById(property_ids[0]);
    const propB = await Property.findById(property_ids[1]);
    if (!propA || !propB) return res.status(404).json({ error: 'One or both properties not found' });

    const merged = await Property.create({
      name: `${propA.name} + ${propB.name}`,
      parcel_id: `${propA.parcel_id}-M`,
      address: propA.address,
      type: propA.type,
      owner_name: propA.owner_name,
      assessed_value: (Number(propA.assessed_value) || 0) + (Number(propB.assessed_value) || 0),
      square_footage: (Number(propA.square_footage) || 0) + (Number(propB.square_footage) || 0),
      merged_from: [propA._id, propB._id]
    });

    await Property.findByIdAndDelete(propA._id);
    await Property.findByIdAndDelete(propB._id);
    res.status(201).json({ merged_property: merged, deleted_ids: [propA._id, propB._id] });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: proximity -- Proximity Search
   ═══════════════════════════════════════════════════ */
router.get('/properties/:id/nearby', requireModule('proximity'), async (req, res) => {
  try {
    const radius = Number(req.query.radius) || 500;
    const target = await Property.findById(req.params.id, 'geojson').lean();
    if (!target || !target.geojson?.coordinates?.[0]) {
      return res.status(400).json({ error: 'Property has no geometry' });
    }

    const ring = target.geojson.coordinates[0];
    const centroidLat = ring.reduce((s, c) => s + c[1], 0) / ring.length;
    const centroidLng = ring.reduce((s, c) => s + c[0], 0) / ring.length;

    const props = await Property.find({ _id: { $ne: req.params.id } }, 'name parcel_id address type geojson assessed_value').lean();
    const nearby = [];

    for (const p of props) {
      if (!p.geojson?.coordinates?.[0]) continue;
      const pRing = p.geojson.coordinates[0];
      const pLat = pRing.reduce((s, c) => s + c[1], 0) / pRing.length;
      const pLng = pRing.reduce((s, c) => s + c[0], 0) / pRing.length;
      const dist = Math.sqrt(Math.pow(pLat - centroidLat, 2) + Math.pow(pLng - centroidLng, 2));
      if (dist <= radius) {
        nearby.push({ ...p, distance: Math.round(dist * 100) / 100 });
      }
    }

    nearby.sort((a, b) => a.distance - b.distance);
    res.json(nearby);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

/* ═══════════════════════════════════════════════════
   MODULE: discord_bot -- Discord Bot Endpoints
   ═══════════════════════════════════════════════════ */
router.get('/discord/lookup', requireModule('discord_bot'), async (req, res) => {
  try {
    const { parcel_id } = req.query;
    if (!parcel_id) return res.status(400).json({ error: 'parcel_id required' });
    const property = await Property.findOne({ parcel_id }).lean();
    if (!property) return res.status(404).json({ error: 'Property not found' });
    res.json(property);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/discord/owner', requireModule('discord_bot'), async (req, res) => {
  try {
    const { name } = req.query;
    if (!name) return res.status(400).json({ error: 'name required' });
    const properties = await Property.find({
      $or: [
        { owner_name: { $regex: name, $options: 'i' } },
        { 'residential_owners.name': { $regex: name, $options: 'i' } }
      ]
    }).lean();
    res.json(properties);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

router.get('/discord/tax-owed', requireModule('discord_bot'), async (req, res) => {
  try {
    const { parcel_id } = req.query;
    if (!parcel_id) return res.status(400).json({ error: 'parcel_id required' });
    const property = await Property.findOne({ parcel_id }).lean();
    if (!property) return res.status(404).json({ error: 'Property not found' });

    let tax_info = { parcel_id: property.parcel_id, name: property.name, annual_tax: property.annual_tax || 0 };
    try {
      const bills = await TaxBill.find({ property_id: property._id, status: { $ne: 'Paid' } }).lean();
      if (bills.length > 0) {
        const total_owed = bills.reduce((sum, b) => sum + ((b.amount_due || 0) - (b.amount_paid || 0)), 0);
        tax_info.outstanding_bills = bills.length;
        tax_info.total_owed = total_owed;
      }
    } catch { /* tax_ledger module may not be enabled */ }

    res.json(tax_info);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;

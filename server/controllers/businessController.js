const { listBusinesses, createBusiness, getBusinessById } = require('../models/businessModel');

async function list(req, res) {
  const rows = await listBusinesses();
  res.json(rows);
}

async function create(req, res) {
  const id = await createBusiness(req.body);
  res.status(201).json({ id });
}

async function profile(req, res) {
  const business = await getBusinessById(req.params.id);
  if (!business) return res.status(404).send('Business not found');
  return res.render('businesses/profile', { business });
}

module.exports = { list, create, profile };

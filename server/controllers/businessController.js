const { listBusinesses, createBusiness, getBusinessById, searchBusinesses } = require('../models/businessModel');

async function list(req, res) {
  const rows = await listBusinesses();
  res.json(rows);
}

async function search(req, res) {
  try {
    const rows = await searchBusinesses(req.query.q || '');
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Search failed' });
  }
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

module.exports = { list, create, profile, search };

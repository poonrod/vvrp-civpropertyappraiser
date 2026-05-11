const express = require('express');
const https = require('https');
const { URL } = require('url');
const { requireAuth, requireRole } = require('../middleware/authMiddleware');
const { createRequest, listPendingRequests, markCompleted } = require('../models/propertyRequestModel');
const { getSetting } = require('../models/appSettingModel');

const router = express.Router();

function sendDiscordWebhook(webhookUrl, request) {
  if (!webhookUrl) return;
  const fields = [
    { name: 'Type', value: request.type, inline: true },
    { name: 'Owner', value: request.owner_name || 'N/A', inline: true }
  ];
  if (request.business_name) {
    fields.push({ name: 'Business', value: request.business_name, inline: true });
  }
  if (request.address) fields.push({ name: 'Address', value: request.address, inline: true });
  if (request.postal) fields.push({ name: 'Postal', value: request.postal, inline: true });
  if (request.purchase_price) {
    fields.push({ name: 'Purchase Value', value: `$${Number(request.purchase_price).toLocaleString()}`, inline: true });
  }
  if (request.square_footage) {
    fields.push({ name: 'Square Footage', value: `${Number(request.square_footage).toLocaleString()} sqft`, inline: true });
  }
  if (request.type === 'Residential' && Array.isArray(request.residential_owners) && request.residential_owners.length > 1) {
    const ownerList = request.residential_owners.map((o) => `${o.name} (${o.owner_type})`).join(', ');
    fields.push({ name: 'All Owners', value: ownerList, inline: false });
  }
  if (request.notes) fields.push({ name: 'Notes', value: request.notes, inline: false });

  const embed = {
    title: 'New Property Appraisal Request',
    color: 0x2f80ed,
    fields,
    footer: { text: `Submitted by ${request.discord_name || 'Unknown'}` },
    timestamp: new Date().toISOString()
  };

  const body = JSON.stringify({ embeds: [embed] });
  try {
    const parsed = new URL(webhookUrl);
    const req = https.request({
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    });
    req.on('error', (e) => console.error('[discord-webhook]', e.message));
    req.write(body);
    req.end();
  } catch (e) {
    console.error('[discord-webhook]', e.message);
  }
}

router.post('/', async (req, res) => {
  try {
    const { type, owner_name, discord_name } = req.body;
    if (!type || !owner_name || !discord_name) {
      return res.status(400).json({ error: 'Type, owner name, and your name are required' });
    }
    const doc = await createRequest(req.body);

    const webhookUrl = await getSetting('discord_webhook_url');
    if (webhookUrl) {
      void sendDiscordWebhook(webhookUrl, doc);
    }

    res.status(201).json({ success: true, id: doc._id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not submit request' });
  }
});

router.get('/', requireAuth, requireRole('admin', 'appraiser', 'clerk'), async (req, res) => {
  try {
    const status = req.query.status;
    const { listAllRequests } = require('../models/propertyRequestModel');
    let rows;
    if (status === 'pending') {
      rows = await listPendingRequests();
    } else {
      rows = await listAllRequests();
    }
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not load requests' });
  }
});

router.patch('/:id/complete', requireAuth, requireRole('admin', 'appraiser', 'clerk'), async (req, res) => {
  try {
    await markCompleted(req.params.id);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Could not update request' });
  }
});

module.exports = router;

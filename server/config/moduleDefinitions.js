/**
 * Central registry of all toggleable feature modules.
 * Each module has: key, name, description, category, defaultEnabled.
 * The key is used in the AppSetting `modules` object and in res.locals.modules.
 */

const MODULE_CATEGORIES = [
  { id: 'law', label: 'Law Enforcement & Governance' },
  { id: 'economy', label: 'Economy & Finance' },
  { id: 'rentals', label: 'Rentals & Occupancy' },
  { id: 'property', label: 'Property Details' },
  { id: 'public', label: 'Public-Facing' },
  { id: 'map', label: 'Map & Spatial' },
  { id: 'integration', label: 'Integrations' },
  { id: 'social', label: 'Gamification & Social' }
];

const MODULE_DEFINITIONS = [
  // Law Enforcement & Governance
  { key: 'law_liens', name: 'Warrants & Liens', description: 'Place liens on properties, block transfers while active', category: 'law', defaultEnabled: false },
  { key: 'foreclosure', name: 'Foreclosure System', description: 'Multi-step foreclosure progression with grace periods', category: 'law', defaultEnabled: false },
  { key: 'zoning_permits', name: 'Zoning Permits & Violations', description: 'Zoning change applications and violation tracking', category: 'law', defaultEnabled: false },
  { key: 'eminent_domain', name: 'Eminent Domain', description: 'Government forced acquisition workflow', category: 'law', defaultEnabled: false },
  { key: 'code_enforcement', name: 'Code Enforcement', description: 'Citations for property code violations with fines', category: 'law', defaultEnabled: false },

  // Economy & Finance
  { key: 'tax_ledger', name: 'Tax Ledger', description: 'Per-period tax billing with payment tracking', category: 'economy', defaultEnabled: false },
  { key: 'mortgages', name: 'Mortgages & Loans', description: 'Track mortgage details, lenders, and payments', category: 'economy', defaultEnabled: false },
  { key: 'insurance', name: 'Property Insurance', description: 'Insurance policies, premiums, and claims', category: 'economy', defaultEnabled: false },
  { key: 'auctions', name: 'Property Auctions', description: 'Government auction system for foreclosed properties', category: 'economy', defaultEnabled: false },
  { key: 'tax_exemptions', name: 'Tax Exemptions', description: 'Veteran, senior, nonprofit tax exemptions', category: 'economy', defaultEnabled: false },
  { key: 'market_analytics', name: 'Market Analytics', description: 'Valuation cycles, CMA, and market reports', category: 'economy', defaultEnabled: false },

  // Rentals & Occupancy
  { key: 'leases', name: 'Leases & Rentals', description: 'Track tenants, rent, lease terms and expiry', category: 'rentals', defaultEnabled: false },
  { key: 'access_lists', name: 'Access Control Lists', description: 'Authorized access lists per property', category: 'rentals', defaultEnabled: false },
  { key: 'parking', name: 'Parking & Vehicles', description: 'Parking spaces, garages, and vehicle registry', category: 'rentals', defaultEnabled: false },

  // Property Details
  { key: 'photos', name: 'Property Photos', description: 'Upload images with thumbnails and lightbox', category: 'property', defaultEnabled: false },
  { key: 'inspections', name: 'Property Inspections', description: 'Structured inspection reports and compliance', category: 'property', defaultEnabled: false },
  { key: 'improvements', name: 'Property Improvements', description: 'Renovation requests with value increases', category: 'property', defaultEnabled: false },
  { key: 'damage_reports', name: 'Damage Reports', description: 'Log fire, flood, vandalism damage events', category: 'property', defaultEnabled: false },
  { key: 'utilities', name: 'Utility Connections', description: 'Water, electric, gas, internet tracking', category: 'property', defaultEnabled: false },
  { key: 'environmental', name: 'Environmental Hazards', description: 'Flood zones, contamination, hazard flags', category: 'property', defaultEnabled: false },
  { key: 'landmarks', name: 'Historical Landmarks', description: 'Protected landmark designation and tax incentives', category: 'property', defaultEnabled: false },

  // Public-Facing
  { key: 'public_portal', name: 'Public Property Portal', description: 'Searchable public property table page', category: 'public', defaultEnabled: false },
  { key: 'for_sale_listings', name: 'For Sale Listings', description: 'Dedicated For Sale page with thumbnails', category: 'public', defaultEnabled: false },
  { key: 'tax_calculator', name: 'Public Tax Calculator', description: 'Estimate annual tax by value, type, and zone', category: 'public', defaultEnabled: false },
  { key: 'property_disputes', name: 'Property Disputes', description: 'Citizen dispute filing and resolution', category: 'public', defaultEnabled: false },

  // Map & Spatial
  { key: 'heatmaps', name: 'Heatmap Overlays', description: 'Value density, transaction, and vacancy heatmaps', category: 'map', defaultEnabled: false },
  { key: 'timeline', name: 'Historical Timeline', description: 'Time slider showing property state at past dates', category: 'map', defaultEnabled: false },
  { key: 'annotations', name: 'Map Annotations', description: 'Staff pins for planned developments and POIs', category: 'map', defaultEnabled: false },
  { key: 'districts', name: 'Neighborhood Districts', description: 'Named districts with boundaries and stats', category: 'map', defaultEnabled: false },
  { key: 'split_merge', name: 'Parcel Split & Merge', description: 'Split or merge parcels with history tracking', category: 'map', defaultEnabled: false },
  { key: 'proximity', name: 'Proximity Queries', description: 'Radius search and neighbor finder tools', category: 'map', defaultEnabled: false },
  { key: 'map_labels', name: 'Map Labels', description: 'Show property names as labels on the map', category: 'map', defaultEnabled: false },

  // Integrations
  { key: 'fivem_bridge', name: 'FiveM Lua Bridge', description: 'REST API for in-game script lookups', category: 'integration', defaultEnabled: false },
  { key: 'discord_bot', name: 'Discord Bot Commands', description: 'Slash commands for property lookups', category: 'integration', defaultEnabled: false },
  { key: 'webhook_events', name: 'Outbound Webhooks', description: 'Configurable webhook URLs with event subscriptions', category: 'integration', defaultEnabled: false },
  { key: 'reminders', name: 'Scheduled Reminders', description: 'Date-based property reminders via Discord', category: 'integration', defaultEnabled: false },
  { key: 'audit_digest', name: 'Audit Digest', description: 'Weekly admin action summary to Discord', category: 'integration', defaultEnabled: false },

  // Gamification & Social
  { key: 'staff_notes', name: 'Staff Notes', description: 'Private notes on properties with @mentions', category: 'social', defaultEnabled: false },
  { key: 'leaderboard', name: 'Appraiser Leaderboard', description: 'Staff metrics, weekly rankings, and badges', category: 'social', defaultEnabled: false },
  { key: 'gazette', name: 'Property Gazette', description: 'Auto-generated monthly newsletter', category: 'social', defaultEnabled: false },
  { key: 'seasonal_events', name: 'Seasonal Events', description: 'Holiday contests, seasonal tax discounts', category: 'social', defaultEnabled: false },
  { key: 'bookmarks', name: 'Saved Map Views', description: 'Save and quick-jump to named map states', category: 'social', defaultEnabled: false }
];

function getDefaultModules() {
  const defaults = {};
  for (const m of MODULE_DEFINITIONS) {
    defaults[m.key] = m.defaultEnabled;
  }
  return defaults;
}

function getAllModuleKeys() {
  return MODULE_DEFINITIONS.map((m) => m.key);
}

module.exports = { MODULE_CATEGORIES, MODULE_DEFINITIONS, getDefaultModules, getAllModuleKeys };

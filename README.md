# San Andreas Property Appraiser (SAPA)

Production-ready FiveM RP property ownership tracker built with Express, MySQL, Discord OAuth2, and Leaflet.

## Stack
- Node.js + Express (MVC modules)
- MySQL (`mysql2`)
- Discord OAuth2 (identify scope)
- Leaflet + Leaflet Draw
- EJS + Vanilla JS

## Setup
1. Copy `.env.example` to `.env` and fill Discord + DB values.
2. Run SQL bootstrap: `sql/schema.sql`.
3. Install dependencies: `npm install`
4. Start app: `npm run dev` (or `npm start`)

## Core Features Implemented
- Public map browsing/search with side panel details and transaction timeline.
- Discord-only staff login and role-based permissions.
- Property polygon create/edit/delete API with GeoJSON validation.
- Annual tax calculation (`assessed_value * tax_rate / 100`).
- Business linking and business profile page.
- Admin dashboard: stats, recent properties, audit logs, map upload/reset, SQL export, GeoJSON import.
- User management with role changes and login logs.
- CSV and PDF exports for properties.
- Session auth, CSRF, prepared statements, rate limiting, and security headers.

## Roles
- `admin`: full access
- `appraiser`: draw/edit/delete properties
- `clerk`: edit/transfer property info, no delete
- `user`: public view access

## Project Structure
See `server/`:
- `routes/`
- `controllers/`
- `models/`
- `middleware/`
- `public/`
- `uploads/maps/`
- `views/`
- `config/`


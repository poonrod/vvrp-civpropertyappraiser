# San Andreas Property Appraiser (SAPA)

Production-ready FiveM RP property ownership tracker built with Express, MongoDB, Discord OAuth2, and Leaflet.

## Stack
- Node.js + Express (MVC modules)
- MongoDB (`mongoose`) + `connect-mongo` for sessions
- Discord OAuth2 (identify scope)
- Leaflet + Leaflet Draw
- EJS + Vanilla JS

## Setup
1. Copy `.env.example` to `.env` and fill Discord + `MONGODB_URI` (local MongoDB or Atlas).
2. Install dependencies: `npm install`
3. Start app: `npm run dev` (or `npm start`). Collections are created on first use.

## Core Features Implemented
- Public map browsing/search with side panel details and transaction timeline.
- Discord-only staff login and role-based permissions.
- Property polygon create/edit/delete API with GeoJSON validation.
- Annual tax calculation (`assessed_value * tax_rate / 100`).
- Business linking and business profile page.
- Admin dashboard: stats, recent properties, audit logs, polygon reset, JSON export, GeoJSON import (map image is bundled).
- User management with role changes and login logs.
- CSV and PDF exports for properties.
- Session auth, CSRF, rate limiting, and security headers.

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


# Brigada Ouro – Sistema de Registro de Incêndios Florestais

A PWA (Progressive Web App) for forest fire brigade teams to register, track, and export wildfire incidents.

## Stack

- **Backend:** Node.js + Express, SQLite (via `sqlite3`)
- **Frontend:** Vanilla JS PWA with offline support (service worker)
- **Auth:** JWT tokens (`jsonwebtoken` + `bcryptjs`)
- **Reports:** PDF (`pdfkit`), Excel (`exceljs`), KMZ (`archiver`)
- **Geo:** `@turf/turf` for polygon area calculation

## Running the app

```
cd app && node server.js
```

The server starts on port 5000. The workflow `Start application` handles this automatically.

## Default credentials (demo)

- `admin` / `admin123` — Equipe Alpha
- `brigada1` / `brigada123` — Equipe Beta

## Key routes

| Route | Description |
|-------|-------------|
| `POST /login` | Authenticate, returns JWT |
| `POST /fire` | Register a fire incident (auth required) |
| `GET /dashboard` | All incidents summary |
| `GET /report/:id` | Download PDF report for an incident |
| `GET /export/excel` | Download full Excel export (auth required) |
| `GET /export/kmz` | Download KMZ/KML for Google Earth (auth required) |
| `POST /sync` | Sync offline-recorded incidents (auth required) |

## Data storage

SQLite database at `app/db.sqlite` (auto-created on first run). Schema in `schema.sql` (also used for Cloudflare D1 deployment — see `CLOUDFLARE_SETUP.md`).

## Environment variables

- `SESSION_SECRET` / `JWT_SECRET` — JWT signing key (falls back to a hardcoded dev default if unset)
- `PORT` — server port (default: 5000)

## User preferences

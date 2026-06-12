# CampusRide

CampusRide is a full-stack campus ride management platform built for the "Real-Time Campus Mobility and Ride Management Platform" problem statement from Cult Open Projects 2026.

## Technology Stack

- Frontend: React 19 + Vite
- Backend: Node.js HTTP server with ES modules
- Real-time updates: Server-Sent Events
- Map: Leaflet with OpenStreetMap tiles and live ride overlays
- Auth: signed JWT-style bearer tokens with PBKDF2 password hashing
- Database: local JSON file at `backend/data/db.json`

## Features

- Passenger and driver registration/login
- Driver onboarding with vehicle and permit details
- Driver online/offline availability management
- Available-driver discovery for passengers
- Ride requests with pickup, destination, passenger count, notes, scheduling, and payment mode
- Single-driver ride assignment with conflict protection
- Ride lifecycle: requested, accepted, in progress, completed, cancelled
- Real-time notifications for ride and driver state changes
- Live campus map for passengers and drivers with driver markers, pickup/drop points, and active route lines
- Driver dashboard with completed rides, active rides, earnings, ratings, ride history, and demand insights
- Passenger ratings and written feedback for completed rides
- Basic demand analytics for active demand and popular pickup locations

## Demo Accounts

- Passenger: `aarav@campus.demo` / `demo123`
- Driver: `neha.driver@campus.demo` / `demo123`
- Driver: `kabir.driver@campus.demo` / `demo123`

Seed accounts are created automatically when the backend starts with an empty database.

## Run Locally

Open two terminals in `C:\Users\ASUS\Documents\New project`.

Terminal 1:

```powershell
npm.cmd run dev:backend
```

Terminal 2:

```powershell
npm.cmd run dev:frontend
```

Then open:

```text
http://127.0.0.1:5173/
```

## API Overview

- `POST /api/auth/signup` - create passenger or driver account
- `POST /api/auth/login` - login and receive bearer token
- `GET /api/me` - current user profile
- `GET /api/locations` - campus pickup/drop locations
- `GET /api/drivers/available` - online drivers
- `PATCH /api/drivers/status` - driver availability and current stand
- `GET /api/rides` - rides visible to the current user
- `POST /api/rides` - passenger creates ride request
- `PATCH /api/rides/:id/accept` - driver accepts a requested ride
- `PATCH /api/rides/:id/reject` - driver rejects a requested ride
- `PATCH /api/rides/:id/start` - assigned driver starts ride
- `PATCH /api/rides/:id/complete` - assigned driver completes ride
- `PATCH /api/rides/:id/cancel` - passenger or assigned driver cancels ride
- `POST /api/rides/:id/rating` - passenger rates a completed ride
- `GET /api/analytics/driver` - driver performance dashboard
- `GET /api/analytics/demand` - platform demand summary
- `GET /api/events?token=...` - SSE stream for live updates

## Design Notes

The backend uses a single JSON database for reproducibility during judging. Ride assignment is guarded on the server: only rides in `requested` state without a `driverId` can be accepted, so a ride cannot be assigned to multiple drivers. All lifecycle changes write to a ride timeline and broadcast an SSE event so open passenger and driver dashboards stay synchronized.

See `DESIGN.md` for the architecture, schema, ERD, and design-decision summary.

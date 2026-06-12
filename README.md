# CampusRide

CampusRide is a full-stack, real-time campus mobility platform that coordinates e-rickshaw rides within a university campus. It was built for the **"Real-Time Campus Mobility and Ride Management Platform"** problem statement from **Cult Open Projects 2026**.

---

## The Problem

Large university campuses like IIT Roorkee span several kilometres. Students and staff regularly need to travel between hostels, academic blocks, the library, sports facilities, and the main gate — often carrying bags or in a hurry between classes.

E-rickshaws already operate on many campuses, but the system is entirely informal. Passengers have no way to know where a rickshaw is, whether one is available, or how long they will wait. Drivers have no way to see demand across the campus, leading to idle time in low-demand zones while passengers elsewhere wait.

CampusRide solves this by giving passengers a single interface to request a ride and track it in real time, while giving drivers a dispatch dashboard with live incoming requests, availability controls, and performance analytics — all without any third-party real-time infrastructure.

---

## Features

### For Passengers
- Register and log in with a secure account
- Browse available online drivers on a live campus map
- Request a ride with pickup location, destination, passenger count, notes, scheduled time, and payment method
- Track ride status in real time — requested, accepted, in progress, completed, or cancelled
- Receive instant notifications when a driver accepts or starts a ride
- Rate completed rides and leave written feedback for drivers

### For Drivers
- Register with vehicle details and campus permit information
- Toggle availability between online, offline, and busy
- Set current stand location so passengers can see where you are on the map
- View an incoming ride queue and accept or reject requests
- See the active ride with pickup and destination highlighted on the map
- Access a full performance dashboard: total rides, earnings, average rating, ride history, and popular pickup locations

### Platform-wide
- Live campus map (Leaflet + OpenStreetMap) showing driver positions, pickup points, destinations, and active route lines
- Server-Sent Events keep all open dashboards synchronized instantly after every state change
- Immutable ride timeline — every status change is recorded with a timestamp and actor for auditability
- Conflict-safe ride assignment — the server guarantees a ride cannot be accepted by two drivers simultaneously

---

## Technology Stack

| Layer | Technology |
|---|---|
| Frontend | React 19 + Vite |
| Backend | Node.js (ES modules, no framework) |
| Real-time | Server-Sent Events (SSE) |
| Map | Leaflet with OpenStreetMap tiles |
| Auth | PBKDF2 password hashing + signed bearer tokens |
| Database | Local JSON file (`backend/data/db.json`) |

---

## System Architecture

```
React + Vite (Vercel)
      |
      |  REST JSON API  +  Server-Sent Events
      |
Node.js HTTP Server (Render)
      |
      |  PBKDF2 hashes  +  signed bearer tokens
      |
Local JSON Database (db.json)
```

The frontend opens a persistent SSE connection to `/api/events?token=...` after login. The backend broadcasts a named event after every ride or driver state change. Both the passenger and driver dashboards refresh automatically on every event without polling.

---

## Database Schema

```
users
  id, role (passenger | driver), name, email, phone
  passwordHash, favoriteLocation
  vehicle: { type, plate, seats }
  verification: { idType, idNumber, verified }
  availability: online | offline | busy
  currentLocation, createdAt

rides
  id, passengerId, driverId
  pickup, destination, passengers, note
  scheduledFor, paymentMethod, fare
  status: requested | accepted | in_progress | completed | cancelled
  rejectedDriverIds
  timeline: [{ status, at, by }]
  createdAt, updatedAt

feedback
  id, rideId, passengerId, driverId
  rating (1–5), comment, createdAt

audit
  id, type, payload, createdAt
```

---

## API Reference

### Auth
| Method | Endpoint | Description |
|---|---|---|
| POST | `/api/auth/signup` | Create a passenger or driver account |
| POST | `/api/auth/login` | Login and receive a bearer token |
| GET | `/api/me` | Get current user profile |

### Locations
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/locations` | List all campus pickup and drop locations |

### Drivers
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/drivers/available` | List all online drivers |
| PATCH | `/api/drivers/status` | Update driver availability and current stand |

### Rides
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/rides` | List rides visible to the current user |
| POST | `/api/rides` | Passenger creates a ride request |
| PATCH | `/api/rides/:id/accept` | Driver accepts a requested ride |
| PATCH | `/api/rides/:id/reject` | Driver rejects a requested ride |
| PATCH | `/api/rides/:id/start` | Assigned driver starts the ride |
| PATCH | `/api/rides/:id/complete` | Assigned driver completes the ride |
| PATCH | `/api/rides/:id/cancel` | Passenger or assigned driver cancels the ride |
| POST | `/api/rides/:id/rating` | Passenger rates a completed ride |

### Analytics
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/analytics/driver` | Driver performance stats |
| GET | `/api/analytics/demand` | Platform-wide demand summary |

### Real-time
| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/events?token=...` | SSE stream for live ride and driver events |

---

## Demo Accounts

Seed accounts are created automatically when the backend starts with an empty database.

| Role | Email | Password |
|---|---|---|
| Passenger | `aarav@campus.demo` | `demo123` |
| Driver | `neha.driver@campus.demo` | `demo123` |
| Driver | `kabir.driver@campus.demo` | `demo123` |

---

## Running Locally

### Prerequisites
- Node.js 20 or higher
- npm 9 or higher

### Steps

Clone the repository and install dependencies from the root:

```bash
npm install
```

Open two terminals.

**Terminal 1 — Backend:**
```bash
npm run dev:backend
```

**Terminal 2 — Frontend:**
```bash
npm run dev:frontend
```

Then open `http://localhost:5173` in your browser.

The backend runs on port `3001` by default (or the value of `config.port`). The frontend proxies API requests to it via `VITE_API_URL`.

---

## Environment Variables

### Backend (Render)
| Variable | Description | Example |
|---|---|---|
| `PORT` | Port the server listens on (injected by Render automatically) | `3001` |
| `FRONTEND_URL` | Allowed CORS origin | `https://your-app.vercel.app` |

### Frontend (Vercel)
| Variable | Description | Example |
|---|---|---|
| `VITE_API_URL` | Backend API base URL including `/api` | `https://your-backend.onrender.com/api` |

---

## Deployment

The project is deployed with the backend on **Render** and the frontend on **Vercel**.

### Backend (Render)
- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

### Frontend (Vercel)
- **Root Directory:** `frontend`
- **Framework Preset:** Vite
- **Build Command:** `npm run build`
- **Output Directory:** `dist`

---

## Design Decisions

**Server-Sent Events over WebSockets** — SSE is sufficient for this use case since all real-time updates flow from the server to clients. It requires no extra packages and works within the dependency-light Node.js HTTP stack.

**Conflict-safe ride assignment** — The server checks that a ride is still in `requested` state with no `driverId` before allowing an accept. This prevents two drivers from claiming the same ride even under concurrent requests.

**Immutable ride timeline** — Every status transition appends an entry with the status, timestamp, and acting user ID. This makes debugging and demonstration straightforward and provides a natural audit trail.

**JSON file database** — A local `db.json` keeps the project fully reproducible for judging with zero infrastructure dependencies. The data model is clean enough to migrate to PostgreSQL or MongoDB without structural changes.

**Role-separated UI** — The frontend renders a completely different dashboard depending on whether the logged-in user is a passenger or driver. Each role sees only the controls and data relevant to their workflow.

---

## Project Structure

```
campusride/
├── backend/
│   ├── src/
│   │   ├── server.js        # HTTP server, routing, all API handlers
│   │   ├── config.js        # Port and secret configuration
│   │   ├── data/
│   │   │   └── database.js  # JSON file read/write helpers
│   │   └── utils/
│   │       ├── crypto.js    # PBKDF2 hashing, token sign/verify
│   │       └── http.js      # sendJson, readJson, notFound helpers
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.jsx          # All UI components and dashboards
│   │   ├── api/
│   │   │   └── client.js    # API base URL, fetch wrapper, token storage
│   │   └── styles.css       # All styles
│   └── package.json
├── package.json             # Monorepo workspace root
└── README.md
```

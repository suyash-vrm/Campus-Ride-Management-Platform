# CampusRide Design Document

## Problem Understanding

CampusRide coordinates e-rickshaw rides inside a campus. Passengers need fast ride requests and visibility into status. Drivers need live demand, safe single-driver assignment, availability controls, and performance feedback.

## System Architecture

```text
React + Vite UI
  |  REST JSON API
  |  Server-Sent Events
Node.js HTTP API
  |  PBKDF2 password hashes
  |  signed bearer tokens
Local JSON database
```

The frontend keeps passenger and driver dashboards synchronized by opening `/api/events?token=...`. The backend broadcasts ride and driver events after every state-changing write.

## Database Schema

```text
users
- id
- role: passenger | driver
- name
- email
- phone
- passwordHash
- favoriteLocation
- vehicle: { type, plate, seats }
- verification: { idType, idNumber, verified }
- availability: online | offline | busy
- currentLocation
- createdAt

rides
- id
- passengerId
- driverId
- pickup
- destination
- passengers
- note
- scheduledFor
- paymentMethod
- fare
- status: requested | accepted | in_progress | completed | cancelled
- rejectedDriverIds
- timeline: [{ status, at, by }]
- createdAt
- updatedAt

feedback
- id
- rideId
- passengerId
- driverId
- rating
- comment
- createdAt

audit
- id
- type
- payload
- createdAt
```

## ERD

```text
User(passenger) 1 ---- * Ride
User(driver)    1 ---- * Ride
Ride            1 ---- 0..1 Feedback
User(driver)    1 ---- * Feedback
User(passenger) 1 ---- * Feedback
```

## API Overview

The API is documented in `README.md`. Core domains are authentication, driver availability, ride lifecycle, ratings, SSE events, and analytics.

## Design Decisions

- Server-Sent Events were chosen for real-time updates because the problem statement allows SSE and the current dependency-light Node stack can support it without extra packages.
- Ride assignment is enforced server-side by checking that a ride is still `requested` and has no `driverId` before accepting.
- Ride lifecycle changes append immutable timeline entries for easier debugging and demonstration.
- A local JSON database keeps the project reproducible for judging while preserving a clean data model that can later move to PostgreSQL or MongoDB.
- The UI separates passenger and driver workflows after login so each role sees only the controls needed for the current task.

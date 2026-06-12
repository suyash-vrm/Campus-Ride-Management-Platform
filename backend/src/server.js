import http from "node:http";
import { config } from "./config.js";
import { readDb, writeDb } from "./data/database.js";
import { createToken, hashPassword, verifyPassword, verifyToken } from "./utils/crypto.js";
import { notFound, readJson, sendJson } from "./utils/http.js";

const clients = new Set();

const campusLocations = [
  { id: "lt", name: "Lecture Hall Complex", zone: "Academic", lat: 29.8667, lng: 77.8965 },
  { id: "library", name: "Mahatma Gandhi Central Library", zone: "Academic", lat: 29.8648, lng: 77.8962 },
  { id: "hostel", name: "Rajendra Bhawan", zone: "Hostels", lat: 29.8677, lng: 77.8917 },
  { id: "convocation", name: "Convocation Hall", zone: "Events", lat: 29.8651, lng: 77.8944 },
  { id: "sports", name: "Sports Complex", zone: "Recreation", lat: 29.8701, lng: 77.8948 },
  { id: "main", name: "Main Gate", zone: "Transit", lat: 29.8637, lng: 77.8996 },
  { id: "sac", name: "Student Activity Centre", zone: "Student Life", lat: 29.8689, lng: 77.8976 }
];

function setCors(req, res) {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, OPTIONS");
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function now() {
  return new Date().toISOString();
}

function safeUser(user) {
  if (!user) return null;
  const { passwordHash, ...publicUser } = user;
  return publicUser;
}

function sameUser(a, b) {
  return String(a) === String(b);
}

function broadcast(type, payload = {}) {
  const event = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of clients) {
    client.write(event);
  }
}

async function loadDb() {
  const db = await readDb();
  db.users ||= [];
  db.rides ||= [];
  db.feedback ||= [];
  db.audit ||= [];
  return db;
}

async function persist(db, eventType, payload) {
  db.audit.push({ id: makeId("evt"), type: eventType, payload, createdAt: now() });
  await writeDb(db);
  broadcast(eventType, payload);
}

async function ensureSeedData() {
  const db = await loadDb();
  if (db.users.length) return;

  const createdAt = now();
  db.users.push(
    {
      id: "passenger_demo",
      role: "passenger",
      name: "Aarav Mehta",
      email: "aarav@campus.demo",
      phone: "9876500001",
      passwordHash: hashPassword("demo123"),
      favoriteLocation: "Lecture Hall Complex",
      createdAt
    },
    {
      id: "driver_demo",
      role: "driver",
      name: "Neha Rawat",
      email: "neha.driver@campus.demo",
      phone: "9876500002",
      passwordHash: hashPassword("demo123"),
      vehicle: { type: "E-Rickshaw", plate: "UK 08 ER 2142", seats: 4 },
      verification: { idType: "Campus Mobility Permit", idNumber: "CMP-2026-118", verified: true },
      availability: "online",
      currentLocation: "Main Gate",
      createdAt
    },
    {
      id: "driver_second",
      role: "driver",
      name: "Kabir Singh",
      email: "kabir.driver@campus.demo",
      phone: "9876500003",
      passwordHash: hashPassword("demo123"),
      vehicle: { type: "E-Rickshaw", plate: "UK 08 ER 4420", seats: 4 },
      verification: { idType: "Campus Mobility Permit", idNumber: "CMP-2026-119", verified: true },
      availability: "online",
      currentLocation: "Sports Complex",
      createdAt
    }
  );
  await writeDb(db);
}

async function getContext(req) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  const payload = verifyToken(token);
  if (!payload?.userId) return null;
  const db = await loadDb();
  const user = db.users.find((candidate) => sameUser(candidate.id, payload.userId));
  if (!user) return null;
  return { db, user };
}

function requireFields(body, fields) {
  const missing = fields.filter((field) => !String(body[field] || "").trim());
  return missing.length ? `Missing required fields: ${missing.join(", ")}` : "";
}

function rideForUser(ride, user) {
  if (user.role === "passenger") return sameUser(ride.passengerId, user.id);
  if (user.role === "driver") {
    return !ride.driverId || sameUser(ride.driverId, user.id) || ride.status === "requested";
  }
  return false;
}

function enrichRide(db, ride) {
  const passenger = db.users.find((user) => sameUser(user.id, ride.passengerId));
  const driver = db.users.find((user) => sameUser(user.id, ride.driverId));
  const feedback = db.feedback.find((item) => sameUser(item.rideId, ride.id));
  return {
    ...ride,
    passenger: passenger ? safeUser(passenger) : null,
    driver: driver ? safeUser(driver) : null,
    feedback: feedback || null
  };
}

function driverStats(db, driverId) {
  const driverRides = db.rides.filter((ride) => sameUser(ride.driverId, driverId));
  const completed = driverRides.filter((ride) => ride.status === "completed");
  const active = driverRides.filter((ride) => ["accepted", "in_progress"].includes(ride.status));
  const ratings = db.feedback.filter((item) => sameUser(item.driverId, driverId));
  const averageRating = ratings.length
    ? Number((ratings.reduce((sum, item) => sum + Number(item.rating || 0), 0) / ratings.length).toFixed(1))
    : 0;

  return {
    totalCompleted: completed.length,
    activeRides: active.length,
    totalEarnings: completed.reduce((sum, ride) => sum + Number(ride.fare || 0), 0),
    averageRating,
    ratingCount: ratings.length,
    history: driverRides.slice().reverse().map((ride) => enrichRide(db, ride)),
    feedback: ratings.slice().reverse()
  };
}

function demandAnalytics(db) {
  const pickupCounts = {};
  const hourlyCounts = {};
  for (const ride of db.rides) {
    pickupCounts[ride.pickup] = (pickupCounts[ride.pickup] || 0) + 1;
    const hour = new Date(ride.createdAt).getHours();
    const label = `${String(hour).padStart(2, "0")}:00`;
    hourlyCounts[label] = (hourlyCounts[label] || 0) + 1;
  }
  return {
    popularPickups: Object.entries(pickupCounts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5),
    hourlyDemand: Object.entries(hourlyCounts)
      .map(([hour, count]) => ({ hour, count }))
      .sort((a, b) => a.hour.localeCompare(b.hour)),
    requested: db.rides.filter((ride) => ride.status === "requested").length,
    inMotion: db.rides.filter((ride) => ["accepted", "in_progress"].includes(ride.status)).length,
    completed: db.rides.filter((ride) => ride.status === "completed").length
  };
}

async function handleSignup(res, body) {
  const missing = requireFields(body, ["name", "email", "password", "role"]);
  if (missing) return sendJson(res, 400, { message: missing });
  if (!["passenger", "driver"].includes(body.role)) return sendJson(res, 400, { message: "Invalid role" });

  const db = await loadDb();
  const email = String(body.email).trim().toLowerCase();
  if (db.users.some((user) => user.email === email)) {
    return sendJson(res, 409, { message: "An account with this email already exists" });
  }

  const user = {
    id: makeId(body.role === "driver" ? "drv" : "psg"),
    role: body.role,
    name: String(body.name).trim(),
    email,
    phone: String(body.phone || "").trim(),
    passwordHash: hashPassword(String(body.password)),
    favoriteLocation: String(body.favoriteLocation || "Lecture Hall Complex").trim(),
    createdAt: now()
  };

  if (body.role === "driver") {
    user.vehicle = {
      type: String(body.vehicleType || "E-Rickshaw").trim(),
      plate: String(body.plate || "").trim(),
      seats: Number(body.seats || 4)
    };
    user.verification = {
      idType: String(body.idType || "Campus Mobility Permit").trim(),
      idNumber: String(body.idNumber || "").trim(),
      verified: Boolean(body.idNumber || body.plate)
    };
    user.availability = "offline";
    user.currentLocation = String(body.currentLocation || "Main Gate").trim();
  }

  db.users.push(user);
  await persist(db, "user:created", { user: safeUser(user) });
  return sendJson(res, 201, { token: createToken({ userId: user.id }), user: safeUser(user) });
}

async function handleLogin(res, body) {
  const db = await loadDb();
  const email = String(body.email || "").trim().toLowerCase();
  const user = db.users.find((candidate) => candidate.email === email);
  if (!user || !verifyPassword(String(body.password || ""), user.passwordHash)) {
    return sendJson(res, 401, { message: "Invalid email or password" });
  }
  return sendJson(res, 200, { token: createToken({ userId: user.id }), user: safeUser(user) });
}

function streamEvents(req, res, token) {
  const payload = verifyToken(token);
  if (!payload?.userId) return sendJson(res, 401, { message: "Authentication required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": req.headers.origin || "*"
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ ok: true, at: now() })}\n\n`);
  clients.add(res);
  req.on("close", () => clients.delete(res));
}

async function router(req, res) {
  setCors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  if (req.method === "GET" && url.pathname === "/api/events") return streamEvents(req, res, url.searchParams.get("token"));

  const body = ["POST", "PATCH", "PUT"].includes(req.method) ? await readJson(req) : {};
  if (req.method === "POST" && url.pathname === "/api/auth/signup") return handleSignup(res, body);
  if (req.method === "POST" && url.pathname === "/api/auth/login") return handleLogin(res, body);
  if (req.method === "GET" && url.pathname === "/api/locations") return sendJson(res, 200, { locations: campusLocations });

  const context = await getContext(req);
  if (!context) return sendJson(res, 401, { message: "Authentication required" });
  const { db, user } = context;

  if (req.method === "GET" && url.pathname === "/api/me") {
    return sendJson(res, 200, { user: safeUser(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/drivers/available") {
    const drivers = db.users
      .filter((candidate) => candidate.role === "driver" && candidate.availability === "online")
      .map((driver) => ({ ...safeUser(driver), stats: driverStats(db, driver.id) }));
    return sendJson(res, 200, { drivers });
  }

  if (req.method === "PATCH" && url.pathname === "/api/drivers/status") {
    if (user.role !== "driver") return sendJson(res, 403, { message: "Only drivers can update availability" });
    user.availability = body.availability === "online" ? "online" : "offline";
    user.currentLocation = String(body.currentLocation || user.currentLocation || "Main Gate");
    await persist(db, "driver:availability", { driver: safeUser(user) });
    return sendJson(res, 200, { user: safeUser(user) });
  }

  if (req.method === "GET" && url.pathname === "/api/rides") {
    const rides = db.rides.filter((ride) => rideForUser(ride, user)).map((ride) => enrichRide(db, ride)).reverse();
    return sendJson(res, 200, { rides });
  }

  if (req.method === "POST" && url.pathname === "/api/rides") {
    if (user.role !== "passenger") return sendJson(res, 403, { message: "Only passengers can request rides" });
    const missing = requireFields(body, ["pickup", "destination"]);
    if (missing) return sendJson(res, 400, { message: missing });
    if (body.pickup === body.destination) return sendJson(res, 400, { message: "Pickup and destination must be different" });

    const ride = {
      id: makeId("ride"),
      passengerId: user.id,
      driverId: null,
      pickup: String(body.pickup).trim(),
      destination: String(body.destination).trim(),
      passengers: Number(body.passengers || 1),
      note: String(body.note || "").trim(),
      scheduledFor: body.scheduledFor ? String(body.scheduledFor) : null,
      paymentMethod: String(body.paymentMethod || "UPI on arrival"),
      fare: Number(body.fare || 35),
      status: "requested",
      rejectedDriverIds: [],
      timeline: [{ status: "requested", at: now(), by: user.id }],
      createdAt: now(),
      updatedAt: now()
    };
    db.rides.push(ride);
    await persist(db, "ride:requested", { ride: enrichRide(db, ride) });
    return sendJson(res, 201, { ride: enrichRide(db, ride) });
  }

  const rideAction = url.pathname.match(/^\/api\/rides\/([^/]+)\/([^/]+)$/);
  if (rideAction) {
    const [, rideId, action] = rideAction;
    const ride = db.rides.find((candidate) => sameUser(candidate.id, rideId));
    if (!ride) return sendJson(res, 404, { message: "Ride not found" });

    if (action === "accept" && req.method === "PATCH") {
      if (user.role !== "driver") return sendJson(res, 403, { message: "Only drivers can accept rides" });
      if (ride.status !== "requested" || ride.driverId) {
        return sendJson(res, 409, { message: "This ride is already assigned" });
      }
      ride.driverId = user.id;
      ride.status = "accepted";
      ride.updatedAt = now();
      ride.timeline.push({ status: "accepted", at: ride.updatedAt, by: user.id });
      user.availability = "busy";
      await persist(db, "ride:accepted", { ride: enrichRide(db, ride) });
      return sendJson(res, 200, { ride: enrichRide(db, ride) });
    }

    if (action === "reject" && req.method === "PATCH") {
      if (user.role !== "driver") return sendJson(res, 403, { message: "Only drivers can reject rides" });
      ride.rejectedDriverIds ||= [];
      if (!ride.rejectedDriverIds.includes(user.id)) ride.rejectedDriverIds.push(user.id);
      ride.updatedAt = now();
      await persist(db, "ride:rejected", { ride: enrichRide(db, ride), driverId: user.id });
      return sendJson(res, 200, { ride: enrichRide(db, ride) });
    }

    if (action === "start" && req.method === "PATCH") {
      if (!sameUser(ride.driverId, user.id)) return sendJson(res, 403, { message: "Only the assigned driver can start this ride" });
      if (ride.status !== "accepted") return sendJson(res, 409, { message: "Ride must be accepted before it can start" });
      ride.status = "in_progress";
      ride.updatedAt = now();
      ride.timeline.push({ status: "in_progress", at: ride.updatedAt, by: user.id });
      await persist(db, "ride:started", { ride: enrichRide(db, ride) });
      return sendJson(res, 200, { ride: enrichRide(db, ride) });
    }

    if (action === "complete" && req.method === "PATCH") {
      if (!sameUser(ride.driverId, user.id)) return sendJson(res, 403, { message: "Only the assigned driver can complete this ride" });
      if (ride.status !== "in_progress") return sendJson(res, 409, { message: "Ride must be in progress before completion" });
      ride.status = "completed";
      ride.updatedAt = now();
      ride.timeline.push({ status: "completed", at: ride.updatedAt, by: user.id });
      user.availability = "online";
      user.currentLocation = ride.destination;
      await persist(db, "ride:completed", { ride: enrichRide(db, ride) });
      return sendJson(res, 200, { ride: enrichRide(db, ride) });
    }

    if (action === "cancel" && req.method === "PATCH") {
      const canCancel = sameUser(ride.passengerId, user.id) || sameUser(ride.driverId, user.id);
      if (!canCancel) return sendJson(res, 403, { message: "You cannot cancel this ride" });
      if (["completed", "cancelled"].includes(ride.status)) return sendJson(res, 409, { message: "Ride is already closed" });
      ride.status = "cancelled";
      ride.updatedAt = now();
      ride.timeline.push({ status: "cancelled", at: ride.updatedAt, by: user.id });
      const driver = db.users.find((candidate) => sameUser(candidate.id, ride.driverId));
      if (driver) driver.availability = "online";
      await persist(db, "ride:cancelled", { ride: enrichRide(db, ride) });
      return sendJson(res, 200, { ride: enrichRide(db, ride) });
    }

    if (action === "rating" && req.method === "POST") {
      if (!sameUser(ride.passengerId, user.id)) return sendJson(res, 403, { message: "Only the passenger can rate this ride" });
      if (ride.status !== "completed") return sendJson(res, 409, { message: "Only completed rides can be rated" });
      if (!ride.driverId) return sendJson(res, 409, { message: "Ride has no driver" });
      if (db.feedback.some((item) => sameUser(item.rideId, ride.id))) return sendJson(res, 409, { message: "Ride already rated" });
      const rating = Math.max(1, Math.min(5, Number(body.rating || 5)));
      const feedback = {
        id: makeId("fb"),
        rideId: ride.id,
        passengerId: user.id,
        driverId: ride.driverId,
        rating,
        comment: String(body.comment || "").trim(),
        createdAt: now()
      };
      db.feedback.push(feedback);
      await persist(db, "ride:rated", { ride: enrichRide(db, ride), feedback });
      return sendJson(res, 201, { feedback });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/analytics/driver") {
    if (user.role !== "driver") return sendJson(res, 403, { message: "Only drivers can view driver analytics" });
    return sendJson(res, 200, { stats: driverStats(db, user.id) });
  }

  if (req.method === "GET" && url.pathname === "/api/analytics/demand") {
    return sendJson(res, 200, { analytics: demandAnalytics(db) });
  }

  return notFound(res);
}

await ensureSeedData();

const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (error) {
    console.error(error);
    return sendJson(res, 500, { message: "Internal server error" });
  }
});

server.listen(config.port, "0.0.0.0", () => {
  console.log(`CampusRide API running on http://0.0.0.0:${config.port}`);
});

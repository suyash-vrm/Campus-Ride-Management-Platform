import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { API_BASE_URL, apiRequest, clearToken, getToken, setToken } from "./api/client.js";

const statusLabels = {
  requested: "Requested",
  accepted: "Accepted",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled"
};

const statusTone = {
  requested: "amber",
  accepted: "blue",
  in_progress: "green",
  completed: "slate",
  cancelled: "red"
};

const IITR_CENTER = [29.8667, 77.8965];
const IITR_BOUNDS = [
  [29.8605, 77.888],
  [29.872, 77.9035]
];

function todayInputValue(hoursAhead = 0) {
  const date = new Date(Date.now() + hoursAhead * 60 * 60 * 1000);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function formatTime(value) {
  if (!value) return "Now";
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function money(value) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(value || 0);
}

function getLocationPoint(locations, name) {
  return locations.find((location) => location.name === name);
}

function makeMapIcon(type, label) {
  return L.divIcon({
    className: `campusMapIcon ${type}`,
    html: `<span>${label}</span>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -14]
  });
}

function CampusMap({ user, locations, rides, drivers, selectedPickup, selectedDestination }) {
  const mapElementRef = useRef(null);
  const mapRef = useRef(null);
  const layerRef = useRef(null);

  const activeRides = rides.filter((ride) => ["requested", "accepted", "in_progress"].includes(ride.status));
  const routeRides = activeRides.length
    ? activeRides
    : selectedPickup && selectedDestination
      ? [{ id: "draft", pickup: selectedPickup, destination: selectedDestination, status: "requested" }]
      : [];
  const visibleDrivers = user.role === "driver"
    ? [{ ...user, currentLocation: user.currentLocation || selectedPickup || "Main Gate" }, ...drivers.filter((driver) => driver.id !== user.id)]
    : drivers;

  useEffect(() => {
    if (!mapElementRef.current || mapRef.current) return;

    const map = L.map(mapElementRef.current, {
      center: IITR_CENTER,
      zoom: 16,
      minZoom: 14,
      maxZoom: 19,
      scrollWheelZoom: true
    });

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
    }).addTo(map);

    map.fitBounds(IITR_BOUNDS, { padding: [18, 18] });
    mapRef.current = map;
    layerRef.current = L.layerGroup().addTo(map);

    return () => {
      map.remove();
      mapRef.current = null;
      layerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!mapRef.current || !layerRef.current) return;
    const layer = layerRef.current;
    layer.clearLayers();

    locations.forEach((location) => {
      L.marker([location.lat, location.lng], { icon: makeMapIcon("location", "") })
        .bindTooltip(location.name, { permanent: false, direction: "top" })
        .addTo(layer);
    });

    routeRides.forEach((ride) => {
      const pickup = getLocationPoint(locations, ride.pickup);
      const destination = getLocationPoint(locations, ride.destination);
      if (!pickup || !destination) return;
      const color = ride.status === "in_progress" ? "#1f8a62" : ride.status === "accepted" ? "#2d76b7" : "#e0a900";
      L.polyline([[pickup.lat, pickup.lng], [destination.lat, destination.lng]], {
        color,
        weight: 5,
        opacity: 0.88,
        dashArray: "8 8"
      }).addTo(layer);
      L.marker([pickup.lat, pickup.lng], { icon: makeMapIcon("pickup", "P") })
        .bindPopup(`<strong>Pickup</strong><br>${pickup.name}`)
        .addTo(layer);
      L.marker([destination.lat, destination.lng], { icon: makeMapIcon("destination", "D") })
        .bindPopup(`<strong>Destination</strong><br>${destination.name}`)
        .addTo(layer);
    });

    visibleDrivers.forEach((driver) => {
      const location = getLocationPoint(locations, driver.currentLocation);
      if (!location) return;
      L.marker([location.lat, location.lng], { icon: makeMapIcon("driver", "R") })
        .bindPopup(`<strong>${driver.name}</strong><br>${driver.currentLocation}<br>${driver.vehicle?.plate || "Campus driver"}`)
        .addTo(layer);
    });
  }, [locations, routeRides, visibleDrivers]);

  return (
    <section className="mapPanel">
      <div className="sectionHead">
        <div>
          <p className="eyebrow">Live campus map</p>
          <h2>Drivers, pickups, and active routes</h2>
        </div>
        <span className="mapPulse">Live</span>
      </div>

      <div className="mapCanvas" aria-label="Live IIT Roorkee ride map">
        <div ref={mapElementRef} className="leafletMap" />
        <div className="mapLegend">
          <span><i className="legendDriver" /> Driver</span>
          <span><i className="legendPickup" /> Pickup</span>
          <span><i className="legendDrop" /> Destination</span>
        </div>
      </div>
    </section>
  );
}

function AuthScreen({ onAuthed }) {
  const [mode, setMode] = useState("login");
  const [role, setRole] = useState("passenger");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    name: "",
    email: "aarav@campus.demo",
    password: "demo123",
    phone: "",
    vehicleType: "E-Rickshaw",
    plate: "",
    idNumber: "",
    currentLocation: "Main Gate"
  });

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const payload =
        mode === "login"
          ? { email: form.email, password: form.password }
          : { ...form, role };
      const data = await apiRequest(`/auth/${mode === "login" ? "login" : "signup"}`, {
        method: "POST",
        body: JSON.stringify(payload)
      });
      setToken(data.token);
      onAuthed(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function useDemo(nextRole) {
    setMode("login");
    setRole(nextRole);
    setForm((current) => ({
      ...current,
      email: nextRole === "driver" ? "neha.driver@campus.demo" : "aarav@campus.demo",
      password: "demo123"
    }));
  }

  return (
    <main className="authShell">
      <section className="authBrand">
        <div className="brandMark">CR</div>
        <p className="eyebrow">Real-time campus mobility</p>
        <h1>CampusRide</h1>
        <p className="lead">
          Request, assign, track, complete, and rate campus rides with live state updates for passengers and drivers.
        </p>
       
      </section>

      <section className="authPanel">
        <div className="segmented">
          <button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")} type="button">Login</button>
          <button className={mode === "signup" ? "active" : ""} onClick={() => setMode("signup")} type="button">Register</button>
        </div>

        <form onSubmit={submit} className="stack">
          {mode === "signup" && (
            <>
              <div className="roleGrid">
                <button className={role === "passenger" ? "role active" : "role"} type="button" onClick={() => setRole("passenger")}>
                  <span>Passenger</span>
                  <small>Request campus rides</small>
                </button>
                <button className={role === "driver" ? "role active" : "role"} type="button" onClick={() => setRole("driver")}>
                  <span>Driver</span>
                  <small>Accept and manage rides</small>
                </button>
              </div>
              <label>Name<input value={form.name} onChange={(e) => update("name", e.target.value)} required /></label>
              <label>Phone<input value={form.phone} onChange={(e) => update("phone", e.target.value)} /></label>
            </>
          )}

          <label>Email<input type="email" value={form.email} onChange={(e) => update("email", e.target.value)} required /></label>
          <label>Password<input type="password" value={form.password} onChange={(e) => update("password", e.target.value)} required /></label>

          {mode === "signup" && role === "driver" && (
            <div className="driverFields">
              <label>Vehicle type<input value={form.vehicleType} onChange={(e) => update("vehicleType", e.target.value)} /></label>
              <label>Plate number<input value={form.plate} onChange={(e) => update("plate", e.target.value)} /></label>
              <label>Permit number<input value={form.idNumber} onChange={(e) => update("idNumber", e.target.value)} /></label>
              <label>Current location<input value={form.currentLocation} onChange={(e) => update("currentLocation", e.target.value)} /></label>
            </div>
          )}

          {error && <p className="error">{error}</p>}
          <button className="primaryButton" disabled={loading}>{loading ? "Working..." : mode === "login" ? "Enter dashboard" : "Create account"}</button>
        </form>

        <div className="demoBar">
          <button type="button" onClick={() => useDemo("passenger")}>Passenger demo</button>
          <button type="button" onClick={() => useDemo("driver")}>Driver demo</button>
        </div>
      </section>
    </main>
  );
}

function StatCard({ label, value, detail }) {
  return (
    <div className="statCard">
      <span>{label}</span>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function RideCard({ ride, user, onAction, onRate }) {
  const canPassengerCancel = user.role === "passenger" && ride.passengerId === user.id && ["requested", "accepted"].includes(ride.status);
  const canDriverAccept = user.role === "driver" && ride.status === "requested" && !ride.rejectedDriverIds?.includes(user.id);
  const canDriverStart = user.role === "driver" && ride.driverId === user.id && ride.status === "accepted";
  const canDriverComplete = user.role === "driver" && ride.driverId === user.id && ride.status === "in_progress";
  const canRate = user.role === "passenger" && ride.passengerId === user.id && ride.status === "completed" && !ride.feedback;

  return (
    <article className="rideCard">
      <div className="rideTop">
        <span className={`pill ${statusTone[ride.status] || "slate"}`}>{statusLabels[ride.status] || ride.status}</span>
        <strong>{money(ride.fare)}</strong>
      </div>
      <div className="routeLine">
        <span>{ride.pickup}</span>
        <span className="routeArrow">to</span>
        <span>{ride.destination}</span>
      </div>
      <div className="rideMeta">
        <span>{ride.passengers} passenger{ride.passengers > 1 ? "s" : ""}</span>
        <span>{formatTime(ride.scheduledFor || ride.createdAt)}</span>
        <span>{ride.paymentMethod}</span>
      </div>
      {ride.driver && <p className="softText">Driver: {ride.driver.name} - {ride.driver.vehicle?.plate}</p>}
      {ride.passenger && user.role === "driver" && <p className="softText">Passenger: {ride.passenger.name} - {ride.passenger.phone || "No phone"}</p>}
      {ride.note && <p className="note">{ride.note}</p>}
      {ride.feedback && <p className="ratingLine">Rated {ride.feedback.rating}/5 {ride.feedback.comment ? `- ${ride.feedback.comment}` : ""}</p>}

      <div className="actions">
        {canDriverAccept && <button onClick={() => onAction(ride.id, "accept")}>Accept</button>}
        {canDriverAccept && <button className="ghostButton" onClick={() => onAction(ride.id, "reject")}>Reject</button>}
        {canDriverStart && <button onClick={() => onAction(ride.id, "start")}>Start ride</button>}
        {canDriverComplete && <button onClick={() => onAction(ride.id, "complete")}>Complete</button>}
        {canPassengerCancel && <button className="ghostButton" onClick={() => onAction(ride.id, "cancel")}>Cancel</button>}
        {canRate && <button onClick={() => onRate(ride)}>Rate ride</button>}
      </div>
    </article>
  );
}

function PassengerDashboard({ user, locations, rides, drivers, analytics, refresh }) {
  const [form, setForm] = useState({
    pickup: "Lecture Hall Complex",
    destination: "Main Gate",
    passengers: 1,
    scheduledFor: "",
    paymentMethod: "UPI on arrival",
    note: ""
  });
  const [ratingRide, setRatingRide] = useState(null);
  const [rating, setRating] = useState({ rating: 5, comment: "" });
  const activeRide = rides.find((ride) => ["requested", "accepted", "in_progress"].includes(ride.status));

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function requestRide(event) {
    event.preventDefault();
    await apiRequest("/rides", {
      method: "POST",
      body: JSON.stringify({ ...form, fare: 30 + Number(form.passengers) * 10 })
    });
    setForm((current) => ({ ...current, note: "", scheduledFor: "" }));
    refresh();
  }

  async function submitRating(event) {
    event.preventDefault();
    await apiRequest(`/rides/${ratingRide.id}/rating`, {
      method: "POST",
      body: JSON.stringify(rating)
    });
    setRatingRide(null);
    setRating({ rating: 5, comment: "" });
    refresh();
  }

  return (
    <>
      <section className="dashboardGrid">
        <div className="workspace">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Passenger console</p>
              <h2>Book a campus ride</h2>
            </div>
            {activeRide && <span className={`pill ${statusTone[activeRide.status]}`}>{statusLabels[activeRide.status]}</span>}
          </div>
          <form className="rideForm" onSubmit={requestRide}>
            <label>Pickup<select value={form.pickup} onChange={(e) => update("pickup", e.target.value)}>{locations.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
            <label>Destination<select value={form.destination} onChange={(e) => update("destination", e.target.value)}>{locations.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
            <label>Passengers<input type="number" min="1" max="4" value={form.passengers} onChange={(e) => update("passengers", e.target.value)} /></label>
            <label>Schedule<input type="datetime-local" min={todayInputValue()} value={form.scheduledFor} onChange={(e) => update("scheduledFor", e.target.value)} /></label>
            <label>Payment<select value={form.paymentMethod} onChange={(e) => update("paymentMethod", e.target.value)}><option>UPI on arrival</option><option>QR payment</option><option>Campus wallet</option><option>Cash</option></select></label>
            <label className="wide">Note<textarea value={form.note} onChange={(e) => update("note", e.target.value)} placeholder="Gate number, luggage, accessibility needs..." /></label>
            <button className="primaryButton wide" disabled={form.pickup === form.destination}>Request ride</button>
          </form>
        </div>

        <aside className="sidePanel">
          <h3>Available drivers</h3>
          <div className="driverList">
            {drivers.map((driver) => (
              <div className="driverRow" key={driver.id}>
                <div>
                  <strong>{driver.name}</strong>
                  <span>{driver.currentLocation} - {driver.vehicle?.plate}</span>
                </div>
                <span className="score">{driver.stats.averageRating || "New"}</span>
              </div>
            ))}
            {!drivers.length && <p className="softText">No drivers are online yet.</p>}
          </div>
        </aside>
      </section>

      <CampusMap
        user={user}
        locations={locations}
        rides={rides}
        drivers={drivers}
        selectedPickup={form.pickup}
        selectedDestination={form.destination}
      />

      <section className="contentBand">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Ride history</p>
            <h2>Your requests</h2>
          </div>
          <span>{rides.length} rides</span>
        </div>
        <div className="rideGrid">
          {rides.map((ride) => <RideCard key={ride.id} ride={ride} user={user} onAction={rideAction} onRate={setRatingRide} />)}
          {!rides.length && <p className="emptyState">Request your first campus ride to see it tracked here.</p>}
        </div>
      </section>

      <section className="analyticsStrip">
        <StatCard label="Requested now" value={analytics.requested || 0} />
        <StatCard label="In motion" value={analytics.inMotion || 0} />
        <StatCard label="Completed" value={analytics.completed || 0} />
      </section>

      {ratingRide && (
        <div className="modalBackdrop">
          <form className="modal" onSubmit={submitRating}>
            <h3>Rate {ratingRide.driver?.name}</h3>
            <label>Rating<input type="range" min="1" max="5" value={rating.rating} onChange={(e) => setRating((current) => ({ ...current, rating: Number(e.target.value) }))} /></label>
            <strong>{rating.rating}/5</strong>
            <label>Feedback<textarea value={rating.comment} onChange={(e) => setRating((current) => ({ ...current, comment: e.target.value }))} /></label>
            <div className="actions"><button>Submit rating</button><button className="ghostButton" type="button" onClick={() => setRatingRide(null)}>Close</button></div>
          </form>
        </div>
      )}
    </>
  );

  async function rideAction(id, action) {
    await apiRequest(`/rides/${id}/${action}`, { method: "PATCH", body: JSON.stringify({}) });
    refresh();
  }
}

function DriverDashboard({ user, locations, rides, stats, analytics, refresh, onUserUpdate }) {
  const [location, setLocation] = useState(user.currentLocation || "Main Gate");
  const queue = rides.filter((ride) => ride.status === "requested" && !ride.rejectedDriverIds?.includes(user.id));
  const assigned = rides.filter((ride) => ride.driverId === user.id && ["accepted", "in_progress"].includes(ride.status));

  async function setAvailability(availability) {
    const data = await apiRequest("/drivers/status", {
      method: "PATCH",
      body: JSON.stringify({ availability, currentLocation: location })
    });
    onUserUpdate(data.user);
    refresh();
  }

  async function rideAction(id, action) {
    await apiRequest(`/rides/${id}/${action}`, { method: "PATCH", body: JSON.stringify({}) });
    refresh();
  }

  return (
    <>
      <section className="analyticsStrip">
        <StatCard label="Completed rides" value={stats.totalCompleted || 0} />
        <StatCard label="Active rides" value={stats.activeRides || 0} />
        <StatCard label="Total earnings" value={money(stats.totalEarnings || 0)} />
        <StatCard label="Rating" value={stats.averageRating ? `${stats.averageRating}/5` : "New"} detail={`${stats.ratingCount || 0} reviews`} />
      </section>

      <section className="dashboardGrid">
        <div className="workspace">
          <div className="sectionHead">
            <div>
              <p className="eyebrow">Driver dispatch</p>
              <h2>Incoming ride queue</h2>
            </div>
            <span className={`pill ${user.availability === "online" ? "green" : user.availability === "busy" ? "blue" : "slate"}`}>{user.availability || "offline"}</span>
          </div>
          <div className="rideGrid compact">
            {[...assigned, ...queue].map((ride) => <RideCard key={ride.id} ride={ride} user={user} onAction={rideAction} />)}
            {!assigned.length && !queue.length && <p className="emptyState">No open requests right now. Stay online to receive live assignments.</p>}
          </div>
        </div>

        <aside className="sidePanel">
          <h3>Availability</h3>
          <label>Current stand<select value={location} onChange={(e) => setLocation(e.target.value)}>{locations.map((item) => <option key={item.id}>{item.name}</option>)}</select></label>
          <div className="availabilityButtons">
            <button onClick={() => setAvailability("online")}>Go online</button>
            <button className="ghostButton" onClick={() => setAvailability("offline")}>Go offline</button>
          </div>
          <div className="vehicleCard">
            <span>{user.vehicle?.type || "Vehicle"}</span>
            <strong>{user.vehicle?.plate || "Plate pending"}</strong>
            <small>{user.verification?.verified ? "Verified driver" : "Verification pending"}</small>
          </div>
        </aside>
      </section>

      <CampusMap
        user={user}
        locations={locations}
        rides={rides}
        drivers={[]}
        selectedPickup={location}
        selectedDestination={assigned[0]?.destination}
      />

      <section className="contentBand">
        <div className="sectionHead">
          <div>
            <p className="eyebrow">Performance</p>
            <h2>Ride history and demand</h2>
          </div>
        </div>
        <div className="twoColumn">
          <div className="tablePanel">
            {stats.history?.slice(0, 6).map((ride) => (
              <div className="historyRow" key={ride.id}>
                <span>{ride.pickup} to {ride.destination}</span>
                <strong>{statusLabels[ride.status]}</strong>
              </div>
            ))}
            {!stats.history?.length && <p className="softText">Completed and active rides will appear here.</p>}
          </div>
          <div className="chartPanel">
            <h3>Popular pickups</h3>
            {(analytics.popularPickups || []).map((item) => (
              <div className="barRow" key={item.name}>
                <span>{item.name}</span>
                <div><i style={{ width: `${Math.max(12, item.count * 24)}px` }} /></div>
                <strong>{item.count}</strong>
              </div>
            ))}
            {!analytics.popularPickups?.length && <p className="softText">Demand analytics build as rides are requested.</p>}
          </div>
        </div>
      </section>
    </>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [locations, setLocations] = useState([]);
  const [rides, setRides] = useState([]);
  const [drivers, setDrivers] = useState([]);
  const [stats, setStats] = useState({});
  const [analytics, setAnalytics] = useState({});
  const [toast, setToast] = useState("");
  const [booting, setBooting] = useState(Boolean(getToken()));

  const eventUrl = useMemo(() => {
    const token = getToken();
    return token ? `${API_BASE_URL}/events?token=${encodeURIComponent(token)}` : "";
  }, [user?.id]);

  useEffect(() => {
    apiRequest("/locations").then((data) => setLocations(data.locations)).catch(() => {});
    if (!getToken()) return setBooting(false);
    apiRequest("/me")
      .then((data) => setUser(data.user))
      .catch(() => clearToken())
      .finally(() => setBooting(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    refresh();
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!eventUrl) return;
    const source = new EventSource(eventUrl);
    const handler = (event) => {
      const label = event.type.replace("ride:", "Ride ").replace("driver:", "Driver ");
      setToast(label);
      refresh();
    };
    ["ride:requested", "ride:accepted", "ride:started", "ride:completed", "ride:cancelled", "ride:rated", "driver:availability"].forEach((event) => {
      source.addEventListener(event, handler);
    });
    return () => source.close();
  }, [eventUrl]);

  async function refresh() {
    const calls = [apiRequest("/rides"), apiRequest("/drivers/available"), apiRequest("/analytics/demand")];
    if (user?.role === "driver") calls.push(apiRequest("/analytics/driver"));
    const [ridesData, driversData, demandData, driverStats] = await Promise.all(calls);
    setRides(ridesData.rides || []);
    setDrivers(driversData.drivers || []);
    setAnalytics(demandData.analytics || {});
    if (driverStats) setStats(driverStats.stats || {});
  }

  function logout() {
    clearToken();
    setUser(null);
    setRides([]);
    setStats({});
  }

  if (booting) return <div className="loadingScreen">Starting CampusRide...</div>;
  if (!user) return <AuthScreen onAuthed={setUser} />;

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="brandCluster">
          <div className="brandMark small">CR</div>
          <div>
            <strong>CampusRide</strong>
            <span>{user.role === "driver" ? "Driver operations" : "Passenger mobility"}</span>
          </div>
        </div>
        <div className="userCluster">
          {toast && <span className="liveToast">{toast}</span>}
          <span>{user.name}</span>
          <button className="ghostButton" onClick={logout}>Logout</button>
        </div>
      </header>

      {user.role === "driver" ? (
        <DriverDashboard user={user} locations={locations} rides={rides} stats={stats} analytics={analytics} refresh={refresh} onUserUpdate={setUser} />
      ) : (
        <PassengerDashboard user={user} locations={locations} rides={rides} drivers={drivers} analytics={analytics} refresh={refresh} />
      )}
    </main>
  );
}

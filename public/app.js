const apiBase = window.VROOM_CONFIG.gatewayUrl || "";
const healthPath = window.VROOM_CONFIG.gatewayUrl ? "/health" : "/gateway-health";
const appChannelName = "vroom-ui-events";

const state = {
  panelRole: "rider",
  role: null,
  rider: null,
  driver: null,
  riders: [],
  drivers: [],
  trip: null
};

const els = {
  gatewayStatus: document.querySelector("#gatewayStatus"),
  sessionStatus: document.querySelector("#sessionStatus"),
  showRegister: document.querySelector("#showRegister"),
  authTitle: document.querySelector("#authTitle"),
  registrationTitle: document.querySelector("#registrationTitle"),
  loginForm: document.querySelector("#loginForm"),
  riderSelectGroup: document.querySelector("#riderSelectGroup"),
  riderSelect: document.querySelector("#riderSelect"),
  driverSelectGroup: document.querySelector("#driverSelectGroup"),
  driverSelect: document.querySelector("#driverSelect"),
  riderPreview: document.querySelector("#riderPreview"),
  driverPreview: document.querySelector("#driverPreview"),
  refreshRiders: document.querySelector("#refreshRiders"),
  refreshDrivers: document.querySelector("#refreshDrivers"),
  registrationForm: document.querySelector("#registrationForm"),
  driverRegistration: document.querySelector(".driver-registration"),
  driverAvailability: document.querySelector("#driverAvailability"),
  setDriverActive: document.querySelector("#setDriverActive"),
  setDriverOffline: document.querySelector("#setDriverOffline"),
  driverDetailsForm: document.querySelector("#driverDetailsForm"),
  riderDetailsForm: document.querySelector("#riderDetailsForm"),
  tripForm: document.querySelector("#tripForm"),
  driverMatchStatus: document.querySelector("#driverMatchStatus"),
  tripState: document.querySelector("#tripState"),
  summaryCard: document.querySelector("#summaryCard"),
  riderTripReport: document.querySelector("#riderTripReport"),
  riderRefreshReport: document.querySelector("#riderRefreshReport"),
  driverTripReport: document.querySelector("#driverTripReport"),
  driverRefreshReport: document.querySelector("#driverRefreshReport"),
  acceptTrip: document.querySelector("#acceptTrip"),
  startTrip: document.querySelector("#startTrip"),
  completeTrip: document.querySelector("#completeTrip"),
  cancelTrip: document.querySelector("#cancelTrip"),
  driverTripModal: document.querySelector("#driverTripModal"),
  driverTripRequestSummary: document.querySelector("#driverTripRequestSummary"),
  driverAcceptTrip: document.querySelector("#driverAcceptTrip"),
  driverDismissTrip: document.querySelector("#driverDismissTrip"),
  driverTripClose: document.querySelector("#driverTripClose"),
  toast: document.querySelector("#toast")
};

const appChannel = "BroadcastChannel" in window ? new BroadcastChannel(appChannelName) : null;

function toast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("visible");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => els.toast.classList.remove("visible"), 3200);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formData(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  for (const checkbox of form.querySelectorAll("input[type='checkbox']")) {
    data[checkbox.name] = checkbox.checked;
  }
  return data;
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }

  return payload;
}

function unwrapRiderId(rider) {
  return rider.riderId || rider.rider_id || rider.id;
}

function unwrapDriverId(driver) {
  return driver.id || driver.driver_id || driver.driverId;
}

function shortId(value) {
  const id = String(value || "");
  return id.length > 12 ? `${id.slice(0, 8)}...${id.slice(-4)}` : id;
}

function emitAppEvent(type, payload) {
  const event = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    type,
    payload
  };

  appChannel?.postMessage(event);
  localStorage.setItem(appChannelName, JSON.stringify(event));
  localStorage.removeItem(appChannelName);
}

function onAppEvent(handler) {
  appChannel?.addEventListener("message", (event) => handler(event.data));
  window.addEventListener("storage", (event) => {
    if (event.key !== appChannelName || !event.newValue) return;
    handler(JSON.parse(event.newValue));
  });
}

function setScreen(screenId) {
  document.querySelectorAll(".screen").forEach((screen) => {
    screen.classList.toggle("active", screen.id === screenId);
  });
}

function populateForm(form, values) {
  for (const element of form.elements) {
    if (!element.name) continue;
    if (element.type === "checkbox") {
      element.checked = Boolean(values[element.name]);
    } else {
      element.value = values[element.name] ?? "";
    }
  }
}

function renderDriverAvailability(driver) {
  const active = Boolean(driver && driver.is_active);
  els.driverAvailability.textContent = active ? "Active" : "Offline";
  els.driverAvailability.className = `pill ${active ? "ok" : "muted"}`;
}

function tripStatusLabel(status) {
  if (status === "CANCELLED") return "Cancelled";
  if (status === "COMPLETED") return "Completed";
  return "Pending";
}

function tripStatusClass(status) {
  if (status === "CANCELLED") return "danger";
  if (status === "COMPLETED") return "ok";
  return "warn";
}

function setSession(role, account) {
  state.role = role;
  state.rider = role === "rider" ? account : null;
  state.driver = role === "driver" ? account : null;
  state.trip = null;

  els.sessionStatus.textContent = `${role === "driver" ? "Driver" : "Rider"}: ${account.name}`;
  els.sessionStatus.className = "pill ok";
  setTrip(null);

  if (role === "driver") {
    populateForm(els.driverDetailsForm, account);
    renderDriverAvailability(account);
    setScreen("driverScreen");
    window.VroomDriverUI?.showPendingTripForSelectedDriver();
    window.VroomDriverUI?.loadTripReport();
  } else {
    populateForm(els.riderDetailsForm, account);
    els.tripForm.elements.city.value = account.city || "";
    setScreen("riderScreen");
    window.VroomRiderUI?.loadTripReport();
  }
}

function setTrip(trip) {
  const previousDriver = state.trip && state.trip.driver_details;
  state.trip = trip && previousDriver && String(previousDriver.id) === String(trip.driver_id)
    ? { ...trip, driver_details: trip.driver_details || previousDriver }
    : trip;
  els.tripState.textContent = trip ? `Ride ${tripStatusLabel(trip.status)}` : "No trip";
  els.tripState.className = `pill ${trip ? tripStatusClass(trip.status) : "muted"}`;
  els.startTrip.disabled = !state.trip || state.trip.status !== "ACCEPTED";
  els.completeTrip.disabled = !state.trip || state.trip.status !== "ONGOING";
  els.cancelTrip.disabled = !state.trip || !["REQUESTED", "ACCEPTED"].includes(state.trip.status);
  renderSummary(state.trip);
}

function renderSummary(trip) {
  if (!trip) {
    els.summaryCard.className = "summary-card empty";
    els.summaryCard.textContent = "No trip selected.";
    return;
  }

  els.summaryCard.className = "summary-card";
  const driver = trip.driver_details || {};
  els.summaryCard.innerHTML = `
    <div class="summary-stat"><span>Trip</span><strong>${escapeHtml(shortId(trip.id))}</strong></div>
    <div class="summary-stat"><span>Ride Status</span><strong>${escapeHtml(tripStatusLabel(trip.status))}</strong></div>
    <div class="summary-stat"><span>Trip Stage</span><strong>${escapeHtml(trip.status)}</strong></div>
    <div class="summary-stat"><span>Driver</span><strong>${escapeHtml(driver.name || `Driver ${trip.driver_id}`)}</strong></div>
    <div class="summary-stat"><span>Car Type</span><strong>${escapeHtml(driver.vehicle_type || "Not available")}</strong></div>
    <div class="summary-stat"><span>Vehicle Model</span><strong>${escapeHtml(driver.vehicle_model || "Not available")}</strong></div>
    <div class="summary-stat"><span>Vehicle No</span><strong>${escapeHtml(driver.vehicle_plate || "Not available")}</strong></div>
    <div class="summary-stat"><span>Payment</span><strong>${escapeHtml(trip.payment_status)}</strong></div>
    <div class="summary-stat"><span>Fare</span><strong>${escapeHtml(formatAmount(trip.fare))}</strong></div>
  `;
}

function formatAmount(value) {
  return `INR ${Number(value || 0).toFixed(2)}`;
}

function renderTripReport(container, trips, role) {
  if (!container) return;

  if (!Array.isArray(trips) || trips.length === 0) {
    container.className = "trip-report empty";
    container.textContent = "No trips yet.";
    return;
  }

  container.className = "trip-report";
  container.innerHTML = trips.map((trip) => {
    const details = role === "rider" ? trip.driver_details : trip.rider_details;
    const personLabel = role === "rider" ? "Driver" : "Rider";
    const paymentMode = trip.payment_method || (trip.payment_status === "SUCCESS" ? "Recorded" : "Not paid");
    const paymentReference = trip.payment_reference || "Not available";
    const vehicle = role === "rider" && details
      ? `<span>${escapeHtml([details.vehicle_model, details.vehicle_plate].filter(Boolean).join(" - ") || "Vehicle not available")}</span>`
      : "";
    const personMeta = [
      details?.phone,
      role === "driver" ? details?.email : null,
      role === "driver" ? details?.city : null
    ].filter(Boolean).join(" | ");

    return `
      <article class="trip-report-card">
        <div>
          <span>Trip</span>
          <strong>${escapeHtml(shortId(trip.trip_id))}</strong>
          <span>${escapeHtml(trip.created_at || "")}</span>
        </div>
        <div>
          <span>Trip Status</span>
          <strong>${escapeHtml(tripStatusLabel(trip.status))}</strong>
          <span>${escapeHtml(trip.status)}</span>
        </div>
        <div>
          <span>Pickup</span>
          <strong>${escapeHtml(trip.pickup_point)}</strong>
        </div>
        <div>
          <span>Drop</span>
          <strong>${escapeHtml(trip.drop_point)}</strong>
        </div>
        <div>
          <span>Amount</span>
          <strong>${escapeHtml(formatAmount(trip.amount))}</strong>
        </div>
        <div>
          <span>Payment Status</span>
          <strong>${escapeHtml(trip.payment_status || "PENDING")}</strong>
          <span>${escapeHtml(paymentReference)}</span>
        </div>
        <div>
          <span>Payment Mode</span>
          <strong>${escapeHtml(paymentMode)}</strong>
        </div>
        <div>
          <span>${personLabel}</span>
          <strong>${escapeHtml(details?.name || "Not available")}</strong>
          <span>${escapeHtml(personMeta)}</span>
          ${vehicle}
        </div>
      </article>
    `;
  }).join("");
}

function registrationButtonLabel(isExpanded) {
  if (isExpanded) return "Hide Registration";
  return `${state.panelRole === "driver" ? "New Driver" : "New Rider"} Registration`;
}

function syncPanelRole() {
  const isRider = state.panelRole === "rider";
  const submitButton = els.loginForm.querySelector("button[type='submit']");

  els.riderSelectGroup.classList.toggle("hidden", !isRider);
  els.driverSelectGroup.classList.toggle("hidden", isRider);
  els.refreshRiders.classList.toggle("hidden", !isRider);
  els.refreshDrivers.classList.toggle("hidden", isRider);
  els.riderPreview.classList.toggle("hidden", !isRider);
  els.driverPreview.classList.toggle("hidden", isRider);
  els.riderSelect.required = isRider;
  els.driverSelect.required = !isRider;
  els.authTitle.textContent = isRider ? "Rider Panel" : "Driver Panel";
  els.showRegister.textContent = registrationButtonLabel(!els.registrationForm.classList.contains("hidden"));
  submitButton.textContent = isRider ? "Open Rider Panel" : "Open Driver Panel";
}

function setRegistrationExpanded(isExpanded) {
  els.registrationForm.classList.toggle("hidden", !isExpanded);
  els.showRegister.textContent = registrationButtonLabel(isExpanded);
  syncRegistrationRole();
}

function syncRegistrationRole() {
  const isDriver = state.panelRole === "driver";
  els.registrationTitle.textContent = isDriver ? "New Driver Registration" : "New Rider Registration";
  els.driverRegistration.classList.toggle("hidden", !isDriver);
  for (const input of els.driverRegistration.querySelectorAll("input")) {
    input.required = isDriver && ["vehicle_type", "vehicle_plate"].includes(input.name);
  }
  if (isDriver) {
    window.VroomDriverUI?.ensureDriversLoaded();
  }
}

function buildRegistrationPayload(form, role) {
  const data = formData(form);
  if (role === "rider") {
    return {
      role,
      payload: {
        name: data.name,
        email: data.email,
        phone: data.phone,
        city: data.city
      }
    };
  }

  return {
    role,
    payload: {
      name: data.name,
      email: data.email,
      phone: data.phone,
      city: data.city,
      license_number: data.license_number,
      vehicle_type: data.vehicle_type,
      vehicle_model: data.vehicle_model,
      vehicle_plate: data.vehicle_plate,
      is_active: false
    }
  };
}

async function checkGateway() {
  try {
    await request(healthPath);
    els.gatewayStatus.textContent = "Gateway online";
    els.gatewayStatus.className = "pill ok";
  } catch (error) {
    els.gatewayStatus.textContent = "Gateway offline";
    els.gatewayStatus.className = "pill warn";
  }
}

function applyInitialRole() {
  const role = new URLSearchParams(window.location.search).get("role");
  state.panelRole = ["rider", "driver"].includes(role) ? role : "rider";
}

async function handleRegistrationSubmit(event) {
  event.preventDefault();
  try {
    const { role, payload } = buildRegistrationPayload(event.currentTarget, state.panelRole);
    const response = role === "driver"
      ? await window.VroomDriverUI.createDriver(payload)
      : await window.VroomRiderUI.createRider(payload);
    setSession(role, response.data);
    toast(`${role === "driver" ? "Driver" : "Rider"} account created`);
  } catch (error) {
    toast(error.message);
  }
}

function initCommon() {
  applyInitialRole();
  checkGateway();
  syncPanelRole();
  syncRegistrationRole();

  els.showRegister.addEventListener("click", () => {
    setRegistrationExpanded(els.registrationForm.classList.contains("hidden"));
  });
  els.registrationForm.addEventListener("submit", handleRegistrationSubmit);
  els.loginForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (state.panelRole === "driver") {
      window.VroomDriverUI.openSelectedDriver();
    } else {
      window.VroomRiderUI.openSelectedRider();
    }
  });

  if (state.panelRole === "driver") {
    window.VroomDriverUI.init();
  } else {
    window.VroomRiderUI.init();
  }
}

window.VroomApp = {
  els,
  state,
  request,
  toast,
  escapeHtml,
  formData,
  unwrapDriverId,
  unwrapRiderId,
  shortId,
  setSession,
  setTrip,
  populateForm,
  renderTripReport,
  emitAppEvent,
  onAppEvent,
  syncPanelRole
};

document.addEventListener("DOMContentLoaded", initCommon);

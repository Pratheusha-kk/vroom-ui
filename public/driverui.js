let pendingTripRequest = null;

function pendingTripKey(driverId) {
  return `vroom-ui-pending-trip-${driverId}`;
}

function selectedDriver() {
  const { els, state, unwrapDriverId } = window.VroomApp;
  const selectedId = els.driverSelect.value;
  return state.drivers.find((driver) => String(unwrapDriverId(driver)) === selectedId) || null;
}

function renderDriverPreview(driver) {
  const { els, escapeHtml } = window.VroomApp;
  const hiddenClass = els.driverPreview.classList.contains("hidden") ? " hidden" : "";
  if (!driver) {
    els.driverPreview.className = `rider-preview empty${hiddenClass}`;
    els.driverPreview.textContent = "Select a driver to open their panel.";
    return;
  }

  els.driverPreview.className = `rider-preview${hiddenClass}`;
  els.driverPreview.innerHTML = `
    <div><span>Name</span><strong>${escapeHtml(driver.name)}</strong></div>
    <div><span>City</span><strong>${escapeHtml(driver.city)}</strong></div>
    <div><span>Vehicle</span><strong>${escapeHtml(driver.vehicle_type)}</strong></div>
    <div><span>Status</span><strong>${driver.is_active ? "Active" : "Offline"}</strong></div>
  `;
}

function renderDriverOptions(drivers, selectedId = "") {
  const { els, unwrapDriverId } = window.VroomApp;
  els.driverSelect.replaceChildren();

  if (drivers.length === 0) {
    els.driverSelect.append(new Option("No drivers found", ""));
    els.driverSelect.disabled = true;
    renderDriverPreview(null);
    return;
  }

  els.driverSelect.disabled = false;
  els.driverSelect.append(new Option("Choose a driver", ""));
  for (const driver of drivers) {
    const id = String(unwrapDriverId(driver));
    const status = driver.is_active ? "Active" : "Offline";
    els.driverSelect.append(new Option(`${driver.name} - ${driver.city} - ${driver.vehicle_type} - ${status}`, id));
  }

  if (selectedId && drivers.some((driver) => String(unwrapDriverId(driver)) === selectedId)) {
    els.driverSelect.value = selectedId;
  }
  renderDriverPreview(selectedDriver());
}

async function loadDrivers({ preserveSelection = false } = {}) {
  const { els, state, request, toast } = window.VroomApp;
  const selectedId = preserveSelection ? els.driverSelect.value : "";
  els.driverSelect.disabled = true;
  els.driverSelect.replaceChildren(new Option("Loading drivers...", ""));
  renderDriverPreview(null);

  try {
    const response = await request("/api/drivers");
    state.drivers = Array.isArray(response.data) ? response.data : [];
    renderDriverOptions(state.drivers, selectedId);
  } catch (error) {
    state.drivers = [];
    els.driverSelect.replaceChildren(new Option("Unable to load drivers", ""));
    els.driverSelect.disabled = true;
    renderDriverPreview(null);
    toast(error.message);
  }
}

function ensureDriversLoaded() {
  if (window.VroomApp.state.drivers.length > 0) return;
  loadDrivers({ preserveSelection: false });
}

function validateNewDriverIsUnique(payload) {
  const duplicateChecks = [
    { field: "phone", label: "Phone", value: payload.phone },
    { field: "email", label: "Email", value: payload.email },
    { field: "vehicle_plate", label: "Vehicle plate", value: payload.vehicle_plate },
    { field: "license_number", label: "License number", value: payload.license_number }
  ];

  for (const check of duplicateChecks) {
    if (!check.value) continue;
    const incoming = String(check.value).trim().toLowerCase();
    const existing = window.VroomApp.state.drivers.find((driver) => {
      const value = driver[check.field];
      return value && String(value).trim().toLowerCase() === incoming;
    });

    if (existing) {
      throw new Error(`${check.label} already belongs to ${existing.name}. Use a unique ${check.label.toLowerCase()}.`);
    }
  }
}

async function createDriver(payload) {
  validateNewDriverIsUnique(payload);
  const response = await window.VroomApp.request("/api/drivers", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await loadDrivers({ preserveSelection: false });
  return response;
}

function openSelectedDriver() {
  const driver = selectedDriver();
  if (!driver) {
    window.VroomApp.toast("Select a driver");
    return;
  }
  window.VroomApp.setSession("driver", driver);
  window.VroomApp.toast("Driver panel opened");
}

async function loadTripReport() {
  const { els, state, request, renderTripReport, toast, unwrapDriverId } = window.VroomApp;
  if (!state.driver) return;

  els.driverTripReport.className = "trip-report empty";
  els.driverTripReport.textContent = "Loading past trips...";

  try {
    const response = await request(`/api/drivers/${encodeURIComponent(unwrapDriverId(state.driver))}/trips/report`);
    renderTripReport(els.driverTripReport, response.data, "driver");
  } catch (error) {
    els.driverTripReport.className = "trip-report empty";
    els.driverTripReport.textContent = "Unable to load past trips.";
    toast(error.message);
  }
}

async function updateDriverStatus(isActive) {
  const { els, state, request, populateForm, toast } = window.VroomApp;
  try {
    const response = await request(`/api/drivers/${state.driver.id}/status`, {
      method: "PATCH",
      body: JSON.stringify({
        is_active: isActive,
        reason: isActive ? "driver_available" : "driver_signed_off"
      })
    });
    state.driver = response.data;
    populateForm(els.driverDetailsForm, state.driver);
    els.driverAvailability.textContent = state.driver.is_active ? "Active" : "Offline";
    els.driverAvailability.className = `pill ${state.driver.is_active ? "ok" : "muted"}`;
    toast(isActive ? "Driver is active" : "Driver is offline");
  } catch (error) {
    toast(error.message);
  }
}

async function updateDriverDetails(event) {
  event.preventDefault();
  const { state, formData, request, populateForm, toast } = window.VroomApp;
  try {
    const payload = {
      ...formData(event.currentTarget),
      is_active: Boolean(state.driver.is_active)
    };
    const response = await request(`/api/drivers/${state.driver.id}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    state.driver = response.data;
    populateForm(event.currentTarget, state.driver);
    toast("Car details updated");
  } catch (error) {
    toast(error.message);
  }
}

function driverMatchesTrip(trip) {
  const { state, unwrapDriverId } = window.VroomApp;
  const driver = state.driver || selectedDriver();
  return driver && String(unwrapDriverId(driver)) === String(trip.driver_id);
}

function renderTripRequest(trip, rider) {
  const { els, escapeHtml, shortId } = window.VroomApp;
  els.driverTripRequestSummary.innerHTML = `
    <div class="summary-stat"><span>Trip</span><strong>${escapeHtml(shortId(trip.id))}</strong></div>
    <div class="summary-stat"><span>Rider</span><strong>${escapeHtml(rider?.name || trip.rider_id)}</strong></div>
    <div class="summary-stat"><span>Pickup</span><strong>${escapeHtml(trip.pickup)}</strong></div>
    <div class="summary-stat"><span>Drop</span><strong>${escapeHtml(trip.drop)}</strong></div>
  `;
}

function showTripPopup(trip, rider) {
  const { els } = window.VroomApp;
  pendingTripRequest = { trip, rider };
  renderTripRequest(trip, rider);
  els.driverTripModal.classList.remove("hidden");
}

function hideTripPopup() {
  if (pendingTripRequest) {
    localStorage.removeItem(pendingTripKey(pendingTripRequest.trip.driver_id));
    pendingTripRequest = null;
  }
  window.VroomApp.els.driverTripModal.classList.add("hidden");
}

function showPendingTripForSelectedDriver() {
  const driver = window.VroomApp.state.driver || selectedDriver();
  if (!pendingTripRequest && driver) {
    const stored = localStorage.getItem(pendingTripKey(window.VroomApp.unwrapDriverId(driver)));
    pendingTripRequest = stored ? JSON.parse(stored) : null;
  }
  if (!pendingTripRequest || !driverMatchesTrip(pendingTripRequest.trip)) return;
  showTripPopup(pendingTripRequest.trip, pendingTripRequest.rider);
}

function handleTripRequested(event) {
  if (event.type !== "trip:requested") return;
  const { trip, rider } = event.payload;
  pendingTripRequest = { trip, rider };
  if (driverMatchesTrip(trip)) {
    showTripPopup(trip, rider);
  }
}

function handleTripCompleted(event) {
  if (event.type !== "trip:completed") return;
  if (driverMatchesTrip(event.payload.trip)) {
    loadTripReport();
  }
}

function handleTripCancelled(event) {
  if (event.type !== "trip:cancelled") return;
  const trip = event.payload.trip;

  if (pendingTripRequest && String(pendingTripRequest.trip.id) === String(trip.id)) {
    localStorage.removeItem(pendingTripKey(pendingTripRequest.trip.driver_id));
    pendingTripRequest = null;
    window.VroomApp.els.driverTripModal.classList.add("hidden");
  }

  if (driverMatchesTrip(trip)) {
    loadTripReport();
    window.VroomApp.toast("Trip request cancelled");
  }
}

async function acceptPendingTrip() {
  const { request, emitAppEvent, toast } = window.VroomApp;
  if (!pendingTripRequest) return;

  try {
    await request(`/api/trips/${pendingTripRequest.trip.id}/accept`, { method: "POST" });
    const trip = { ...pendingTripRequest.trip, status: "ACCEPTED" };
    emitAppEvent("trip:accepted", { trip });
    localStorage.removeItem(pendingTripKey(pendingTripRequest.trip.driver_id));
    pendingTripRequest = null;
    window.VroomApp.els.driverTripModal.classList.add("hidden");
    toast("Trip accepted");
  } catch (error) {
    toast(error.message);
  }
}

function init() {
  const { els, onAppEvent } = window.VroomApp;
  els.driverSelect.addEventListener("change", () => {
    renderDriverPreview(selectedDriver());
    showPendingTripForSelectedDriver();
  });
  els.refreshDrivers.addEventListener("click", () => {
    loadDrivers({ preserveSelection: false });
  });
  els.setDriverActive.addEventListener("click", () => updateDriverStatus(true));
  els.setDriverOffline.addEventListener("click", () => updateDriverStatus(false));
  els.driverDetailsForm.addEventListener("submit", updateDriverDetails);
  els.driverAcceptTrip.addEventListener("click", acceptPendingTrip);
  els.driverDismissTrip.addEventListener("click", hideTripPopup);
  els.driverTripClose.addEventListener("click", hideTripPopup);
  els.driverRefreshReport.addEventListener("click", loadTripReport);
  onAppEvent(handleTripRequested);
  onAppEvent(handleTripCompleted);
  onAppEvent(handleTripCancelled);
  loadDrivers();
}

window.VroomDriverUI = {
  createDriver,
  ensureDriversLoaded,
  init,
  loadTripReport,
  openSelectedDriver,
  showPendingTripForSelectedDriver
};

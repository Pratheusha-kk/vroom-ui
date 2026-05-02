let riderTripReportCache = [];

function selectedRider() {
  const { els, state, unwrapRiderId } = window.VroomApp;
  const selectedId = els.riderSelect.value;
  return state.riders.find((rider) => String(unwrapRiderId(rider)) === selectedId) || null;
}

function renderRiderPreview(rider) {
  const { els, escapeHtml, shortId, unwrapRiderId } = window.VroomApp;
  const hiddenClass = els.riderPreview.classList.contains("hidden") ? " hidden" : "";
  if (!rider) {
    els.riderPreview.className = `rider-preview empty${hiddenClass}`;
    els.riderPreview.textContent = "Select a rider to open their panel.";
    return;
  }

  els.riderPreview.className = `rider-preview${hiddenClass}`;
  els.riderPreview.innerHTML = `
    <div><span>Name</span><strong>${escapeHtml(rider.name)}</strong></div>
    <div><span>City</span><strong>${escapeHtml(rider.city)}</strong></div>
    <div><span>Phone</span><strong>${escapeHtml(rider.phone)}</strong></div>
    <div><span>ID</span><strong>${escapeHtml(shortId(unwrapRiderId(rider)))}</strong></div>
  `;
}

function renderRiderOptions(riders, selectedId = "") {
  const { els, unwrapRiderId, shortId } = window.VroomApp;
  els.riderSelect.replaceChildren();

  if (riders.length === 0) {
    els.riderSelect.append(new Option("No riders found", ""));
    els.riderSelect.disabled = true;
    renderRiderPreview(null);
    return;
  }

  els.riderSelect.disabled = false;
  els.riderSelect.append(new Option("Choose a rider", ""));
  for (const rider of riders) {
    const id = String(unwrapRiderId(rider));
    els.riderSelect.append(new Option(`${rider.name} - ${rider.city} - ${shortId(id)}`, id));
  }

  if (selectedId && riders.some((rider) => String(unwrapRiderId(rider)) === selectedId)) {
    els.riderSelect.value = selectedId;
  }
  renderRiderPreview(selectedRider());
}

async function loadRiders({ preserveSelection = false } = {}) {
  const { els, state, request, toast } = window.VroomApp;
  const selectedId = preserveSelection ? els.riderSelect.value : "";
  els.riderSelect.disabled = true;
  els.riderSelect.replaceChildren(new Option("Loading riders...", ""));
  renderRiderPreview(null);

  try {
    const response = await request("/api/riders");
    state.riders = Array.isArray(response.data) ? response.data : [];
    renderRiderOptions(state.riders, selectedId);
  } catch (error) {
    state.riders = [];
    els.riderSelect.replaceChildren(new Option("Unable to load riders", ""));
    els.riderSelect.disabled = true;
    renderRiderPreview(null);
    toast(error.message);
  }
}

async function createRider(payload) {
  const response = await window.VroomApp.request("/api/riders", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  await loadRiders({ preserveSelection: false });
  return response;
}

function openSelectedRider() {
  const rider = selectedRider();
  if (!rider) {
    window.VroomApp.toast("Select a rider");
    return;
  }
  window.VroomApp.setSession("rider", rider);
  window.VroomApp.toast("Rider panel opened");
}

function currentTripReportItem() {
  const { state } = window.VroomApp;
  const trip = state.trip;

  if (!trip) return null;

  return {
    trip_id: trip.id,
    status: trip.status,
    pickup_point: trip.pickup,
    drop_point: trip.drop || trip.drop_location,
    amount: Number(trip.fare || 0),
    payment_status: trip.payment_status || "PENDING",
    created_at: trip.created_at,
    driver_details: trip.driver_details || null,
    ratings: Array.isArray(trip.ratings) ? trip.ratings : []
  };
}

function mergeCurrentTripIntoReport(trips) {
  const current = currentTripReportItem();
  const report = Array.isArray(trips) ? [...trips] : [];

  if (!current) return report;

  const existingIndex = report.findIndex((trip) => String(trip.trip_id) === String(current.trip_id));
  if (existingIndex >= 0) {
    report[existingIndex] = {
      ...report[existingIndex],
      ...current,
      driver_details: report[existingIndex].driver_details || current.driver_details
    };
    return report;
  }

  return [current, ...report];
}

function renderRiderTripReportFromCache() {
  const { els, renderTripReport } = window.VroomApp;
  riderTripReportCache = mergeCurrentTripIntoReport(riderTripReportCache);
  renderTripReport(els.riderTripReport, riderTripReportCache, "rider");
}

async function loadTripReport() {
  const { els, state, request, renderTripReport, toast, unwrapRiderId } = window.VroomApp;
  if (!state.rider) return;

  els.riderTripReport.className = "trip-report empty";
  els.riderTripReport.textContent = "Loading past trips...";

  try {
    const response = await request(`/api/riders/${encodeURIComponent(unwrapRiderId(state.rider))}/trips/report`);
    const tripsWithRatings = await window.VroomApp.enrichTripReportsWithRatings(response.data);
    riderTripReportCache = mergeCurrentTripIntoReport(tripsWithRatings);
    renderTripReport(els.riderTripReport, riderTripReportCache, "rider");
  } catch (error) {
    els.riderTripReport.className = "trip-report empty";
    els.riderTripReport.textContent = "Unable to load past trips.";
    toast(error.message);
  }
}

async function updateRiderDetails(event) {
  event.preventDefault();
  const { els, state, formData, populateForm, request, toast, unwrapRiderId } = window.VroomApp;

  try {
    const response = await request(`/api/riders/${unwrapRiderId(state.rider)}`, {
      method: "PUT",
      body: JSON.stringify(formData(event.currentTarget))
    });

    state.rider = response.data;
    populateForm(els.riderDetailsForm, state.rider);
    els.tripForm.elements.city.value = state.rider.city || "";
    els.sessionStatus.textContent = `Rider: ${state.rider.name}`;
    await loadRiders({ preserveSelection: false });
    toast("Personal details updated");
  } catch (error) {
    toast(error.message);
  }
}

async function scheduleTrip(event) {
  event.preventDefault();
  const { els, state, formData, request, toast, unwrapRiderId, setTrip, emitAppEvent } = window.VroomApp;

  try {
    const data = formData(event.currentTarget);
    const city = data.city.trim();
    const available = await request(`/api/drivers?is_active=true&city=${encodeURIComponent(city)}&limit=1`);

    if (!Array.isArray(available.data) || available.data.length === 0) {
      els.driverMatchStatus.textContent = "No driver";
      els.driverMatchStatus.className = "pill warn";
      toast("No active driver available in this city");
      return;
    }

    els.driverMatchStatus.textContent = "Driver found";
    els.driverMatchStatus.className = "pill ok";
    const assignedDriver = available.data[0];
    const response = await request("/api/trips", {
      method: "POST",
      body: JSON.stringify({
        rider_id: unwrapRiderId(state.rider),
        city,
        pickup: data.pickup,
        drop: data.drop
      })
    });
    const trip = { ...response.data, driver_details: assignedDriver };

    setTrip(trip);
    renderRiderTripReportFromCache();
    await loadTripReport();
    localStorage.setItem(`vroom-ui-pending-trip-${trip.driver_id}`, JSON.stringify({
      trip,
      rider: state.rider
    }));
    emitAppEvent("trip:requested", { trip, rider: state.rider });
    toast("Trip scheduled");
  } catch (error) {
    toast(error.message);
  }
}

function handleTripAccepted(event) {
  const { state, setTrip, toast } = window.VroomApp;
  if (event.type !== "trip:accepted" || !state.trip) return;
  if (event.payload.trip.id !== state.trip.id) return;
  setTrip(event.payload.trip);
  renderRiderTripReportFromCache();
  loadTripReport();
  toast("Driver accepted the trip");
}

async function startTrip() {
  const { state, request, setTrip, toast } = window.VroomApp;
  try {
    await request(`/api/trips/${state.trip.id}/start`, { method: "POST" });
    setTrip({ ...state.trip, status: "ONGOING" });
    renderRiderTripReportFromCache();
    await loadTripReport();
    toast("Trip started");
  } catch (error) {
    toast(error.message);
  }
}

async function completeTrip() {
  const { state, request, setTrip, toast, emitAppEvent } = window.VroomApp;
  try {
    const response = await request(`/api/trips/${state.trip.id}/complete`, { method: "POST" });
    const ratings = await window.VroomApp.loadTripRatings?.(response.data.id);
    setTrip({ ...response.data, ratings: Array.isArray(ratings) ? ratings : [] });
    renderRiderTripReportFromCache();
    await loadTripReport();
    emitAppEvent("trip:completed", { trip: response.data });
    toast(response.data.payment_status === "SUCCESS" ? "Payment completed" : "Payment pending");
  } catch (error) {
    toast(error.message);
  }
}

async function submitRating(event) {
  event.preventDefault();
  const {
    state,
    formData,
    request,
    setTrip,
    toast,
    unwrapRiderId,
    emitAppEvent,
    renderRiderRatingPanel
  } = window.VroomApp;

  if (!state.trip || state.trip.status !== "COMPLETED") {
    toast("Complete a ride before rating it");
    return;
  }

  try {
    const data = formData(event.currentTarget);
    const response = await request(`/api/trips/${encodeURIComponent(state.trip.id)}/rating`, {
      method: "POST",
      headers: {
        "X-Correlation-Id": `ui-rating-${state.trip.id}`
      },
      body: JSON.stringify({
        raterType: "RIDER",
        raterId: Number(unwrapRiderId(state.rider)),
        targetType: "DRIVER",
        targetId: Number(state.trip.driver_id),
        score: Number(data.score),
        feedback: data.feedback
      })
    });

    const ratings = [...(Array.isArray(state.trip.ratings) ? state.trip.ratings : []), response.data];
    setTrip({ ...state.trip, ratings });
    renderRiderRatingPanel(state.trip);
    renderRiderTripReportFromCache();
    await loadTripReport();
    emitAppEvent("rating:submitted", { trip: state.trip, rating: response.data });
    toast("Rating submitted");
  } catch (error) {
    toast(error.message);
  }
}

async function cancelTrip() {
  const { state, request, setTrip, toast, emitAppEvent } = window.VroomApp;
  if (!state.trip) return;

  try {
    const response = await request(`/api/trips/${state.trip.id}/cancel`, { method: "POST" });
    setTrip(response.data);
    localStorage.removeItem(`vroom-ui-pending-trip-${state.trip.driver_id}`);
    renderRiderTripReportFromCache();
    await loadTripReport();
    emitAppEvent("trip:cancelled", { trip: response.data });
    toast("Ride cancelled");
  } catch (error) {
    toast(error.message);
  }
}

function init() {
  const { els, onAppEvent } = window.VroomApp;
  els.riderSelect.addEventListener("change", () => renderRiderPreview(selectedRider()));
  els.refreshRiders.addEventListener("click", () => {
    loadRiders({ preserveSelection: false });
  });
  els.riderDetailsForm.addEventListener("submit", updateRiderDetails);
  els.tripForm.addEventListener("submit", scheduleTrip);
  els.acceptTrip.classList.add("hidden");
  els.startTrip.addEventListener("click", startTrip);
  els.completeTrip.addEventListener("click", completeTrip);
  els.cancelTrip.addEventListener("click", cancelTrip);
  els.riderRatingForm.addEventListener("submit", submitRating);
  els.riderRefreshReport.addEventListener("click", loadTripReport);
  onAppEvent(handleTripAccepted);
  loadRiders();
}

window.VroomRiderUI = {
  createRider,
  init,
  loadTripReport,
  openSelectedRider
};

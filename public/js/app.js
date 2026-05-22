const MONTHS = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December'
];
const OPEN_DAYS = [0, 3, 4, 5, 6]; // Sun, Wed, Thu, Fri, Sat

let services = [];

const state = {
  step:     1,
  service:  null,
  date:     null,
  time:     null,
  calYear:  new Date().getFullYear(),
  calMonth: new Date().getMonth(),
};

async function init() {
  try {
    const res = await fetch('/api/services');
    services  = await res.json();
    renderServices();
    renderCalendar();
    document.getElementById('cal-prev').addEventListener('click', prevMonth);
    document.getElementById('cal-next').addEventListener('click', nextMonth);
  } catch (e) {
    console.error('Failed to load services', e);
  }
}

// ── Services ────────────────────────────────────────────────────────────────

function renderServices() {
  document.getElementById('services-grid').innerHTML = services.map((s, i) => `
    <div class="service-card" onclick="selectService(${i})">
      <div class="svc-left">
        <div class="svc-name">${s.name}</div>
        <div class="svc-dur">approx. ${s.duration} min</div>
      </div>
      <div class="svc-price">£${s.price.toFixed(2)}<span> GBP</span></div>
    </div>
  `).join('');
}

function selectService(i) {
  state.service = services[i];
  document.querySelectorAll('.service-card').forEach((c, idx) =>
    c.classList.toggle('selected', idx === i)
  );
  setTimeout(() => goToStep(2), 220);
}

// ── Navigation ───────────────────────────────────────────────────────────────

function goToStep(n) {
  if (n < 3) state.time = null;

  state.step = n;
  document.querySelectorAll('.step-section').forEach(s => s.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');
  updateProgress(n);

  if (n === 2) {
    document.getElementById('step2-sub').textContent = state.service?.name ?? '';
    renderCalendar();
  }
  if (n === 3) {
    const d = new Date(state.date + 'T12:00:00');
    document.getElementById('step3-sub').textContent =
      `${state.service.name} · ${d.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' })}`;
    loadTimeSlots();
  }
  if (n === 4) {
    const d = new Date(state.date + 'T12:00:00');
    document.getElementById('step4-sub').textContent =
      `${state.service.name} · ${d.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })} at ${fmtTime(state.time)}`;
    renderSummary();
  }

  document.getElementById('progress-wrap').style.display = n === 5 ? 'none' : '';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function updateProgress(step) {
  document.querySelectorAll('.prog-step').forEach(el => {
    const s = +el.dataset.step;
    el.classList.remove('active', 'done');
    if (s === step) el.classList.add('active');
    else if (s < step) el.classList.add('done');
  });
}

// ── Calendar ─────────────────────────────────────────────────────────────────

function renderCalendar() {
  const { calYear, calMonth } = state;
  document.getElementById('cal-month-label').textContent = `${MONTHS[calMonth]} ${calYear}`;

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const firstDow    = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  let offset = firstDow - 1;
  if (offset < 0) offset = 6;

  const container = document.getElementById('cal-days');
  container.innerHTML = '';

  for (let i = 0; i < offset; i++) {
    container.appendChild(document.createElement('div')).className = 'cal-day';
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date    = new Date(calYear, calMonth, d);
    const dow     = date.getDay();
    const past    = date < today;
    const open    = OPEN_DAYS.includes(dow) && !past;
    const dateStr = fmtDate(calYear, calMonth, d);
    const isToday = date.getTime() === today.getTime();

    const el      = document.createElement('div');
    el.textContent = d;
    el.className   = 'cal-day ' + (open ? 'open' : (past ? 'past' : 'closed'));
    if (isToday && open) el.classList.add('today');
    if (state.date === dateStr) el.classList.add('selected');
    if (open) el.onclick = () => selectDate(dateStr);
    container.appendChild(el);
  }
}

function prevMonth() {
  if (state.calMonth === 0) { state.calYear--; state.calMonth = 11; }
  else state.calMonth--;
  renderCalendar();
}

function nextMonth() {
  if (state.calMonth === 11) { state.calYear++; state.calMonth = 0; }
  else state.calMonth++;
  renderCalendar();
}

function selectDate(dateStr) {
  state.date = dateStr;
  renderCalendar();
  setTimeout(() => goToStep(3), 220);
}

function fmtDate(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Time slots ────────────────────────────────────────────────────────────────

async function loadTimeSlots() {
  const container = document.getElementById('time-slots');
  container.innerHTML = '<div class="loading">Loading available times…</div>';

  try {
    const res  = await fetch(`/api/availability?date=${state.date}&serviceId=${state.service.id}`);
    const data = await res.json();

    if (!data.available) {
      container.innerHTML = '<p class="no-slots">The shop is closed on this day.</p>';
      return;
    }
    if (!data.slots.length) {
      container.innerHTML = '<p class="no-slots">No times available — please choose another date.</p>';
      return;
    }

    container.innerHTML = data.slots.map(slot => `
      <div class="time-slot${state.time === slot ? ' selected' : ''}"
           onclick="selectTime('${slot}', this)">
        ${fmtTime(slot)}
      </div>
    `).join('');
  } catch {
    container.innerHTML = '<p class="no-slots">Could not load times. Please refresh.</p>';
  }
}

function selectTime(time, el) {
  state.time = time;
  document.querySelectorAll('.time-slot').forEach(t => t.classList.remove('selected'));
  el.classList.add('selected');
  setTimeout(() => goToStep(4), 220);
}

function fmtTime(t) {
  const [h, m] = t.split(':').map(Number);
  const period  = h >= 12 ? 'pm' : 'am';
  const hour    = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${hour}:${String(m).padStart(2, '0')}${period}`;
}

// ── Details & submit ──────────────────────────────────────────────────────────

function renderSummary() {
  const d = new Date(state.date + 'T12:00:00');
  const dateStr = d.toLocaleDateString('en-GB',
    { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  document.getElementById('summary-box').innerHTML = `
    <div class="sum-row"><span class="lbl">Service</span><span class="val">${state.service.name}</span></div>
    <div class="sum-row"><span class="lbl">Date</span><span class="val">${dateStr}</span></div>
    <div class="sum-row"><span class="lbl">Time</span><span class="val">${fmtTime(state.time)}</span></div>
    <div class="sum-row"><span class="lbl">Barber</span><span class="val">Conor</span></div>
    <div class="sum-sep"></div>
    <div class="sum-row sum-total">
      <span class="lbl">Price</span>
      <span class="val">£${state.service.price.toFixed(2)} — pay in store</span>
    </div>
  `;
}

async function submitBooking(e) {
  e.preventDefault();
  const btn = document.getElementById('submit-btn');
  btn.disabled    = true;
  btn.textContent = 'Confirming…';

  try {
    const res = await fetch('/api/bookings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: state.service.id,
        date:      state.date,
        time:      state.time,
        name:      document.getElementById('f-name').value,
        phone:     document.getElementById('f-phone').value,
        email:     document.getElementById('f-email').value,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      alert(data.error || 'Something went wrong. Please try again.');
      btn.disabled    = false;
      btn.textContent = 'Confirm Booking';
      return;
    }

    showConfirmation(data.booking);
  } catch {
    alert('Network error — please check your connection and try again.');
    btn.disabled    = false;
    btn.textContent = 'Confirm Booking';
  }
}

function showConfirmation(b) {
  const d = new Date(b.date + 'T12:00:00');
  const dateStr = d.toLocaleDateString('en-GB',
    { weekday:'long', day:'numeric', month:'long', year:'numeric' });

  document.getElementById('confirm-details').innerHTML = `
    <div class="conf-row"><span class="lbl">Reference</span><span class="conf-ref">${b.id.slice(0,8).toUpperCase()}</span></div>
    <div class="conf-row"><span class="lbl">Service</span><span>${b.serviceName}</span></div>
    <div class="conf-row"><span class="lbl">Date</span><span>${dateStr}</span></div>
    <div class="conf-row"><span class="lbl">Time</span><span>${fmtTime(b.time)}</span></div>
    <div class="conf-row"><span class="lbl">Barber</span><span>Conor</span></div>
    <div class="conf-row"><span class="lbl">Name</span><span>${b.name}</span></div>
    <div class="conf-row"><span class="lbl">Pay</span><span>£${b.price.toFixed(2)} in store</span></div>
  `;
  goToStep(5);
}

function startOver() {
  state.service = null;
  state.date    = null;
  state.time    = null;
  document.getElementById('booking-form').reset();
  goToStep(1);
  renderServices();
}

init();

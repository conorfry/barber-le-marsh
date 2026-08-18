require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'barber2024';
const DATA_DIR      = process.env.DATA_DIR || __dirname;
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');
const CALENDAR_ICS_URL = process.env.CALENDAR_ICS_URL || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVICES = [
  { id: 'bundle-style-beard',    name: 'Style Cut & Beard Trim',   price: 20.00, duration: 40, description: 'Any style cut with beard trim with razor line up.' },
  { id: 'oap',                   name: 'OAP 67+',                  price: 12.00, duration: 20, description: 'Any service for those 67+.' },
  { id: 'single-length',         name: 'Single Length All Over',   price: 7.00,  duration: 15, description: 'Single length all over.' },
  { id: 'kids-cut',              name: 'Kids Cut',                 price: 12.00, duration: 20, description: 'Any haircut for those equal to or younger than 13 y/o.' },
  { id: 'short-back-sides',      name: 'Short Back & Sides',       price: 14.00, duration: 20, description: '1/2/3/4 back & sides with a trim on top.' },
  { id: 'style-cut',             name: 'Style Cut',                price: 16.00, duration: 30, description: 'Suitable for skin fade, taper, mullet, flow cut, crop, buzz-fade, afro, scissor cut.' },
  { id: 'beard-trim',            name: 'Beard Trim',               price: 6.00,  duration: 10, description: 'Any beard trim with just clippers/foiler.' },
];

// Keyed by JS day-of-week (0=Sun). Days absent = closed.
const OPENING_HOURS = {
  2: { open: '10:00', close: '18:00' }, // Tuesday
  3: { open: '10:00', close: '18:00' }, // Wednesday
  4: { open: '12:00', close: '20:00' }, // Thursday
  5: { open: '10:00', close: '18:00' }, // Friday
  6: { open: '10:00', close: '15:00' }, // Saturday
};

// Online booking is only open on these days for now (subset of OPENING_HOURS).
const BOOKABLE_DAYS = [5, 6]; // Friday, Saturday

function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fromMins(n) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ── Google Calendar (week-availability widget) ──────────────────────────────

function londonParts(date) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, minutes: toMins(`${parts.hour}:${parts.minute}`) };
}

// Parses a raw DTSTART/DTEND value into either an all-day date or a UK-local {date, minutes}.
function parseICSDateTime(value) {
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?(Z)?$/);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { allDay: true, date: `${y}-${mo}-${d}` };
  if (z) return { allDay: false, ...londonParts(new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s))) };
  // Floating/local value — the feed's X-WR-TIMEZONE is Europe/London, so treat as UK wall-clock directly.
  return { allDay: false, date: `${y}-${mo}-${d}`, minutes: (+h) * 60 + (+mi) };
}

function parseICS(text) {
  const unfolded = text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const events = [];
  for (const block of unfolded.split('BEGIN:VEVENT').slice(1)) {
    const body = block.split('END:VEVENT')[0];
    const startLine = body.match(/^DTSTART[^:\n]*:(\S+)/m);
    const endLine   = body.match(/^DTEND[^:\n]*:(\S+)/m);
    if (!startLine) continue;
    const start = parseICSDateTime(startLine[1]);
    const end   = endLine ? parseICSDateTime(endLine[1]) : null;
    if (start) events.push({ start, end });
  }
  return events;
}

// Reduces parsed events into { 'YYYY-MM-DD': [{start,end} in minutes-from-midnight] }.
function eventsToBusyByDate(events) {
  const busy = {};
  for (const { start, end } of events) {
    if (start.allDay) {
      (busy[start.date] ??= []).push({ start: 0, end: 24 * 60 });
      continue;
    }
    const endMinutes = end && !end.allDay && end.date === start.date ? end.minutes : start.minutes + 30;
    (busy[start.date] ??= []).push({ start: start.minutes, end: Math.max(endMinutes, start.minutes + 1) });
  }
  return busy;
}

let calendarCache = { fetchedAt: 0, busyByDate: {} };
const CALENDAR_CACHE_MS = 15 * 60 * 1000;

async function getBusyByDate() {
  if (!CALENDAR_ICS_URL) return {};
  if (Date.now() - calendarCache.fetchedAt < CALENDAR_CACHE_MS) return calendarCache.busyByDate;
  try {
    const res = await fetch(CALENDAR_ICS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    calendarCache = { fetchedAt: Date.now(), busyByDate: eventsToBusyByDate(parseICS(await res.text())) };
  } catch (err) {
    console.error('Calendar fetch failed, using stale cache:', err.message);
  }
  return calendarCache.busyByDate;
}

function readBookings() {
  try {
    if (!fs.existsSync(BOOKINGS_FILE)) return [];
    return JSON.parse(fs.readFileSync(BOOKINGS_FILE, 'utf8'));
  } catch { return []; }
}

function writeBookings(data) {
  fs.writeFileSync(BOOKINGS_FILE, JSON.stringify(data, null, 2));
}

const DASHBOARD_USER   = process.env.DASHBOARD_USER   || 'barber';
const DASHBOARD_PASS   = process.env.DASHBOARD_PASS   || 'changeme';
const COOKIE_SECRET    = process.env.COOKIE_SECRET    || 'blm-dashboard-secret';
const DASHBOARD_COOKIE = 'blm_dash';

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie;
  if (!header) return out;
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k) out[k.trim()] = v.join('=').trim();
  }
  return out;
}

function signToken(value) {
  const sig = crypto.createHmac('sha256', COOKIE_SECRET).update(value).digest('hex');
  return `${value}.${sig}`;
}

function verifyToken(signed) {
  if (!signed) return false;
  const dot = signed.lastIndexOf('.');
  if (dot === -1) return false;
  const value = signed.slice(0, dot);
  return signToken(value) === signed && value === 'ok';
}

function dashboardLoginPage(error) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Dashboard Login — Barber le Marsh</title>
  <link rel="icon" type="image/png" href="/favicon.png">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #0a0a0a;
      color: #f0f0f0;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #141414;
      border: 1px solid #242424;
      border-radius: 12px;
      padding: 40px 32px;
      width: 100%;
      max-width: 360px;
    }
    .brand {
      font-size: 11px;
      letter-spacing: 0.16em;
      text-transform: uppercase;
      color: #555;
      margin-bottom: 28px;
      text-align: center;
    }
    h1 {
      font-size: 18px;
      font-weight: 600;
      margin-bottom: 24px;
      text-align: center;
    }
    label {
      display: block;
      font-size: 12px;
      color: #888;
      margin-bottom: 6px;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }
    input {
      display: block;
      width: 100%;
      padding: 12px 14px;
      background: #1c1c1c;
      border: 1px solid #242424;
      border-radius: 8px;
      color: #f0f0f0;
      font-size: 16px;
      margin-bottom: 16px;
      outline: none;
      -webkit-appearance: none;
    }
    input:focus { border-color: #5acea0; }
    button {
      width: 100%;
      padding: 13px;
      background: #5acea0;
      color: #0a0a0a;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 4px;
    }
    button:active { opacity: 0.85; }
    .error {
      background: #2a0d0d;
      border: 1px solid #5a2020;
      color: #e08080;
      border-radius: 8px;
      padding: 10px 14px;
      font-size: 13px;
      margin-bottom: 16px;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="card">
    <p class="brand">Barber le Marsh</p>
    <h1>Queue Dashboard</h1>
    ${error ? '<p class="error">Incorrect username or password.</p>' : ''}
    <form method="POST" action="/queue/dashboard/login">
      <label for="u">Username</label>
      <input id="u" name="username" type="text" autocomplete="username" autocapitalize="none" required>
      <label for="p">Password</label>
      <input id="p" name="password" type="password" autocomplete="current-password" required>
      <button type="submit">Sign in</button>
    </form>
  </div>
</body>
</html>`;
}

app.get('/queue/dashboard', (req, res) => {
  if (verifyToken(parseCookies(req)[DASHBOARD_COOKIE])) {
    return res.sendFile(path.join(__dirname, 'public/queue/dashboard.html'));
  }
  res.send(dashboardLoginPage(req.query.error === '1'));
});

app.post('/queue/dashboard/login', express.urlencoded({ extended: false }), (req, res) => {
  const { username, password } = req.body;
  if (username === DASHBOARD_USER && password === DASHBOARD_PASS) {
    const token = signToken('ok');
    res.set('Set-Cookie', `${DASHBOARD_COOKIE}=${token}; Path=/queue/dashboard; HttpOnly; SameSite=Strict; Max-Age=${8 * 3600}`);
    return res.redirect('/queue/dashboard');
  }
  res.redirect('/queue/dashboard?error=1');
});

app.get('/api/services', (_req, res) => res.json(SERVICES));
app.get('/api/hours',   (_req, res) => res.json(OPENING_HOURS));

app.get('/api/availability', (req, res) => {
  const { date, serviceId } = req.query;
  if (!date || !serviceId) return res.status(400).json({ error: 'date and serviceId required' });

  const day = new Date(date + 'T12:00:00').getDay();
  const hours = OPENING_HOURS[day];
  if (!hours || !BOOKABLE_DAYS.includes(day)) return res.json({ available: false, slots: [] });

  const service = SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(400).json({ error: 'Invalid service' });

  const openMin  = toMins(hours.open);
  const closeMin = toMins(hours.close);
  const existing = readBookings().filter(b => b.date === date && b.status === 'confirmed');

  const slots = [];
  for (let t = openMin; t + service.duration <= closeMin; t += 30) {
    const end = t + service.duration;
    const conflict = existing.some(b => {
      const bs = toMins(b.time), be = bs + b.duration;
      return t < be && end > bs;
    });
    if (!conflict) slots.push(fromMins(t));
  }

  res.json({ available: true, slots, hours });
});

app.get('/api/week-availability', async (_req, res) => {
  const busyByDate = await getBusyByDate();
  const today = londonParts(new Date()).date;
  const minDuration = Math.min(...SERVICES.map(s => s.duration));

  const days = [];
  for (let i = 0; i < 7; i++) {
    const [y, mo, d] = today.split('-').map(Number);
    const anchor = new Date(Date.UTC(y, mo - 1, d, 12)); // noon UTC avoids DST edge cases
    anchor.setUTCDate(anchor.getUTCDate() + i);
    const date = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}-${String(anchor.getUTCDate()).padStart(2, '0')}`;
    const weekday = anchor.getUTCDay();
    const hours = OPENING_HOURS[weekday];

    if (!hours) {
      days.push({ date, weekday: DAY_NAMES[weekday], type: 'closed' });
      continue;
    }
    if (!BOOKABLE_DAYS.includes(weekday)) {
      days.push({ date, weekday: DAY_NAMES[weekday], type: 'walkin', hours });
      continue;
    }

    const busy = busyByDate[date] || [];
    const openMin = toMins(hours.open), closeMin = toMins(hours.close);
    let free = 0, total = 0;
    for (let t = openMin; t + minDuration <= closeMin; t += 30) {
      total++;
      const end = t + minDuration;
      if (!busy.some(b => t < b.end && end > b.start)) free++;
    }
    const status = free === 0 ? 'full' : free <= 2 ? 'limited' : 'open';
    days.push({ date, weekday: DAY_NAMES[weekday], type: 'bookable', hours, status, freeSlots: free, totalSlots: total });
  }

  res.json({ days, live: !!CALENDAR_ICS_URL });
});

app.post('/api/bookings', (req, res) => {
  const { serviceId, date, time, name, phone, email } = req.body;
  if (!serviceId || !date || !time || !name || !phone)
    return res.status(400).json({ error: 'Missing required fields' });

  const service = SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(400).json({ error: 'Invalid service' });

  const day = new Date(date + 'T12:00:00').getDay();
  if (!OPENING_HOURS[day]) return res.status(400).json({ error: 'Shop is closed on this day' });
  if (!BOOKABLE_DAYS.includes(day)) return res.status(400).json({ error: 'Online booking is only available on Fridays and Saturdays for now' });

  const bookings = readBookings();
  const slotStart = toMins(time);
  const slotEnd   = slotStart + service.duration;
  const conflict  = bookings
    .filter(b => b.date === date && b.status === 'confirmed')
    .some(b => { const bs = toMins(b.time), be = bs + b.duration; return slotStart < be && slotEnd > bs; });

  if (conflict)
    return res.status(409).json({ error: 'This slot was just taken — please choose another time.' });

  const booking = {
    id: uuidv4(),
    serviceId,
    serviceName: service.name,
    price: service.price,
    duration: service.duration,
    date,
    time,
    name:  name.trim(),
    phone: phone.trim(),
    email: (email || '').trim(),
    createdAt: new Date().toISOString(),
    status: 'confirmed',
  };

  bookings.push(booking);
  writeBookings(bookings);
  res.json({ success: true, booking });
});

// ── Admin ──────────────────────────────────────────────────────────────────

app.get('/api/admin/bookings', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorised' });

  let data = readBookings();
  if (req.query.date) data = data.filter(b => b.date === req.query.date);
  data = data.filter(b => b.status === 'confirmed');
  data.sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
  res.json(data);
});

app.delete('/api/admin/bookings/:id', (req, res) => {
  if (req.query.password !== ADMIN_PASSWORD)
    return res.status(401).json({ error: 'Unauthorised' });

  const data = readBookings();
  const idx  = data.findIndex(b => b.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  data[idx].status = 'cancelled';
  writeBookings(data);
  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`\n✂  Barber Le Marsh`);
  console.log(`   Booking site → http://localhost:${PORT}`);
  console.log(`   Admin panel  → http://localhost:${PORT}/admin.html\n`);
});

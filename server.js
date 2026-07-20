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

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVICES = [
  { id: 'bundle-style-beard',    name: 'Style Cut & Beard Trim +', price: 23.00, duration: 45, description: 'Any style cut with beard trim and hot towel razor line up on the neck and cheeks.' },
  { id: 'oap',                   name: 'OAP 67+',                  price: 12.00, duration: 20, description: 'Any service for those 67+.' },
  { id: 'single-length',         name: 'Single Length All Over',   price: 10.00, duration: 15, description: 'Single length all over.' },
  { id: 'kids-cut',              name: 'Kids Cut',                 price: 12.00, duration: 20, description: 'Any haircut for younger children.' },
  { id: 'u16',                   name: '≤ U16 Haircut',            price: 15.00, duration: 25, description: 'Any haircut for those equal to or younger than 16 y/o.' },
  { id: 'short-back-sides',      name: 'Short Back & Sides',       price: 15.00, duration: 20, description: '1/2/3/4 back & sides with a trim on top.' },
  { id: 'style-cut',             name: 'Style Cut',                price: 17.00, duration: 30, description: 'Suitable for skin fade, taper, mullet, flow cut, crop, buzz-fade, afro, scissor cut.' },
  { id: 'beard-trim',            name: 'Beard Trim',               price: 6.00,  duration: 10, description: 'Any beard trim with just clippers/foiler.' },
  { id: 'beard-trim-plus',       name: 'Beard Trim +',             price: 8.00,  duration: 15, description: "Beard trim with a hot towel razored 'line-up'." },
];

// Keyed by JS day-of-week (0=Sun). Days absent = closed.
const OPENING_HOURS = {
  0: { open: '10:00', close: '18:00' }, // Sunday
  2: { open: '10:00', close: '18:00' }, // Tuesday
  3: { open: '10:00', close: '18:00' }, // Wednesday
  4: { open: '10:00', close: '18:00' }, // Thursday
  5: { open: '10:00', close: '18:00' }, // Friday
  6: { open: '10:00', close: '18:00' }, // Saturday
};

function toMins(t) {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function fromMins(n) {
  return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`;
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
  if (!hours) return res.json({ available: false, slots: [] });

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

app.post('/api/bookings', (req, res) => {
  const { serviceId, date, time, name, phone, email } = req.body;
  if (!serviceId || !date || !time || !name || !phone)
    return res.status(400).json({ error: 'Missing required fields' });

  const service = SERVICES.find(s => s.id === serviceId);
  if (!service) return res.status(400).json({ error: 'Invalid service' });

  const day = new Date(date + 'T12:00:00').getDay();
  if (!OPENING_HOURS[day]) return res.status(400).json({ error: 'Shop is closed on this day' });

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

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'barber2024';
const DATA_DIR      = process.env.DATA_DIR || __dirname;
const BOOKINGS_FILE = path.join(DATA_DIR, 'bookings.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SERVICES = [
  { id: 'bundle-style-beard',    name: 'Style Cut & Beard Trim +', price: 25.00, duration: 45, description: 'Any style cut with beard trim and hot towel razor line up on the neck and cheeks.' },
  { id: 'single-length',         name: 'Single Length All Over',   price: 12.00, duration: 20, description: 'Single length all over including beard, neck & ears. For the follicularly challenged…. :)' },
  { id: 'u16',                   name: '≤ U16 Haircut',            price: 15.00, duration: 25, description: 'Any haircut for those equal to or younger than 16 y/o.' },
  { id: 'short-back-sides',      name: 'Short Back & Sides',       price: 15.00, duration: 20, description: 'Simple 1/2/3/4 back & sides with a trim on top.' },
  { id: 'style-cut',             name: 'Style Cut',                price: 17.00, duration: 30, description: 'Suitable for skin fade, taper, mullet, flow cut, crop, buzz-fade, afro, scissor cut.' },
  { id: 'beard-trim',            name: 'Beard Trim',               price: 6.00,  duration: 10, description: 'Any beard trim with just clippers/foiler.' },
  { id: 'beard-trim-plus',       name: 'Beard Trim +',             price: 8.00,  duration: 15, description: "Beard trim with a hot towel razored 'line-up'." },
];

// Keyed by JS day-of-week (0=Sun). Days absent = closed.
const OPENING_HOURS = {
  2: { open: '10:00', close: '18:00' }, // Tuesday
  3: { open: '10:00', close: '18:00' }, // Wednesday
  4: { open: '10:00', close: '18:00' }, // Thursday
  5: { open: '10:00', close: '18:00' }, // Friday
  6: { open: '10:00', close: '15:00' }, // Saturday
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

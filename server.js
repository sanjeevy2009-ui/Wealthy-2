const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const db = new Database('wealthy.db');
const JWT_SECRET = process.env.JWT_SECRET || 'wealthy-dev-secret-change-in-prod';

/* ---------- SCHEMA ---------- */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY,
    theme TEXT DEFAULT 'light',
    accent TEXT DEFAULT 'green',
    card_color TEXT DEFAULT 'black',
    currency TEXT DEFAULT 'INR',
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    merchant TEXT, category TEXT, method TEXT,
    amount REAL, type TEXT, date TEXT, notes TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT, amount REAL, due_date TEXT, status TEXT, icon TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT, spent REAL, limit_amount REAL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT, saved REAL, target REAL, color TEXT,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT, last4 TEXT, color TEXT, holder TEXT,
    expiry TEXT, limit_amount REAL, used REAL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

/* ---------- MIDDLEWARE ---------- */
app.use(express.json());
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.cookies.token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.userId = payload.id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

/* ---------- SEED DEMO DATA ---------- */
function seedUser(userId) {
  const insTx = db.prepare('INSERT INTO transactions (user_id, merchant, category, method, amount, type, date) VALUES (?, ?, ?, ?, ?, ?, ?)');
  [
    ['Swiggy', 'Food & Dining', 'UPI · GPay', 420, 'expense', '2024-09-15'],
    ['Amazon India', 'Shopping', 'Wealthy Black Card · •••• 4821', 2499, 'expense', '2024-09-14'],
    ['Electricity (BESCOM)', 'Utilities · Auto-debit', 'HDFC Bank · •••• 9812', 1840, 'expense', '2024-09-14'],
    ['TechCorp India Pvt Ltd', 'Salary Credit', 'ICICI Salary · •••• 3319', 85000, 'income', '2024-09-01'],
    ['Blue Tokai Coffee', 'Cafes', 'PhonePe UPI QR', 280, 'expense', '2024-09-12'],
    ['Uber India', 'Transport', 'Wealthy Black Card · •••• 4821', 310, 'expense', '2024-09-11'],
    ['Airtel Fiber', 'Internet · Auto-debit', 'HDFC Bank · •••• 9812', 799, 'expense', '2024-09-10'],
    ['Cult.fit Fitness', 'Health · Subscription', 'UPI · GPay', 1500, 'expense', '2024-09-08'],
    ['Paragon Footwear', 'Shopping', 'Wealthy Black Card · •••• 4821', 2890, 'expense', '2024-09-06'],
    ['Transfer to Zerodha', 'Investment', 'HDFC → Zerodha', 10000, 'expense', '2024-09-05']
  ].forEach(t => insTx.run(userId, ...t));

  const insBill = db.prepare('INSERT INTO bills (user_id, name, amount, due_date, status, icon) VALUES (?, ?, ?, ?, ?, ?)');
  [
    ['Electricity (BESCOM)', 1840, '2024-09-16', 'upcoming', 'bolt'],
    ['HDFC Credit Card', 12840, '2024-09-18', 'upcoming', 'card'],
    ['Airtel Fiber Internet', 799, '2024-09-19', 'upcoming', 'wifi'],
    ['Netflix Subscription', 649, '2024-09-22', 'upcoming', 'bill'],
    ['Health Insurance', 2500, '2024-09-13', 'overdue', 'shield'],
    ['Spotify Family', 199, '2024-09-05', 'paid', 'bill']
  ].forEach(b => insBill.run(userId, ...b));

  const insBud = db.prepare('INSERT INTO budgets (user_id, name, spent, limit_amount) VALUES (?, ?, ?, ?)');
  [
    ['Food & Dining', 5420, 8000],
    ['Shopping & Lifestyle', 7800, 10000],
    ['Transport & Fuel', 3200, 5000],
    ['Bills & Utilities', 4200, 6000],
    ['Entertainment', 2190, 3000],
    ['Health & Fitness', 2100, 4000]
  ].forEach(b => insBud.run(userId, ...b));

  const insGoal = db.prepare('INSERT INTO goals (user_id, name, saved, target, color) VALUES (?, ?, ?, ?, ?)');
  [
    ['Laptop Fund', 45000, 80000, 'green'],
    ['Emergency Fund', 25000, 100000, 'blue'],
    ['Travel · Japan 2025', 18500, 50000, 'purple'],
    ['New Car Down Payment', 60000, 300000, 'yellow']
  ].forEach(g => insGoal.run(userId, ...g));

  const insCard = db.prepare('INSERT INTO cards (user_id, name, last4, color, holder, expiry, limit_amount, used) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  [
    ['Obsidian Black', '4821', 'black', 'ANANYA SHARMA', '09/28', 100000, 38500],
    ['Regalia Gold METAL', '9184', 'gold', 'ANANYA SHARMA', '11/28', 250000, 55000],
    ['Sapphiro Platinum', '3312', 'silver', 'ANANYA SHARMA', '03/31', 150000, 0]
  ].forEach(c => insCard.run(userId, ...c));
}

/* ---------- AUTH ROUTES ---------- */
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)')
      .run(name, email.toLowerCase(), hash);
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(r.lastInsertRowid);
    seedUser(r.lastInsertRowid);

    const token = jwt.sign({ id: r.lastInsertRowid }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
    res.json({ ok: true, user: { id: r.lastInsertRowid, name, email } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email || '').toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30 * 24 * 60 * 60 * 1000 });
  res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

app.get('/api/auth/me', auth, (req, res) => {
  const user = db.prepare('SELECT id, name, email FROM users WHERE id = ?').get(req.userId);
  if (!user) return res.status(401).json({ error: 'User not found' });
  res.json({ user });
});

/* ---------- SUMMARY ---------- */
app.get('/api/summary', auth, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(req.userId);
  const income = txs.filter(t => t.type === 'income').reduce((s, t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
  const savings = income - expense;
  const savingsRate = income > 0 ? (savings / income) * 100 : 0;
  const balance = 124850;
  res.json({ balance, income, expense, savings, savingsRate });
});

/* ---------- TRANSACTIONS ---------- */
app.get('/api/transactions', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC').all(req.userId));
});

app.post('/api/transactions', auth, (req, res) => {
  const { merchant, category, method, amount, type, date, notes } = req.body;
  const r = db.prepare('INSERT INTO transactions (user_id, merchant, category, method, amount, type, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, merchant, category, method, amount, type, date, notes || '');
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/transactions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

/* ---------- BILLS / BUDGETS / GOALS / CARDS ---------- */
app.get('/api/bills', auth, (req, res) => res.json(db.prepare('SELECT * FROM bills WHERE user_id = ?').all(req.userId)));
app.get('/api/budgets', auth, (req, res) => res.json(db.prepare('SELECT * FROM budgets WHERE user_id = ?').all(req.userId)));
app.get('/api/goals', auth, (req, res) => res.json(db.prepare('SELECT * FROM goals WHERE user_id = ?').all(req.userId)));
app.get('/api/cards', auth, (req, res) => res.json(db.prepare('SELECT * FROM cards WHERE user_id = ?').all(req.userId)));

/* ---------- SETTINGS ---------- */
app.get('/api/settings', auth, (req, res) => {
  let s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId);
  if (!s) {
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(req.userId);
    s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId);
  }
  res.json(s);
});

app.put('/api/settings', auth, (req, res) => {
  const { theme, accent, card_color, currency } = req.body;
  db.prepare(`UPDATE settings SET
    theme = COALESCE(?, theme),
    accent = COALESCE(?, accent),
    card_color = COALESCE(?, card_color),
    currency = COALESCE(?, currency)
    WHERE user_id = ?`).run(theme, accent, card_color, currency, req.userId);
  res.json(db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId));
});

/* ---------- START ---------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Wealthy running at http://localhost:${PORT}`));

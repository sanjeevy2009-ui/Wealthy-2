const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const db = new Database('wealthy.db');
const JWT_SECRET = process.env.JWT_SECRET || 'wealthy-dev-secret';

db.exec(`
  CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, card_number TEXT DEFAULT '', card_holder TEXT DEFAULT '', card_expiry TEXT DEFAULT '', created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS settings (user_id INTEGER PRIMARY KEY, theme TEXT DEFAULT 'light', accent TEXT DEFAULT 'green', card_color TEXT DEFAULT 'black', currency TEXT DEFAULT 'INR', upi_id TEXT DEFAULT '', qr_code TEXT DEFAULT '');
  CREATE TABLE IF NOT EXISTS transactions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, merchant TEXT, category TEXT, method TEXT, amount REAL, type TEXT, date TEXT, notes TEXT);
  CREATE TABLE IF NOT EXISTS bills (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, amount REAL, due_date TEXT, status TEXT, icon TEXT);
  CREATE TABLE IF NOT EXISTS budgets (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, spent REAL DEFAULT 0, limit_amount REAL);
  CREATE TABLE IF NOT EXISTS goals (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, saved REAL DEFAULT 0, target REAL, color TEXT DEFAULT 'green');
  CREATE TABLE IF NOT EXISTS cards (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, name TEXT, last4 TEXT, color TEXT, holder TEXT, expiry TEXT, limit_amount REAL, used REAL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS notifications (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER, title TEXT, message TEXT, type TEXT DEFAULT 'info', is_read INTEGER DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP);
`);

app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

/* ============ AUTH ============ */
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)').run(name, email.toLowerCase(), hash);
    const uid = r.lastInsertRowid;
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(uid);
    // Seed welcome notifications (not fake financial data)
    const insN = db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)');
    insN.run(uid, 'Welcome to Wealthy', 'Start by adding your first transaction.', 'info');
    insN.run(uid, 'Complete your profile', 'Add your card details in My Profile.', 'tip');
    insN.run(uid, 'Try UPI Hub', 'Add your UPI ID and QR code for quick payments.', 'tip');
    const token = jwt.sign({ id: uid }, JWT_SECRET, { expiresIn: '30d' });
    res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*60*60*1000 });
    res.json({ ok: true, user: { id: uid, name, email } });
  } catch (e) {
    if (e.message.includes('UNIQUE')) return res.status(400).json({ error: 'Email already registered' });
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', (req, res) => {
  const { email, password } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get((email||'').toLowerCase());
  if (!user || !bcrypt.compareSync(password, user.password)) return res.status(401).json({ error: 'Invalid email or password' });
  const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '30d' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'lax', maxAge: 30*24*60*60*1000 });
  res.json({ ok: true, user: { id: user.id, name: user.name, email: user.email } });
});

app.post('/api/auth/logout', (req, res) => { res.clearCookie('token'); res.json({ ok: true }); });

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT id, name, email, card_number, card_holder, card_expiry FROM users WHERE id = ?').get(req.userId);
  if (!u) return res.status(401).json({ error: 'Not found' });
  res.json({ user: u });
});

app.put('/api/auth/profile', auth, (req, res) => {
  const { name, card_number, card_holder, card_expiry } = req.body;
  db.prepare('UPDATE users SET name=COALESCE(?,name), card_number=COALESCE(?,card_number), card_holder=COALESCE(?,card_holder), card_expiry=COALESCE(?,card_expiry) WHERE id=?')
    .run(name, card_number, card_holder, card_expiry, req.userId);
  res.json(db.prepare('SELECT id, name, email, card_number, card_holder, card_expiry FROM users WHERE id = ?').get(req.userId));
});

/* ============ NOTIFICATIONS ============ */
app.get('/api/notifications', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 30').all(req.userId));
});
app.put('/api/notifications/read-all', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read = 1 WHERE user_id = ?').run(req.userId);
  res.json({ ok: true });
});
app.delete('/api/notifications/:id', auth, (req, res) => {
  db.prepare('DELETE FROM notifications WHERE id = ? AND user_id = ?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

/* ============ SUMMARY ============ */
app.get('/api/summary', auth, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(req.userId);
  const income = txs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const savings = income - expense;
  const rate = income > 0 ? (savings/income) * 100 : 0;
  res.json({ balance: savings, income, expense, savings, savingsRate: rate });
});

/* ============ TRANSACTIONS ============ */
app.get('/api/transactions', auth, (req, res) => {
  const { filter, search } = req.query;
  let rows = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC, id DESC').all(req.userId);
  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(t => (t.merchant||'').toLowerCase().includes(s) || (t.category||'').toLowerCase().includes(s));
  }
  if (filter && filter !== 'all') {
    const f = filter.toLowerCase();
    rows = rows.filter(t => {
      const m = (t.method||'').toLowerCase();
      if (f === 'income') return t.type === 'income';
      if (f === 'expense' || f === 'expenses') return t.type === 'expense';
      if (f === 'upi') return m.includes('upi');
      if (f === 'cards' || f === 'card') return m.includes('card');
      if (f === 'cash') return m.includes('cash');
      if (f === 'bank') return m.includes('bank') || m.includes('hdfc') || m.includes('icici') || m.includes('sbi');
      return true;
    });
  }
  res.json(rows);
});

app.post('/api/transactions', auth, (req, res) => {
  const { merchant, category, method, amount, type, date, notes } = req.body;
  const r = db.prepare('INSERT INTO transactions (user_id, merchant, category, method, amount, type, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, merchant, category, method, amount, type, date, notes || '');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/transactions/:id', auth, (req, res) => {
  const { merchant, category, method, amount, type, date, notes } = req.body;
  db.prepare(`UPDATE transactions SET merchant=COALESCE(?,merchant), category=COALESCE(?,category), method=COALESCE(?,method), amount=COALESCE(?,amount), type=COALESCE(?,type), date=COALESCE(?,date), notes=COALESCE(?,notes) WHERE id=? AND user_id=?`)
    .run(merchant, category, method, amount, type, date, notes, req.params.id, req.userId);
  res.json({ ok: true });
});

app.delete('/api/transactions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

/* ============ BILLS ============ */
app.get('/api/bills', auth, (req, res) => res.json(db.prepare('SELECT * FROM bills WHERE user_id = ? ORDER BY id DESC').all(req.userId)));
app.post('/api/bills', auth, (req, res) => {
  const { name, amount, due_date, status, icon } = req.body;
  const r = db.prepare('INSERT INTO bills (user_id, name, amount, due_date, status, icon) VALUES (?, ?, ?, ?, ?, ?)').run(req.userId, name, amount, due_date, status||'upcoming', icon||'bill');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/bills/:id', auth, (req, res) => {
  const { name, amount, due_date, status } = req.body;
  db.prepare('UPDATE bills SET name=COALESCE(?,name), amount=COALESCE(?,amount), due_date=COALESCE(?,due_date), status=COALESCE(?,status) WHERE id=? AND user_id=?').run(name, amount, due_date, status, req.params.id, req.userId);
  res.json({ ok: true });
});
app.delete('/api/bills/:id', auth, (req, res) => { db.prepare('DELETE FROM bills WHERE id=? AND user_id=?').run(req.params.id, req.userId); res.json({ ok: true }); });

/* ============ BUDGETS ============ */
app.get('/api/budgets', auth, (req, res) => res.json(db.prepare('SELECT * FROM budgets WHERE user_id = ?').all(req.userId)));
app.post('/api/budgets', auth, (req, res) => {
  const { name, limit_amount } = req.body;
  const r = db.prepare('INSERT INTO budgets (user_id, name, spent, limit_amount) VALUES (?, ?, 0, ?)').run(req.userId, name, limit_amount);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/budgets/:id', auth, (req, res) => {
  const { name, spent, limit_amount } = req.body;
  db.prepare('UPDATE budgets SET name=COALESCE(?,name), spent=COALESCE(?,spent), limit_amount=COALESCE(?,limit_amount) WHERE id=? AND user_id=?').run(name, spent, limit_amount, req.params.id, req.userId);
  res.json({ ok: true });
});
app.delete('/api/budgets/:id', auth, (req, res) => { db.prepare('DELETE FROM budgets WHERE id=? AND user_id=?').run(req.params.id, req.userId); res.json({ ok: true }); });

/* ============ GOALS ============ */
app.get('/api/goals', auth, (req, res) => res.json(db.prepare('SELECT * FROM goals WHERE user_id = ?').all(req.userId)));
app.post('/api/goals', auth, (req, res) => {
  const { name, saved, target, color } = req.body;
  const r = db.prepare('INSERT INTO goals (user_id, name, saved, target, color) VALUES (?, ?, ?, ?, ?)').run(req.userId, name, saved||0, target, color||'green');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/goals/:id', auth, (req, res) => {
  const { name, saved, target, color } = req.body;
  db.prepare('UPDATE goals SET name=COALESCE(?,name), saved=COALESCE(?,saved), target=COALESCE(?,target), color=COALESCE(?,color) WHERE id=? AND user_id=?').run(name, saved, target, color, req.params.id, req.userId);
  res.json({ ok: true });
});
app.delete('/api/goals/:id', auth, (req, res) => { db.prepare('DELETE FROM goals WHERE id=? AND user_id=?').run(req.params.id, req.userId); res.json({ ok: true }); });

/* ============ CARDS ============ */
app.get('/api/cards', auth, (req, res) => res.json(db.prepare('SELECT * FROM cards WHERE user_id = ?').all(req.userId)));
app.post('/api/cards', auth, (req, res) => {
  const { name, last4, color, holder, expiry, limit_amount } = req.body;
  const r = db.prepare('INSERT INTO cards (user_id, name, last4, color, holder, expiry, limit_amount, used) VALUES (?, ?, ?, ?, ?, ?, ?, 0)').run(req.userId, name, last4, color, holder, expiry, limit_amount);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/cards/:id', auth, (req, res) => {
  const { name, last4, color, holder, expiry, limit_amount, used } = req.body;
  db.prepare('UPDATE cards SET name=COALESCE(?,name), last4=COALESCE(?,last4), color=COALESCE(?,color), holder=COALESCE(?,holder), expiry=COALESCE(?,expiry), limit_amount=COALESCE(?,limit_amount), used=COALESCE(?,used) WHERE id=? AND user_id=?').run(name, last4, color, holder, expiry, limit_amount, used, req.params.id, req.userId);
  res.json({ ok: true });
});
app.delete('/api/cards/:id', auth, (req, res) => { db.prepare('DELETE FROM cards WHERE id=? AND user_id=?').run(req.params.id, req.userId); res.json({ ok: true }); });

/* ============ SETTINGS ============ */
app.get('/api/settings', auth, (req, res) => {
  let s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId);
  if (!s) { db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(req.userId); s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId); }
  res.json(s);
});
app.put('/api/settings', auth, (req, res) => {
  const { theme, accent, card_color, currency, upi_id, qr_code } = req.body;
  db.prepare(`UPDATE settings SET theme=COALESCE(?,theme), accent=COALESCE(?,accent), card_color=COALESCE(?,card_color), currency=COALESCE(?,currency), upi_id=COALESCE(?,upi_id), qr_code=COALESCE(?,qr_code) WHERE user_id=?`).run(theme, accent, card_color, currency, upi_id, qr_code, req.userId);
  res.json(db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✓ Wealthy running at http://localhost:${PORT}`));

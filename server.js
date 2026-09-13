const express = require('express');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const path = require('path');

const app = express();
const db = new Database('wealthy.db');
const JWT_SECRET = process.env.JWT_SECRET || 'wealthy-dev-secret';

/* ============ SCHEMA ============ */
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    card_number TEXT DEFAULT '',
    card_holder TEXT DEFAULT '',
    card_expiry TEXT DEFAULT '',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
    user_id INTEGER PRIMARY KEY,
    theme TEXT DEFAULT 'light',
    accent TEXT DEFAULT 'green',
    card_color TEXT DEFAULT 'black',
    currency TEXT DEFAULT 'INR',
    upi_id TEXT DEFAULT '',
    qr_code TEXT DEFAULT ''
  );

  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'bank',
    opening_balance REAL DEFAULT 0,
    currency TEXT DEFAULT 'INR',
    color TEXT DEFAULT 'green',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    icon TEXT DEFAULT 'tag',
    color TEXT DEFAULT 'green',
    type TEXT DEFAULT 'expense',
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    account_id INTEGER,
    category_id INTEGER,
    merchant TEXT,
    category TEXT,
    method TEXT,
    amount REAL,
    type TEXT,
    date TEXT,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id),
    FOREIGN KEY(account_id) REFERENCES accounts(id)
  );

  CREATE TABLE IF NOT EXISTS transfers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    from_account_id INTEGER NOT NULL,
    to_account_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS bills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT,
    amount REAL,
    due_date TEXT,
    status TEXT,
    icon TEXT,
    account_id INTEGER,
    is_recurring INTEGER DEFAULT 0,
    frequency TEXT DEFAULT 'monthly',
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT,
    spent REAL DEFAULT 0,
    limit_amount REAL,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS goals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT,
    saved REAL DEFAULT 0,
    target REAL,
    color TEXT DEFAULT 'green',
    target_date TEXT,
    monthly_contribution REAL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT,
    last4 TEXT,
    color TEXT,
    holder TEXT,
    expiry TEXT,
    limit_amount REAL,
    used REAL DEFAULT 0,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    title TEXT,
    message TEXT,
    type TEXT DEFAULT 'info',
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    amount REAL NOT NULL,
    billing_cycle TEXT DEFAULT 'monthly',
    next_billing TEXT,
    status TEXT DEFAULT 'active',
    account_id INTEGER,
    notes TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS debts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    principal REAL NOT NULL,
    remaining REAL NOT NULL,
    interest_rate REAL DEFAULT 0,
    min_payment REAL DEFAULT 0,
    due_date TEXT,
    account_id INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// Safe migrations for existing databases
try { db.exec('ALTER TABLE transactions ADD COLUMN account_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE transactions ADD COLUMN category_id INTEGER'); } catch(e) {}
try { db.exec('ALTER TABLE transactions ADD COLUMN notes TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE goals ADD COLUMN target_date TEXT'); } catch(e) {}
try { db.exec('ALTER TABLE goals ADD COLUMN monthly_contribution REAL DEFAULT 0'); } catch(e) {}

/* ============ MIDDLEWARE ============ */
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'public')));

function auth(req, res, next) {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
  try { req.userId = jwt.verify(token, JWT_SECRET).id; next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

/* ============ AUTH ROUTES ============ */
app.post('/api/auth/signup', (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
  try {
    const hash = bcrypt.hashSync(password, 10);
    const r = db.prepare('INSERT INTO users (name, email, password) VALUES (?, ?, ?)').run(name, email.toLowerCase(), hash);
    const uid = r.lastInsertRowid;
    db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(uid);

    // Create default cash account
    db.prepare('INSERT INTO accounts (user_id, name, type, opening_balance, color) VALUES (?, ?, ?, ?, ?)').run(uid, 'Cash', 'cash', 0, 'green');
    db.prepare('INSERT INTO accounts (user_id, name, type, opening_balance, color) VALUES (?, ?, ?, ?, ?)').run(uid, 'Bank Account', 'bank', 0, 'blue');

    const insN = db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)');
    insN.run(uid, 'Welcome to Wealthy', 'Your personal finance hub is ready.', 'info');
    insN.run(uid, 'Add your first transaction', 'Tap the + button to get started.', 'tip');
    insN.run(uid, 'Set up UPI Hub', 'Add your UPI ID and QR code.', 'tip');

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

/* ============ SUMMARY (BASIC) ============ */
app.get('/api/summary', auth, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(req.userId);
  const income = txs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const savings = income - expense;
  const rate = income > 0 ? (savings/income) * 100 : 0;

  // Account balance
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ?').all(req.userId);
  let totalBalance = 0;
  accounts.forEach(a => {
    const inc = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE user_id = ? AND account_id = ? AND type = ?').get(req.userId, a.id, 'income').s;
    const exp = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE user_id = ? AND account_id = ? AND type = ?').get(req.userId, a.id, 'expense').s;
    const ti = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE user_id = ? AND to_account_id = ?').get(req.userId, a.id).s;
    const to = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE user_id = ? AND from_account_id = ?').get(req.userId, a.id).s;
    totalBalance += a.opening_balance + inc - exp + ti - to;
  });

  res.json({ balance: totalBalance, income, expense, savings, savingsRate: rate });
});

/* ============ DASHBOARD STATS (ENHANCED) ============ */
app.get('/api/dashboard/stats', auth, (req, res) => {
  const range = req.query.range || 'month';
  const now = new Date();
  let from = new Date();

  if (range === 'week') from.setDate(now.getDate() - 7);
  else if (range === 'month') from.setMonth(now.getMonth() - 1);
  else if (range === '3m') from.setMonth(now.getMonth() - 3);
  else if (range === '6m') from.setMonth(now.getMonth() - 6);
  else if (range === 'year') from.setFullYear(now.getFullYear() - 1);
  else if (range === 'all') from = new Date(0);

  const fromISO = from.toISOString().split('T')[0];

  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND date >= ? ORDER BY date DESC').all(req.userId, fromISO);
  const income = txs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const savings = income - expense;
  const rate = income > 0 ? (savings/income) * 100 : 0;

  // Category breakdown
  const byCategory = {};
  txs.filter(t => t.type === 'expense').forEach(t => {
    const cat = t.category || 'Other';
    byCategory[cat] = (byCategory[cat] || 0) + t.amount;
  });

  // Monthly trend (last 6 months)
  const monthlyTrend = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const y = d.getFullYear(), m = d.getMonth();
    const monthName = d.toLocaleDateString('en-IN', { month: 'short' });
    const monthTxs = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND strftime("%Y-%m", date) = ?').all(req.userId, `${y}-${String(m+1).padStart(2,'0')}`);
    const inc = monthTxs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
    const exp = monthTxs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
    monthlyTrend.push({ month: monthName, income: inc, expense: exp, savings: inc - exp });
  }

  // Compare this month vs last month
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth()-1, 1).toISOString().split('T')[0];
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split('T')[0];

  const thisMonthTxs = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND date >= ?').all(req.userId, thisMonthStart);
  const lastMonthTxs = db.prepare('SELECT * FROM transactions WHERE user_id = ? AND date >= ? AND date <= ?').all(req.userId, lastMonthStart, lastMonthEnd);

  const thisMonthIncome = thisMonthTxs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const thisMonthExpense = thisMonthTxs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const lastMonthIncome = lastMonthTxs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const lastMonthExpense = lastMonthTxs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);

  // Budget usage
  const budgets = db.prepare('SELECT * FROM budgets WHERE user_id = ?').all(req.userId);
  const totalBudget = budgets.reduce((s,b) => s + b.limit_amount, 0);
  const totalSpent = budgets.reduce((s,b) => s + b.spent, 0);
  const budgetUsage = totalBudget > 0 ? (totalSpent/totalBudget)*100 : 0;

  // Upcoming bills
  const upcomingBills = db.prepare('SELECT * FROM bills WHERE user_id = ? AND status = ? ORDER BY due_date ASC LIMIT 5').all(req.userId, 'upcoming');

  res.json({
    income, expense, savings, savingsRate: rate,
    byCategory,
    monthlyTrend,
    thisMonth: { income: thisMonthIncome, expense: thisMonthExpense },
    lastMonth: { income: lastMonthIncome, expense: lastMonthExpense },
    budgetUsage,
    upcomingBills,
    transactionCount: txs.length
  });
});

/* ============ FINANCIAL HEALTH SCORE ============ */
app.get('/api/health-score', auth, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ?').all(req.userId);
  const income = txs.filter(t => t.type === 'income').reduce((s,t) => s + t.amount, 0);
  const expense = txs.filter(t => t.type === 'expense').reduce((s,t) => s + t.amount, 0);
  const savings = income - expense;
  const savingsRate = income > 0 ? (savings/income) * 100 : 0;

  const budgets = db.prepare('SELECT * FROM budgets WHERE user_id = ?').all(req.userId);
  const overBudgetCount = budgets.filter(b => b.spent > b.limit_amount).length;
  const budgetDiscipline = budgets.length > 0 ? Math.max(0, 100 - (overBudgetCount/budgets.length)*100) : 50;

  const goals = db.prepare('SELECT * FROM goals WHERE user_id = ?').all(req.userId);
  const goalsProgress = goals.length > 0 ? (goals.reduce((s,g) => s + (g.saved/g.target), 0)/goals.length) * 100 : 50;

  const recurringCost = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM subscriptions WHERE user_id = ? AND status = ?').get(req.userId, 'active').s;
  const recurringBurden = income > 0 ? (recurringCost/income)*100 : 0;

  // Score calculation (0-100)
  let score = 50;
  const factors = [];

  // Savings rate (max +30)
  if (savingsRate >= 30) { score += 30; factors.push({ label: 'Savings Rate', delta: +30, detail: `${savingsRate.toFixed(1)}% — excellent` }); }
  else if (savingsRate >= 20) { score += 20; factors.push({ label: 'Savings Rate', delta: +20, detail: `${savingsRate.toFixed(1)}% — good` }); }
  else if (savingsRate >= 10) { score += 10; factors.push({ label: 'Savings Rate', delta: +10, detail: `${savingsRate.toFixed(1)}% — fair` }); }
  else if (savingsRate >= 0) { score += 0; factors.push({ label: 'Savings Rate', delta: 0, detail: `${savingsRate.toFixed(1)}% — needs improvement` }); }
  else { score -= 10; factors.push({ label: 'Savings Rate', delta: -10, detail: `Negative savings` }); }

  // Budget discipline (max +15)
  if (budgets.length > 0) {
    const d = Math.round((budgetDiscipline/100) * 15);
    score += d;
    factors.push({ label: 'Budget Discipline', delta: +d, detail: `${budgets.length - overBudgetCount}/${budgets.length} on track` });
  }

  // Goal progress (max +10)
  if (goals.length > 0) {
    const d = Math.round((goalsProgress/100) * 10);
    score += d;
    factors.push({ label: 'Goal Progress', delta: +d, detail: `${goals.length} active goals` });
  }

  // Recurring burden (max -10)
  if (recurringBurden > 20) { score -= 10; factors.push({ label: 'High Recurring Cost', delta: -10, detail: `${recurringBurden.toFixed(0)}% of income` }); }
  else if (recurringBurden > 10) { score -= 4; factors.push({ label: 'Recurring Cost', delta: -4, detail: `${recurringBurden.toFixed(0)}% of income` }); }
  else if (recurringCost > 0) { factors.push({ label: 'Recurring Cost', delta: 0, detail: 'Healthy' }); }

  // Consistency (max +10)
  const activeDays = new Set(txs.map(t => t.date)).size;
  if (activeDays > 30) { score += 10; factors.push({ label: 'Tracking Consistency', delta: +10, detail: `${activeDays} active days` }); }
  else if (activeDays > 10) { score += 5; factors.push({ label: 'Tracking Consistency', delta: +5, detail: `${activeDays} active days` }); }

  score = Math.max(0, Math.min(100, score));

  let label = 'Needs Attention';
  if (score >= 80) label = 'Excellent';
  else if (score >= 65) label = 'Good';
  else if (score >= 50) label = 'Fair';

  res.json({ score, label, factors });
});

/* ============ ACCOUNTS ============ */
app.get('/api/accounts', auth, (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY id ASC').all(req.userId);
  const withBalance = accounts.map(a => {
    const inc = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE user_id = ? AND account_id = ? AND type = ?').get(req.userId, a.id, 'income').s;
    const exp = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE user_id = ? AND account_id = ? AND type = ?').get(req.userId, a.id, 'expense').s;
    const ti = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE user_id = ? AND to_account_id = ?').get(req.userId, a.id).s;
    const to = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transfers WHERE user_id = ? AND from_account_id = ?').get(req.userId, a.id).s;
    const balance = a.opening_balance + inc - exp + ti - to;
    return { ...a, balance, income: inc, expense: exp };
  });
  res.json(withBalance);
});

app.post('/api/accounts', auth, (req, res) => {
  const { name, type, opening_balance, color } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const r = db.prepare('INSERT INTO accounts (user_id, name, type, opening_balance, color) VALUES (?, ?, ?, ?, ?)')
    .run(req.userId, name, type || 'bank', opening_balance || 0, color || 'green');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/accounts/:id', auth, (req, res) => {
  const { name, type, opening_balance, color, is_active } = req.body;
  db.prepare(`UPDATE accounts SET name=COALESCE(?,name), type=COALESCE(?,type), opening_balance=COALESCE(?,opening_balance), color=COALESCE(?,color), is_active=COALESCE(?,is_active) WHERE id=? AND user_id=?`)
    .run(name, type, opening_balance, color, is_active, req.params.id, req.userId);
  res.json({ ok: true });
});

app.delete('/api/accounts/:id', auth, (req, res) => {
  db.prepare('DELETE FROM accounts WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

/* ============ TRANSFERS ============ */
app.get('/api/transfers', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM transfers WHERE user_id = ? ORDER BY date DESC').all(req.userId));
});

app.post('/api/accounts/transfer', auth, (req, res) => {
  const { from_account_id, to_account_id, amount, date, notes } = req.body;
  if (!from_account_id || !to_account_id || !amount) return res.status(400).json({ error: 'All fields required' });
  if (from_account_id === to_account_id) return res.status(400).json({ error: 'Same account not allowed' });
  const r = db.prepare('INSERT INTO transfers (user_id, from_account_id, to_account_id, amount, date, notes) VALUES (?, ?, ?, ?, ?, ?)')
    .run(req.userId, from_account_id, to_account_id, amount, date || new Date().toISOString().split('T')[0], notes || '');
  res.json({ id: r.lastInsertRowid });
});

/* ============ TRANSACTIONS ============ */
app.get('/api/transactions', auth, (req, res) => {
  const { filter, search, from, to, account_id, type, category, sort } = req.query;
  let query = 'SELECT * FROM transactions WHERE user_id = ?';
  const params = [req.userId];

  if (from) { query += ' AND date >= ?'; params.push(from); }
  if (to) { query += ' AND date <= ?'; params.push(to); }
  if (account_id) { query += ' AND account_id = ?'; params.push(account_id); }
  if (type) { query += ' AND type = ?'; params.push(type); }
  if (category) { query += ' AND category = ?'; params.push(category); }

  let orderBy = 'ORDER BY date DESC, id DESC';
  if (sort === 'amount_asc') orderBy = 'ORDER BY amount ASC';
  if (sort === 'amount_desc') orderBy = 'ORDER BY amount DESC';
  if (sort === 'date_asc') orderBy = 'ORDER BY date ASC';

  query += ' ' + orderBy;

  let rows = db.prepare(query).all(...params);

  if (search) {
    const s = search.toLowerCase();
    rows = rows.filter(t => (t.merchant||'').toLowerCase().includes(s) || (t.category||'').toLowerCase().includes(s));
  }
  if (filter && filter !== 'all') {
    const f = filter.toLowerCase();
    rows = rows.filter(t => {
      const m = (t.method||'').toLowerCase();
      if (f === 'income') return t.type === 'income';
      if (f === 'expense') return t.type === 'expense';
      if (f === 'upi') return m.includes('upi');
      if (f === 'cards') return m.includes('card');
      if (f === 'cash') return m.includes('cash');
      if (f === 'bank') return m.includes('bank') || m.includes('hdfc') || m.includes('icici');
      return true;
    });
  }
  res.json(rows);
});

app.post('/api/transactions', auth, (req, res) => {
  const { merchant, category, method, amount, type, date, notes, account_id } = req.body;
  const r = db.prepare('INSERT INTO transactions (user_id, account_id, merchant, category, method, amount, type, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, account_id || null, merchant, category, method, amount, type, date, notes || '');
  res.json({ id: r.lastInsertRowid });
});

app.put('/api/transactions/:id', auth, (req, res) => {
  const { merchant, category, method, amount, type, date, notes, account_id } = req.body;
  db.prepare(`UPDATE transactions SET merchant=COALESCE(?,merchant), category=COALESCE(?,category), method=COALESCE(?,method), amount=COALESCE(?,amount), type=COALESCE(?,type), date=COALESCE(?,date), notes=COALESCE(?,notes), account_id=COALESCE(?,account_id) WHERE id=? AND user_id=?`)
    .run(merchant, category, method, amount, type, date, notes, account_id, req.params.id, req.userId);
  res.json({ ok: true });
});

app.post('/api/transactions/:id/duplicate', auth, (req, res) => {
  const t = db.prepare('SELECT * FROM transactions WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!t) return res.status(404).json({ error: 'Not found' });
  const r = db.prepare('INSERT INTO transactions (user_id, account_id, merchant, category, method, amount, type, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, t.account_id, t.merchant + ' (copy)', t.category, t.method, t.amount, t.type, new Date().toISOString().split('T')[0], t.notes);
  res.json({ id: r.lastInsertRowid });
});

app.delete('/api/transactions/:id', auth, (req, res) => {
  db.prepare('DELETE FROM transactions WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

/* ============ BILLS ============ */
app.get('/api/bills', auth, (req, res) => res.json(db.prepare('SELECT * FROM bills WHERE user_id = ? ORDER BY id DESC').all(req.userId)));
app.post('/api/bills', auth, (req, res) => {
  const { name, amount, due_date, status, icon, account_id, is_recurring, frequency } = req.body;
  const r = db.prepare('INSERT INTO bills (user_id, name, amount, due_date, status, icon, account_id, is_recurring, frequency) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, name, amount, due_date, status||'upcoming', icon||'bill', account_id||null, is_recurring||0, frequency||'monthly');
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
  const { name, saved, target, color, target_date, monthly_contribution } = req.body;
  const r = db.prepare('INSERT INTO goals (user_id, name, saved, target, color, target_date, monthly_contribution) VALUES (?, ?, ?, ?, ?, ?, ?)').run(req.userId, name, saved||0, target, color||'green', target_date||null, monthly_contribution||0);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/goals/:id', auth, (req, res) => {
  const { name, saved, target, color, target_date, monthly_contribution } = req.body;
  db.prepare('UPDATE goals SET name=COALESCE(?,name), saved=COALESCE(?,saved), target=COALESCE(?,target), color=COALESCE(?,color), target_date=COALESCE(?,target_date), monthly_contribution=COALESCE(?,monthly_contribution) WHERE id=? AND user_id=?').run(name, saved, target, color, target_date, monthly_contribution, req.params.id, req.userId);
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

/* ============ SUBSCRIPTIONS ============ */
app.get('/api/subscriptions', auth, (req, res) => res.json(db.prepare('SELECT * FROM subscriptions WHERE user_id = ? ORDER BY id DESC').all(req.userId)));
app.post('/api/subscriptions', auth, (req, res) => {
  const { name, amount, billing_cycle, next_billing, status, account_id, notes } = req.body;
  const r = db.prepare('INSERT INTO subscriptions (user_id, name, amount, billing_cycle, next_billing, status, account_id, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, name, amount, billing_cycle||'monthly', next_billing||null, status||'active', account_id||null, notes||'');
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/subscriptions/:id', auth, (req, res) => {
  const { name, amount, billing_cycle, next_billing, status } = req.body;
  db.prepare('UPDATE subscriptions SET name=COALESCE(?,name), amount=COALESCE(?,amount), billing_cycle=COALESCE(?,billing_cycle), next_billing=COALESCE(?,next_billing), status=COALESCE(?,status) WHERE id=? AND user_id=?').run(name, amount, billing_cycle, next_billing, status, req.params.id, req.userId);
  res.json({ ok: true });
});
app.delete('/api/subscriptions/:id', auth, (req, res) => { db.prepare('DELETE FROM subscriptions WHERE id=? AND user_id=?').run(req.params.id, req.userId); res.json({ ok: true }); });

/* ============ DEBTS ============ */
app.get('/api/debts', auth, (req, res) => res.json(db.prepare('SELECT * FROM debts WHERE user_id = ?').all(req.userId)));
app.post('/api/debts', auth, (req, res) => {
  const { name, principal, remaining, interest_rate, min_payment, due_date, account_id } = req.body;
  const r = db.prepare('INSERT INTO debts (user_id, name, principal, remaining, interest_rate, min_payment, due_date, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(req.userId, name, principal, remaining||principal, interest_rate||0, min_payment||0, due_date||null, account_id||null);
  res.json({ id: r.lastInsertRowid });
});
app.put('/api/debts/:id', auth, (req, res) => {
  const { name, principal, remaining, interest_rate, min_payment, due_date } = req.body;
  db.prepare('UPDATE debts SET name=COALESCE(?,name), principal=COALESCE(?,principal), remaining=COALESCE(?,remaining), interest_rate=COALESCE(?,interest_rate), min_payment=COALESCE(?,min_payment), due_date=COALESCE(?,due_date) WHERE id=? AND user_id=?').run(name, principal, remaining, interest_rate, min_payment, due_date, req.params.id, req.userId);
  res.json({ ok: true });
});
app.delete('/api/debts/:id', auth, (req, res) => { db.prepare('DELETE FROM debts WHERE id=? AND user_id=?').run(req.params.id, req.userId); res.json({ ok: true }); });

/* ============ NET WORTH ============ */
app.get('/api/net-worth', auth, (req, res) => {
  const accounts = db.prepare('SELECT * FROM accounts WHERE user_id = ? AND is_active = 1').all(req.userId);
  let assets = 0;
  accounts.forEach(a => {
    if (a.type === 'credit_card') return;
    const inc = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE user_id = ? AND account_id = ? AND type = ?').get(req.userId, a.id, 'income').s;
    const exp = db.prepare('SELECT COALESCE(SUM(amount),0) as s FROM transactions WHERE user_id = ? AND account_id = ? AND type = ?').get(req.userId, a.id, 'expense').s;
    assets += a.opening_balance + inc - exp;
  });

  const cards = db.prepare('SELECT * FROM cards WHERE user_id = ?').all(req.userId);
  const cardDebt = cards.reduce((s,c) => s + (c.used || 0), 0);

  const debts = db.prepare('SELECT * FROM debts WHERE user_id = ?').all(req.userId);
  const totalDebt = debts.reduce((s,d) => s + d.remaining, 0);

  const liabilities = cardDebt + totalDebt;
  const netWorth = assets - liabilities;

  res.json({ assets, liabilities, netWorth, cardDebt, totalDebt });
});

/* ============ SETTINGS ============ */
app.get('/api/settings', auth, (req, res) => {
  let s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId);
  if (!s) { db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(req.userId); s = db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId); }
  res.json(s);
});
app.put('/api/settings', auth, (req, res) => {
  const { theme, accent, card_color, currency, upi_id, qr_code } = req.body;
  db.prepare('UPDATE settings SET theme=COALESCE(?,theme), accent=COALESCE(?,accent), card_color=COALESCE(?,card_color), currency=COALESCE(?,currency), upi_id=COALESCE(?,upi_id), qr_code=COALESCE(?,qr_code) WHERE user_id=?').run(theme, accent, card_color, currency, upi_id, qr_code, req.userId);
  res.json(db.prepare('SELECT * FROM settings WHERE user_id = ?').get(req.userId));
});

/* ============ EXPORT ============ */
app.get('/api/export/csv', auth, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC').all(req.userId);
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.userId);
  let csv = `Wealthy Export\nExported By,${user.name}\nExported At,${new Date().toLocaleString('en-IN')}\nRecords,${txs.length}\n\nDate,Merchant,Category,Method,Type,Amount,Notes\n`;
  txs.forEach(t => {
    csv += `${t.date},"${(t.merchant||'').replace(/"/g,'""')}","${(t.category||'').replace(/"/g,'""')}","${(t.method||'').replace(/"/g,'""')}",${t.type},${t.amount},"${(t.notes||'').replace(/"/g,'""')}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="wealthy-${new Date().toISOString().split('T')[0]}.csv"`);
  res.send(csv);
});

app.get('/api/export/json', auth, (req, res) => {
  const txs = db.prepare('SELECT * FROM transactions WHERE user_id = ? ORDER BY date DESC').all(req.userId);
  const user = db.prepare('SELECT name, email FROM users WHERE id = ?').get(req.userId);
  res.setHeader('Content-Disposition', `attachment; filename="wealthy-${new Date().toISOString().split('T')[0]}.json"`);
  res.json({ exportedAt: new Date().toISOString(), exportedBy: user, count: txs.length, transactions: txs });
});

/* ============ BULK IMPORT ============ */
app.post('/api/transactions/import', auth, (req, res) => {
  const { transactions } = req.body;
  if (!Array.isArray(transactions) || !transactions.length) return res.status(400).json({ error: 'No transactions' });
  const ins = db.prepare('INSERT INTO transactions (user_id, merchant, category, method, amount, type, date, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  let inserted = 0;
  const importTx = db.transaction((items) => {
    items.forEach(t => {
      if (!t.date || !t.amount) return;
      ins.run(req.userId, t.merchant || 'Imported', t.category || 'Other', t.method || 'Bank Transfer', Math.abs(parseFloat(t.amount)), t.type || 'expense', t.date, t.notes || 'Imported');
      inserted++;
    });
  });
  importTx(transactions);
  const insN = db.prepare('INSERT INTO notifications (user_id, title, message, type) VALUES (?, ?, ?, ?)');
  insN.run(req.userId, 'Import complete', `${inserted} transactions imported.`, 'success');
  res.json({ ok: true, inserted });
});

/* ============ START ============ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✓ Wealthy running at http://localhost:${PORT}`));

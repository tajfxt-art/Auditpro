// ═══════════════════════════════════════════════════════
//  AuditPro — Central Server
//  Node.js + Express + SQLite (easy local) / SQL Server (production)
//
//  HOW TO RUN:
//    1. npm install
//    2. node server.js
//    3. Open http://localhost:3000 on ANY device on same network
//       OR deploy to Railway/Render for internet access
// ═══════════════════════════════════════════════════════

require('dotenv').config();
const express    = require('express');
const cors       = require('cors');
const path       = require('path');
const bcrypt     = require('bcryptjs');
const jwt        = require('jsonwebtoken');
const compression= require('compression');
const Database   = require('better-sqlite3');

const app  = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'auditpro_dev_secret';
const DB_PATH    = process.env.DB_PATH    || './auditpro.db';

// ── MIDDLEWARE ──────────────────────────────────────
app.use(compression());
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public'))); // serves your frontend

// ── DATABASE SETUP ──────────────────────────────────
const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL'); // faster writes

// Create all tables on first run
db.exec(`
  CREATE TABLE IF NOT EXISTS companies (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    name      TEXT NOT NULL UNIQUE,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS shops (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    name         TEXT NOT NULL,
    company_id   INTEGER NOT NULL,
    city         TEXT,
    address      TEXT,
    inspector_id INTEGER,
    last_score   INTEGER DEFAULT 0,
    last_date    TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (company_id) REFERENCES companies(id)
  );

  CREATE TABLE IF NOT EXISTS users (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT NOT NULL,
    username   TEXT NOT NULL UNIQUE,
    password   TEXT NOT NULL,
    role       TEXT NOT NULL CHECK(role IN ('admin','management','inspector')),
    company_id INTEGER,
    active     INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id      INTEGER NOT NULL,
    inspector_id INTEGER NOT NULL,
    assigned_by  INTEGER NOT NULL,
    due_date     TEXT NOT NULL,
    notes        TEXT,
    status       TEXT DEFAULT 'pending' CHECK(status IN ('pending','done','overdue')),
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id)      REFERENCES shops(id),
    FOREIGN KEY (inspector_id) REFERENCES users(id),
    FOREIGN KEY (assigned_by)  REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS inspections (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id      INTEGER,
    shop_id      INTEGER NOT NULL,
    inspector_id INTEGER NOT NULL,
    score        INTEGER NOT NULL,
    severity     TEXT DEFAULT 'low',
    notes        TEXT,
    issue_count  INTEGER DEFAULT 0,
    created_at   TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id)      REFERENCES shops(id),
    FOREIGN KEY (inspector_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS checklist_answers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    inspection_id INTEGER NOT NULL,
    category      TEXT NOT NULL,
    item_label    TEXT NOT NULL,
    answer        TEXT NOT NULL CHECK(answer IN ('yes','no')),
    FOREIGN KEY (inspection_id) REFERENCES inspections(id)
  );

  CREATE TABLE IF NOT EXISTS stock_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    shop_id     INTEGER NOT NULL,
    name        TEXT NOT NULL,
    sys_qty     INTEGER DEFAULT 0,
    phys_qty    INTEGER DEFAULT 0,
    checked_at  TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (shop_id) REFERENCES shops(id)
  );

  CREATE TABLE IF NOT EXISTS notifications (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    message    TEXT NOT NULL,
    color      TEXT DEFAULT '#16A34A',
    for_role   TEXT DEFAULT 'all',
    is_read    INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );
`);

// ── SEED DEMO DATA (only runs if no companies exist) ──
const hasData = db.prepare('SELECT COUNT(*) as c FROM companies').get();
if (hasData.c === 0) {
  console.log('🌱 Seeding demo data...');

  // Companies
  const insertCo = db.prepare('INSERT INTO companies (name) VALUES (?)');
  insertCo.run('Taif Al Emarat');
  insertCo.run('Ramasat');
  insertCo.run('Cunzite');
  insertCo.run('Primachi');

  // Admin user (password: admin123)
  const hash = bcrypt.hashSync('admin123', 10);
  const insertUser = db.prepare('INSERT INTO users (name,username,password,role,company_id) VALUES (?,?,?,?,?)');
  insertUser.run('Ahmed Mohamed', 'admin',  hash, 'admin',      null);
  insertUser.run('Fatima Al Zaabi','fatima', bcrypt.hashSync('pass123',10), 'management', null);
  insertUser.run('Khalid Al Farsi','khalid', bcrypt.hashSync('pass123',10), 'inspector', 1);
  insertUser.run('Sara Nasser',    'sara',   bcrypt.hashSync('pass123',10), 'inspector', 2);
  insertUser.run('Omar Yusuf',     'omar',   bcrypt.hashSync('pass123',10), 'inspector', 3);

  // Shops
  const insertShop = db.prepare('INSERT INTO shops (name,company_id,city,inspector_id,last_score,last_date) VALUES (?,?,?,?,?,?)');
  insertShop.run('Mall of Emirates — Shop 12', 1, 'Dubai',     3, 94, '2026-06-10');
  insertShop.run('Yas Mall — Unit 5',          1, 'Abu Dhabi', 4, 55, '2026-06-06');
  insertShop.run('Dubai Mall — B2',            2, 'Dubai',     4, 72, '2026-06-09');
  insertShop.run('Mirdif City Centre',         2, 'Dubai',     5, 91, '2026-06-04');
  insertShop.run('Abu Dhabi City Centre',      3, 'Abu Dhabi', 5, 68, '2026-06-08');
  insertShop.run('Marina Mall — AD',           3, 'Abu Dhabi', 4, 79, '2026-06-03');
  insertShop.run('Sharjah City Centre',        4, 'Sharjah',   3, 88, '2026-06-07');
  insertShop.run('Mega Mall Sharjah',          4, 'Sharjah',   4, 63, '2026-06-02');

  // Demo tasks
  const insertTask = db.prepare('INSERT INTO tasks (shop_id,inspector_id,assigned_by,due_date,notes,status) VALUES (?,?,?,?,?,?)');
  insertTask.run(1, 3, 1, '2026-06-12', 'Focus on stock levels', 'pending');
  insertTask.run(3, 4, 1, '2026-06-11', '', 'done');
  insertTask.run(5, 5, 1, '2026-06-10', 'Check furniture damage', 'overdue');
  insertTask.run(7, 3, 1, '2026-06-14', '', 'pending');

  // Demo inspections
  const insertInsp = db.prepare('INSERT INTO inspections (shop_id,inspector_id,score,issue_count,created_at) VALUES (?,?,?,?,?)');
  insertInsp.run(1, 3, 94, 2,  '2026-06-10');
  insertInsp.run(3, 4, 72, 8,  '2026-06-09');
  insertInsp.run(5, 5, 68, 11, '2026-06-08');
  insertInsp.run(7, 3, 88, 4,  '2026-06-07');
  insertInsp.run(2, 4, 55, 17, '2026-06-06');

  // Demo stock
  const insertStock = db.prepare('INSERT INTO stock_items (shop_id,name,sys_qty,phys_qty) VALUES (?,?,?,?)');
  const stockData = [
    ['T-shirt (L, White)',120,118], ['T-shirt (M, Black)',85,85],
    ['Perfume — Oud 50ml',40,37],  ['Cap — Logo',60,62],
    ['Tote bag',30,28],            ['Scarf (Beige)',45,45],
  ];
  stockData.forEach(([name,sys,phys]) => insertStock.run(1, name, sys, phys));

  // Demo notifications
  const insertNotif = db.prepare('INSERT INTO notifications (message,color) VALUES (?,?)');
  insertNotif.run('Inspection submitted — Dubai Mall B2 — Score 72%', '#16A34A');
  insertNotif.run('HIGH SEVERITY — Yas Mall Unit 5 — Stock mismatch ×17', '#DC2626');
  insertNotif.run('Task overdue — Abu Dhabi City Centre (Omar Yusuf)', '#D97706');

  console.log('✅ Demo data seeded. Login: admin / admin123');
}

// ═══════════════════════════════════════
//  AUTH MIDDLEWARE
// ═══════════════════════════════════════
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'No token' });
  const token = header.split(' ')[1];
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role))
      return res.status(403).json({ error: 'Access denied' });
    next();
  };
}

// ═══════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════

// POST /api/auth/login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password)
    return res.status(400).json({ error: 'Username and password required' });

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user || !bcrypt.compareSync(password, user.password))
    return res.status(401).json({ error: 'Invalid username or password' });

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name,
      role: user.role, company_id: user.company_id },
    JWT_SECRET, { expiresIn: '12h' }
  );

  res.json({ token, user: { id: user.id, name: user.name, username: user.username,
    role: user.role, company_id: user.company_id } });
});

// ═══════════════════════════════════════
//  COMPANIES
// ═══════════════════════════════════════
app.get('/api/companies', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM companies ORDER BY name').all());
});

app.post('/api/companies', requireAuth, requireRole('admin'), (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  try {
    const r = db.prepare('INSERT INTO companies (name) VALUES (?)').run(name);
    res.json({ id: r.lastInsertRowid, name });
  } catch { res.status(400).json({ error: 'Company already exists' }); }
});

// ═══════════════════════════════════════
//  SHOPS
// ═══════════════════════════════════════
app.get('/api/shops', requireAuth, (req, res) => {
  const { company_id } = req.query;
  let sql = `SELECT s.*, c.name as company_name, u.name as inspector_name
             FROM shops s
             LEFT JOIN companies c ON s.company_id = c.id
             LEFT JOIN users u ON s.inspector_id = u.id`;
  const params = [];
  if (company_id) { sql += ' WHERE s.company_id = ?'; params.push(company_id); }
  sql += ' ORDER BY c.name, s.name';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/shops', requireAuth, requireRole('admin','management'), (req, res) => {
  const { name, company_id, city, address, inspector_id } = req.body;
  if (!name || !company_id) return res.status(400).json({ error: 'Name and company required' });
  const r = db.prepare(
    'INSERT INTO shops (name,company_id,city,address,inspector_id) VALUES (?,?,?,?,?)'
  ).run(name, company_id, city||'', address||'', inspector_id||null);
  res.json({ id: r.lastInsertRowid, name, company_id, city });
});

// ═══════════════════════════════════════
//  USERS
// ═══════════════════════════════════════
app.get('/api/users', requireAuth, requireRole('admin','management'), (req, res) => {
  res.json(db.prepare(
    'SELECT id,name,username,role,company_id,active,created_at FROM users ORDER BY name'
  ).all());
});

app.post('/api/users', requireAuth, requireRole('admin'), (req, res) => {
  const { name, username, password, role, company_id } = req.body;
  if (!name || !username || !password || !role)
    return res.status(400).json({ error: 'All fields required' });
  const hash = bcrypt.hashSync(password, 10);
  try {
    const r = db.prepare(
      'INSERT INTO users (name,username,password,role,company_id) VALUES (?,?,?,?,?)'
    ).run(name, username, hash, role, company_id||null);
    res.json({ id: r.lastInsertRowid, name, username, role });
  } catch { res.status(400).json({ error: 'Username already exists' }); }
});

// ═══════════════════════════════════════
//  TASKS
// ═══════════════════════════════════════
app.get('/api/tasks', requireAuth, (req, res) => {
  let sql = `
    SELECT t.*, s.name as shop_name, c.name as company_name,
           u.name as inspector_name, a.name as assigned_by_name
    FROM tasks t
    LEFT JOIN shops s    ON t.shop_id      = s.id
    LEFT JOIN companies c ON s.company_id  = c.id
    LEFT JOIN users u    ON t.inspector_id = u.id
    LEFT JOIN users a    ON t.assigned_by  = a.id`;
  const params = [];

  // Inspectors only see their own tasks
  if (req.user.role === 'inspector') {
    sql += ' WHERE t.inspector_id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY t.due_date ASC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/tasks', requireAuth, requireRole('admin','management'), (req, res) => {
  const { shop_id, inspector_id, due_date, notes } = req.body;
  if (!shop_id || !inspector_id || !due_date)
    return res.status(400).json({ error: 'Shop, inspector, and due date required' });
  const r = db.prepare(
    'INSERT INTO tasks (shop_id,inspector_id,assigned_by,due_date,notes) VALUES (?,?,?,?,?)'
  ).run(shop_id, inspector_id, req.user.id, due_date, notes||'');

  // Create notification
  const shop = db.prepare('SELECT name FROM shops WHERE id=?').get(shop_id);
  const inspector = db.prepare('SELECT name FROM users WHERE id=?').get(inspector_id);
  db.prepare('INSERT INTO notifications (message,color) VALUES (?,?)').run(
    `New task assigned — ${shop?.name} → ${inspector?.name} — due ${due_date}`, '#2563EB'
  );

  res.json({ id: r.lastInsertRowid, shop_id, inspector_id, due_date, status: 'pending' });
});

app.patch('/api/tasks/:id/complete', requireAuth, (req, res) => {
  db.prepare("UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=?").run(req.params.id);
  const task = db.prepare(
    `SELECT t.*,s.name as shop_name,u.name as inspector_name
     FROM tasks t LEFT JOIN shops s ON t.shop_id=s.id LEFT JOIN users u ON t.inspector_id=u.id
     WHERE t.id=?`
  ).get(req.params.id);
  db.prepare('INSERT INTO notifications (message,color) VALUES (?,?)').run(
    `Task completed — ${task?.shop_name} by ${task?.inspector_name}`, '#16A34A'
  );
  res.json({ success: true });
});

app.patch('/api/tasks/:id', requireAuth, requireRole('admin','management'), (req, res) => {
  const { status } = req.body;
  db.prepare("UPDATE tasks SET status=?, updated_at=datetime('now') WHERE id=?").run(status, req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════
//  INSPECTIONS
// ═══════════════════════════════════════
app.get('/api/inspections', requireAuth, (req, res) => {
  let sql = `
    SELECT i.*, s.name as shop_name, c.name as company_name, u.name as inspector_name
    FROM inspections i
    LEFT JOIN shops s     ON i.shop_id      = s.id
    LEFT JOIN companies c ON s.company_id   = c.id
    LEFT JOIN users u     ON i.inspector_id = u.id`;
  const params = [];
  if (req.user.role === 'inspector') {
    sql += ' WHERE i.inspector_id = ?';
    params.push(req.user.id);
  }
  sql += ' ORDER BY i.created_at DESC LIMIT 100';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/inspections', requireAuth, (req, res) => {
  const { shop_id, task_id, score, severity, notes, issue_count, answers } = req.body;
  if (!shop_id || score === undefined)
    return res.status(400).json({ error: 'Shop and score required' });

  // Save inspection
  const r = db.prepare(
    'INSERT INTO inspections (shop_id,task_id,inspector_id,score,severity,notes,issue_count) VALUES (?,?,?,?,?,?,?)'
  ).run(shop_id, task_id||null, req.user.id, score, severity||'low', notes||'', issue_count||0);

  // Save checklist answers
  if (answers && answers.length > 0) {
    const insertAns = db.prepare(
      'INSERT INTO checklist_answers (inspection_id,category,item_label,answer) VALUES (?,?,?,?)'
    );
    answers.forEach(a => insertAns.run(r.lastInsertRowid, a.category, a.label, a.answer));
  }

  // Update shop last score
  const dateStr = new Date().toISOString().split('T')[0];
  db.prepare("UPDATE shops SET last_score=?, last_date=? WHERE id=?").run(score, dateStr, shop_id);

  // Mark task done if linked
  if (task_id) {
    db.prepare("UPDATE tasks SET status='done', updated_at=datetime('now') WHERE id=?").run(task_id);
  }

  // Notification
  const shop = db.prepare('SELECT name FROM shops WHERE id=?').get(shop_id);
  const color = score >= 85 ? '#16A34A' : score >= 65 ? '#D97706' : '#DC2626';
  db.prepare('INSERT INTO notifications (message,color) VALUES (?,?)').run(
    `Inspection submitted — ${shop?.name} — Score ${score}% — ${issue_count} issues`, color
  );

  res.json({ id: r.lastInsertRowid, score, shop_id });
});

// ═══════════════════════════════════════
//  STOCK
// ═══════════════════════════════════════
app.get('/api/stock', requireAuth, (req, res) => {
  const { shop_id } = req.query;
  if (!shop_id) return res.status(400).json({ error: 'shop_id required' });
  res.json(db.prepare('SELECT * FROM stock_items WHERE shop_id = ? ORDER BY name').all(shop_id));
});

app.post('/api/stock', requireAuth, (req, res) => {
  const { shop_id, name, sys_qty, phys_qty } = req.body;
  if (!shop_id || !name) return res.status(400).json({ error: 'shop_id and name required' });
  const r = db.prepare(
    'INSERT INTO stock_items (shop_id,name,sys_qty,phys_qty) VALUES (?,?,?,?)'
  ).run(shop_id, name, sys_qty||0, phys_qty||0);
  res.json({ id: r.lastInsertRowid });
});

app.patch('/api/stock/:id', requireAuth, (req, res) => {
  const { phys_qty } = req.body;
  db.prepare("UPDATE stock_items SET phys_qty=?, checked_at=datetime('now') WHERE id=?")
    .run(phys_qty, req.params.id);
  res.json({ success: true });
});

app.delete('/api/stock/:id', requireAuth, (req, res) => {
  db.prepare('DELETE FROM stock_items WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ═══════════════════════════════════════
//  DASHBOARD STATS
// ═══════════════════════════════════════
app.get('/api/dashboard', requireAuth, (req, res) => {
  const today = new Date().toISOString().split('T')[0];
  res.json({
    totalShops:       db.prepare('SELECT COUNT(*) as c FROM shops').get().c,
    totalCompanies:   db.prepare('SELECT COUNT(*) as c FROM companies').get().c,
    inspectedToday:   db.prepare("SELECT COUNT(*) as c FROM inspections WHERE date(created_at)=?").get(today).c,
    pendingTasks:     db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='pending'").get().c,
    overdueTasks:     db.prepare("SELECT COUNT(*) as c FROM tasks WHERE status='overdue'").get().c,
    totalIssues:      db.prepare("SELECT SUM(issue_count) as c FROM inspections WHERE date(created_at)>=date('now','-7 days')").get().c || 0,
    companyScores:    db.prepare(`
      SELECT c.name, COUNT(s.id) as shop_count, ROUND(AVG(s.last_score)) as avg_score
      FROM companies c LEFT JOIN shops s ON s.company_id = c.id
      GROUP BY c.id ORDER BY c.name`).all(),
    weeklyInspections: db.prepare(`
      SELECT date(created_at) as day, COUNT(*) as count
      FROM inspections WHERE created_at >= date('now','-7 days')
      GROUP BY day ORDER BY day`).all(),
  });
});

// ═══════════════════════════════════════
//  NOTIFICATIONS
// ═══════════════════════════════════════
app.get('/api/notifications', requireAuth, (req, res) => {
  res.json(db.prepare('SELECT * FROM notifications ORDER BY created_at DESC LIMIT 50').all());
});

app.patch('/api/notifications/read-all', requireAuth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1').run();
  res.json({ success: true });
});

// ═══════════════════════════════════════
//  SERVE FRONTEND (fallback for SPA)
// ═══════════════════════════════════════
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ═══════════════════════════════════════
//  START SERVER
// ═══════════════════════════════════════
app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('╔════════════════════════════════════════╗');
  console.log('║   AuditPro Server — RUNNING            ║');
  console.log(`║   Local:   http://localhost:${PORT}         ║`);
  console.log('║   Network: http://YOUR-IP:' + PORT + '        ║');
  console.log('║                                        ║');
  console.log('║   Login: admin / admin123              ║');
  console.log('╚════════════════════════════════════════╝');
  console.log('');
});

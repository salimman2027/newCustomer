// =====================================================================
// NQ-ERP Partner Portal — API server (Node.js + Express + SQL Server)
// =====================================================================
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const sql = require('mssql');
const bcrypt = require('bcryptjs');

// ---------- config: secrets.json (next to server.js) or env vars ----------
const ROOT = __dirname;
let secrets = {};
try { secrets = JSON.parse(fs.readFileSync(path.join(ROOT, 'secrets.json'), 'utf8')); } catch (e) {}
const CFG = {
  db: String(process.env.DB_CONNECTION || secrets.DB_CONNECTION || '').trim().replace(/^["']|["']$/g, ''),
  sessionSecret: process.env.SESSION_SECRET || secrets.SESSION_SECRET,
  admins: String(process.env.ADMIN_EMAILS || (secrets.ADMIN_EMAILS || []).join(',')).split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  port: process.env.PORT || 3000
};

// ---------- database ----------
let poolPromise = null;
function getPool() {
  if (!CFG.db) return Promise.reject(new Error('DB_CONNECTION is not configured (secrets.json)'));
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(CFG.db).connect().then(async p => { await migrate(p); return p; })
      .catch(e => { poolPromise = null; throw e; });
  }
  return poolPromise;
}
async function q(text, params = {}) {
  const pool = await getPool();
  const r = pool.request();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) r.input(k, v[0], v[1]); else r.input(k, v);
  }
  const res = await r.query(text);
  return (res.recordset || []).map(fixRow);
}
const DATE_COLS = new Set(['closed_at', 'due', 'paid_at', 'last_activity']);
function fixRow(row) {
  const o = {};
  for (const [k, v] of Object.entries(row)) o[k] = v instanceof Date ? (DATE_COLS.has(k) ? v.toISOString().slice(0, 10) : v.toISOString()) : v;
  return o;
}

const MIGRATION = `
IF OBJECT_ID('dbo.nq_users') IS NULL
CREATE TABLE dbo.nq_users (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  email NVARCHAR(200) NOT NULL UNIQUE,
  password_hash NVARCHAR(200) NOT NULL,
  is_admin BIT NOT NULL DEFAULT 0,
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF OBJECT_ID('dbo.nq_partners') IS NULL
CREATE TABLE dbo.nq_partners (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY REFERENCES dbo.nq_users(id) ON DELETE CASCADE,
  name NVARCHAR(150) NOT NULL,
  email NVARCHAR(200) NOT NULL,
  phone NVARCHAR(30) NULL,
  iban NVARCHAR(50) NULL,
  type NVARCHAR(20) NOT NULL DEFAULT 'corporate',
  created_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  last_submit_at DATETIME2 NULL
);
IF OBJECT_ID('dbo.nq_leads') IS NULL
CREATE TABLE dbo.nq_leads (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  partner_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.nq_partners(id) ON DELETE CASCADE,
  ticket NVARCHAR(30) NOT NULL,
  phone NVARCHAR(30) NOT NULL,
  phone_key NVARCHAR(20) NOT NULL,
  customer NVARCHAR(150) NOT NULL,
  title NVARCHAR(100) NULL,
  company NVARCHAR(200) NOT NULL,
  industry NVARCHAR(150) NULL,
  email NVARCHAR(200) NULL,
  other_phone NVARCHAR(30) NULL,
  website NVARCHAR(200) NULL,
  notes NVARCHAR(1000) NULL,
  check_state NVARCHAR(20) NOT NULL DEFAULT 'new',
  status NVARCHAR(20) NOT NULL DEFAULT 'pending',
  admin_note NVARCHAR(500) NULL,
  contract_value DECIMAL(18,2) NULL,
  deal_no INT NULL,
  pct DECIMAL(5,2) NULL,
  bonus DECIMAL(18,2) NULL,
  commission DECIMAL(18,2) NULL,
  closed_at DATE NULL,
  submitted_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
  updated_at DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_nq_leads_phone')
  CREATE INDEX ix_nq_leads_phone ON dbo.nq_leads(phone_key);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name='ix_nq_leads_partner')
  CREATE INDEX ix_nq_leads_partner ON dbo.nq_leads(partner_id);
IF OBJECT_ID('dbo.nq_payouts') IS NULL
CREATE TABLE dbo.nq_payouts (
  id UNIQUEIDENTIFIER NOT NULL PRIMARY KEY DEFAULT NEWID(),
  partner_id UNIQUEIDENTIFIER NOT NULL REFERENCES dbo.nq_partners(id),
  lead_id UNIQUEIDENTIFIER NULL REFERENCES dbo.nq_leads(id),
  client NVARCHAR(200) NULL,
  stage NVARCHAR(200) NULL,
  amount DECIMAL(18,2) NOT NULL,
  due DATE NOT NULL,
  status NVARCHAR(20) NOT NULL DEFAULT 'scheduled',
  ref NVARCHAR(50) NULL,
  paid_at DATE NULL
);
IF OBJECT_ID('dbo.nq_crm_phones') IS NULL
CREATE TABLE dbo.nq_crm_phones (
  phone_key NVARCHAR(20) NOT NULL PRIMARY KEY,
  company NVARCHAR(200) NULL,
  last_activity DATE NOT NULL,
  owner NVARCHAR(150) NULL
);`;
async function migrate(pool) { await pool.request().batch(MIGRATION); }

// ---------- helpers ----------
const normPhone = p => { let d = String(p || '').replace(/\D/g, ''); if (d.startsWith('00966')) d = d.slice(5); else if (d.startsWith('966')) d = d.slice(3); return d.replace(/^0+/, ''); };
const clip = (s, n) => String(s ?? '').trim().slice(0, n);
const isEmail = s => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ''));
const STATUSES = ['pending', 'escalated', 'approved', 'negotiation', 'closed', 'rejected'];
function ladder(n) {
  if (n <= 2) return { pct: 5, bonus: 0 };
  if (n === 3) return { pct: 7, bonus: 0 };
  if (n <= 5) return { pct: 8, bonus: 0 };
  if (n === 6) return { pct: 10, bonus: 0 };
  return { pct: 10, bonus: 5000 };
}
const daysBetween = (a, b) => Math.floor((Date.UTC(...ymd(b)) - Date.UTC(...ymd(a))) / 86400000);
function ymd(d) { const s = (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10).split('-').map(Number); return [s[0], s[1] - 1, s[2]]; }
function todayRiyadh() { return new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); }
function addDays(iso, n) { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

// ---------- sessions (signed cookie) ----------
const SECRET = CFG.sessionSecret || crypto.randomBytes(32).toString('hex');
if (!CFG.sessionSecret) console.warn('SESSION_SECRET missing: sessions will reset on restart');
function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}
function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const good = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString()); return p.exp > Date.now() ? p : null; } catch { return null; }
}
function readCookie(req, name) {
  const m = (req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(name + '='));
  return m ? decodeURIComponent(m.slice(name.length + 1)) : null;
}
function setSession(req, res, userId) {
  const token = sign({ uid: userId, exp: Date.now() + 30 * 86400000 });
  const secure = req.secure || req.headers['x-forwarded-proto'] === 'https' || req.headers['x-arr-ssl'];
  res.setHeader('Set-Cookie', `nq_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${30 * 86400}${secure ? '; Secure' : ''}`);
}

// ---------- app ----------
const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');
app.use(express.json({ limit: '200kb' }));
app.use((req, res, next) => { res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'same-origin'); next(); });

const wrap = fn => (req, res) => fn(req, res).catch(e => {
  if (e.status) return res.status(e.status).json({ error: e.message });
  console.error(e); res.status(500).json({ error: 'SERVER_ERROR' });
});
const fail = (status, message) => Object.assign(new Error(message), { status });

async function loadUser(req) {
  const s = verify(readCookie(req, 'nq_session'));
  if (!s) return null;
  const rows = await q('SELECT id, email, is_admin FROM dbo.nq_users WHERE id=@id', { id: [sql.UniqueIdentifier, s.uid] });
  if (!rows[0]) return null;
  const u = rows[0];
  u.is_admin = !!u.is_admin || CFG.admins.includes(String(u.email).toLowerCase());
  return u;
}
const auth = (admin = false) => async (req, res, next) => {
  try {
    const u = await loadUser(req);
    if (!u) return res.status(401).json({ error: 'UNAUTHORIZED' });
    if (admin && !u.is_admin) return res.status(403).json({ error: 'NOT_ADMIN' });
    req.user = u; next();
  } catch (e) { console.error(e); res.status(500).json({ error: 'SERVER_ERROR' }); }
};

// brute-force guard
const attempts = new Map();
function throttle(key) {
  const now = Date.now(), a = attempts.get(key) || { n: 0, t: now };
  if (now - a.t > 15 * 60000) { a.n = 0; a.t = now; }
  a.n++; attempts.set(key, a);
  if (a.n > 10) throw fail(429, 'TOO_MANY_ATTEMPTS');
}

// ----- health -----
app.get('/api/health', async (req, res) => {
  try { await q('SELECT 1 AS ok'); res.json({ ok: true, db: 'connected', node: process.version, secretsFile: !!secrets.DB_CONNECTION }); }
  catch (e) {
    let parsed = {};
    try { const c = sql.ConnectionPool.parseConnectionString(CFG.db); parsed = { server: c.server, database: c.database, user: c.user, passwordLength: String(c.password || '').length, passwordLooksMasked: /^\*+$/.test(String(c.password || '')) }; } catch (_) { parsed = { parseError: true }; }
    res.status(503).json({ ok: false, db: 'error', message: String(e.message || e).slice(0, 300), node: process.version, secretsFile: !!secrets.DB_CONNECTION, parsed });
  }
});

// ----- auth -----
app.post('/api/register', wrap(async (req, res) => {
  throttle('reg:' + req.ip);
  const b = req.body || {};
  const email = clip(b.email, 200).toLowerCase();
  if (!isEmail(email)) throw fail(400, 'INVALID_EMAIL');
  if (String(b.password || '').length < 6) throw fail(400, 'WEAK_PASSWORD');
  const name = clip(b.name, 150); if (!name) throw fail(400, 'NAME_REQUIRED');
  const exists = await q('SELECT id FROM dbo.nq_users WHERE email=@e', { e: email });
  if (exists[0]) throw fail(409, 'EMAIL_EXISTS');
  const hash = await bcrypt.hash(String(b.password), 10);
  const u = await q(`INSERT INTO dbo.nq_users(email,password_hash,is_admin) OUTPUT inserted.id VALUES(@e,@h,@a)`,
    { e: email, h: hash, a: [sql.Bit, CFG.admins.includes(email) ? 1 : 0] });
  const id = u[0].id;
  await q(`INSERT INTO dbo.nq_partners(id,name,email,phone,iban,type) VALUES(@id,@n,@e,@p,@i,@t)`,
    { id: [sql.UniqueIdentifier, id], n: name, e: email, p: clip(b.phone, 30), i: clip(b.iban, 50), t: b.type === 'individual' ? 'individual' : 'corporate' });
  setSession(req, res, id);
  res.json({ ok: true });
}));
app.post('/api/login', wrap(async (req, res) => {
  const email = clip((req.body || {}).email, 200).toLowerCase();
  throttle('login:' + email); throttle('ip:' + req.ip);
  const rows = await q('SELECT id, password_hash FROM dbo.nq_users WHERE email=@e', { e: email });
  if (!rows[0] || !(await bcrypt.compare(String(req.body.password || ''), rows[0].password_hash))) throw fail(401, 'INVALID_LOGIN');
  attempts.delete('login:' + email);
  setSession(req, res, rows[0].id);
  res.json({ ok: true });
}));
app.post('/api/logout', (req, res) => { res.setHeader('Set-Cookie', 'nq_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0'); res.json({ ok: true }); });

// ----- partner -----
app.get('/api/me', auth(), wrap(async (req, res) => {
  const id = [sql.UniqueIdentifier, req.user.id];
  const [partner] = await q('SELECT * FROM dbo.nq_partners WHERE id=@id', { id });
  const leads = await q('SELECT * FROM dbo.nq_leads WHERE partner_id=@id ORDER BY submitted_at DESC', { id });
  const payouts = await q('SELECT * FROM dbo.nq_payouts WHERE partner_id=@id ORDER BY due DESC', { id });
  res.json({ user: { id: req.user.id, email: req.user.email, is_admin: req.user.is_admin }, partner: partner || null, leads, payouts });
}));
app.post('/api/me/partner', auth(), wrap(async (req, res) => {
  const b = req.body || {};
  const name = clip(b.name, 150); if (!name) throw fail(400, 'NAME_REQUIRED');
  await q(`IF NOT EXISTS (SELECT 1 FROM dbo.nq_partners WHERE id=@id)
    INSERT INTO dbo.nq_partners(id,name,email,phone,iban,type) VALUES(@id,@n,@e,@p,@i,@t)`,
    { id: [sql.UniqueIdentifier, req.user.id], n: name, e: req.user.email, p: clip(b.phone, 30), i: clip(b.iban, 50), t: b.type === 'individual' ? 'individual' : 'corporate' });
  res.json({ ok: true });
}));
app.put('/api/me', auth(), wrap(async (req, res) => {
  const b = req.body || {};
  const name = clip(b.name, 150); if (!name) throw fail(400, 'NAME_REQUIRED');
  await q('UPDATE dbo.nq_partners SET name=@n, phone=@p, iban=@i WHERE id=@id',
    { id: [sql.UniqueIdentifier, req.user.id], n: name, p: clip(b.phone, 30), i: clip(b.iban, 50) });
  res.json({ ok: true });
}));
app.post('/api/me/password', auth(), wrap(async (req, res) => {
  const b = req.body || {};
  const [u] = await q('SELECT password_hash FROM dbo.nq_users WHERE id=@id', { id: [sql.UniqueIdentifier, req.user.id] });
  if (!(await bcrypt.compare(String(b.current || ''), u.password_hash))) throw fail(401, 'INVALID_LOGIN');
  if (String(b.next || '').length < 6) throw fail(400, 'WEAK_PASSWORD');
  await q('UPDATE dbo.nq_users SET password_hash=@h WHERE id=@id', { id: [sql.UniqueIdentifier, req.user.id], h: await bcrypt.hash(String(b.next), 10) });
  res.json({ ok: true });
}));

async function checkPhone(raw, uid) {
  const k = normPhone(raw);
  if (k.length < 7) return { state: 'invalid', key: k };
  const [l] = await q(`SELECT TOP 1 partner_id FROM dbo.nq_leads WHERE phone_key=@k AND status<>'rejected'
                       AND submitted_at > DATEADD(day,-180,SYSUTCDATETIME()) ORDER BY submitted_at DESC`, { k });
  if (l) return { state: String(l.partner_id).toLowerCase() === String(uid).toLowerCase() ? 'mine' : 'claimed', key: k };
  const [c] = await q('SELECT last_activity FROM dbo.nq_crm_phones WHERE phone_key=@k', { k });
  if (c) { const d = daysBetween(c.last_activity, todayRiyadh()); return { state: d < 30 ? 'active_sales' : 'stagnant', days: d, key: k }; }
  return { state: 'new', key: k };
}
app.post('/api/phone-check', auth(), wrap(async (req, res) => {
  const r = await checkPhone((req.body || {}).phone, req.user.id); delete r.key; res.json(r);
}));
app.post('/api/leads', auth(), wrap(async (req, res) => {
  const b = req.body || {};
  const [p] = await q('SELECT id FROM dbo.nq_partners WHERE id=@id', { id: [sql.UniqueIdentifier, req.user.id] });
  if (!p) throw fail(400, 'NOT_PARTNER');
  const customer = clip(b.customer, 150), company = clip(b.company, 200);
  if (!customer || !company) throw fail(400, 'MISSING_FIELDS');
  const chk = await checkPhone(b.phone, req.user.id);
  if (['invalid', 'mine', 'claimed', 'active_sales'].includes(chk.state)) throw fail(409, 'BLOCKED:' + chk.state);
  const t = todayRiyadh();
  const ticket = 'NQ-' + t.slice(2, 4) + t.slice(5, 7) + '-' + (1000 + crypto.randomInt(9000));
  const [lead] = await q(`INSERT INTO dbo.nq_leads(partner_id,ticket,phone,phone_key,customer,title,company,industry,email,other_phone,website,notes,check_state,status)
    OUTPUT inserted.* VALUES(@pid,@ticket,@phone,@key,@cust,@title,@comp,@ind,@email,@other,@web,@notes,@chk,@st)`, {
    pid: [sql.UniqueIdentifier, req.user.id], ticket, phone: clip(b.phone, 30), key: chk.key, cust: customer, title: clip(b.title, 100),
    comp: company, ind: clip(b.industry, 150), email: clip(b.email, 200), other: clip(b.other_phone, 30), web: clip(b.website, 200),
    notes: clip(b.notes, 1000), chk: chk.state, st: chk.state === 'stagnant' ? 'escalated' : 'pending' });
  await q('UPDATE dbo.nq_partners SET last_submit_at=SYSUTCDATETIME() WHERE id=@id', { id: [sql.UniqueIdentifier, req.user.id] });
  res.json(lead);
}));

// ----- admin -----
app.get('/api/admin/data', auth(true), wrap(async (req, res) => {
  const [partners, leads, payouts, phones] = await Promise.all([
    q('SELECT * FROM dbo.nq_partners'),
    q('SELECT * FROM dbo.nq_leads ORDER BY submitted_at DESC'),
    q('SELECT * FROM dbo.nq_payouts ORDER BY due ASC'),
    q('SELECT TOP 2000 * FROM dbo.nq_crm_phones ORDER BY last_activity DESC')
  ]);
  res.json({ partners, leads, payouts, phones });
}));
app.post('/api/admin/leads/:id/status', auth(true), wrap(async (req, res) => {
  const status = String((req.body || {}).status);
  if (!STATUSES.includes(status) || status === 'closed') throw fail(400, 'INVALID_STATUS');
  const id = [sql.UniqueIdentifier, req.params.id];
  const note = req.body.note == null ? null : clip(req.body.note, 500);
  await q(`DELETE FROM dbo.nq_payouts WHERE lead_id=@id AND status<>'paid';
    UPDATE dbo.nq_leads SET status=@st, admin_note=COALESCE(@note,admin_note), contract_value=NULL, deal_no=NULL, pct=NULL,
      bonus=NULL, commission=NULL, closed_at=NULL, updated_at=SYSUTCDATETIME() WHERE id=@id`, { id, st: status, note });
  res.json({ ok: true });
}));
app.post('/api/admin/leads/:id/close', auth(true), wrap(async (req, res) => {
  const value = Math.round(Number((req.body || {}).value));
  const date = String(req.body.date || '');
  if (!(value > 0) || !isDate(date)) throw fail(400, 'INVALID_INPUT');
  const id = [sql.UniqueIdentifier, req.params.id];
  const [lead] = await q('SELECT * FROM dbo.nq_leads WHERE id=@id', { id });
  if (!lead) throw fail(404, 'NOT_FOUND');
  const [{ n }] = await q(`SELECT COUNT(*)+1 AS n FROM dbo.nq_leads WHERE partner_id=@pid AND status='closed' AND id<>@id`,
    { pid: [sql.UniqueIdentifier, lead.partner_id], id });
  const L = ladder(n), comm = Math.round((value * L.pct / 100 + L.bonus) * 100) / 100;
  const p1 = Math.round(comm * 50) / 100, p2 = Math.round(comm * 25) / 100, p3 = Math.round((comm - p1 - p2) * 100) / 100;
  const pool = await getPool(); const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const r = () => new sql.Request(tx);
    await r().input('id', sql.UniqueIdentifier, req.params.id).query(`DELETE FROM dbo.nq_payouts WHERE lead_id=@id AND status<>'paid'`);
    await r().input('id', sql.UniqueIdentifier, req.params.id).input('v', sql.Decimal(18, 2), value).input('n', sql.Int, n)
      .input('pct', sql.Decimal(5, 2), L.pct).input('b', sql.Decimal(18, 2), L.bonus).input('c', sql.Decimal(18, 2), comm).input('d', sql.Date, date)
      .query(`UPDATE dbo.nq_leads SET status='closed', contract_value=@v, deal_no=@n, pct=@pct, bonus=@b, commission=@c, closed_at=@d, updated_at=SYSUTCDATETIME() WHERE id=@id`);
    const rows = [[p1, `دفعة 1 (50% توقيع) — صفقة #${n}`, date], [p2, `دفعة 2 (25% - 30 يوم) — صفقة #${n}`, addDays(date, 30)], [p3, `دفعة 3 (25% - 60 يوم) — صفقة #${n}`, addDays(date, 60)]];
    for (const [amt, stage, due] of rows) {
      await r().input('pid', sql.UniqueIdentifier, lead.partner_id).input('lid', sql.UniqueIdentifier, req.params.id)
        .input('client', sql.NVarChar(200), lead.company).input('stage', sql.NVarChar(200), stage)
        .input('amt', sql.Decimal(18, 2), amt).input('due', sql.Date, due)
        .query(`INSERT INTO dbo.nq_payouts(partner_id,lead_id,client,stage,amount,due) VALUES(@pid,@lid,@client,@stage,@amt,@due)`);
    }
    await tx.commit();
  } catch (e) { await tx.rollback(); throw e; }
  res.json({ ok: true, commission: comm, deal_no: n, pct: L.pct, bonus: L.bonus });
}));
app.post('/api/admin/payouts/:id/pay', auth(true), wrap(async (req, res) => {
  const ref = clip((req.body || {}).ref, 50), date = String(req.body.date || '');
  if (!ref || !isDate(date)) throw fail(400, 'INVALID_INPUT');
  await q(`UPDATE dbo.nq_payouts SET status='paid', ref=@ref, paid_at=@d WHERE id=@id`,
    { id: [sql.UniqueIdentifier, req.params.id], ref, d: [sql.Date, date] });
  res.json({ ok: true });
}));
app.post('/api/admin/crm', auth(true), wrap(async (req, res) => {
  const rows = Array.isArray((req.body || {}).rows) ? req.body.rows.slice(0, 2000) : [];
  let saved = 0;
  for (const r of rows) {
    const k = normPhone(r.phone_key || r.phone); if (k.length < 7) continue;
    await q(`MERGE dbo.nq_crm_phones AS t USING (SELECT @k AS phone_key) AS s ON t.phone_key=s.phone_key
      WHEN MATCHED THEN UPDATE SET company=@c, last_activity=@d, owner=@o
      WHEN NOT MATCHED THEN INSERT(phone_key,company,last_activity,owner) VALUES(@k,@c,@d,@o);`,
      { k, c: clip(r.company, 200), d: [sql.Date, isDate(r.last_activity) ? r.last_activity : todayRiyadh()], o: clip(r.owner, 150) || 'فريق المبيعات المباشر' });
    saved++;
  }
  res.json({ ok: true, saved });
}));
app.post('/api/admin/crm/:key/touch', auth(true), wrap(async (req, res) => {
  await q('UPDATE dbo.nq_crm_phones SET last_activity=@d WHERE phone_key=@k', { k: normPhone(req.params.key), d: [sql.Date, todayRiyadh()] });
  res.json({ ok: true });
}));
app.delete('/api/admin/crm/:key', auth(true), wrap(async (req, res) => {
  await q('DELETE FROM dbo.nq_crm_phones WHERE phone_key=@k', { k: normPhone(req.params.key) });
  res.json({ ok: true });
}));
app.post('/api/admin/partners/:id/reset-password', auth(true), wrap(async (req, res) => {
  const temp = crypto.randomBytes(6).toString('base64url');
  await q('UPDATE dbo.nq_users SET password_hash=@h WHERE id=@id', { id: [sql.UniqueIdentifier, req.params.id], h: await bcrypt.hash(temp, 10) });
  res.json({ ok: true, password: temp });
}));

// ----- static frontend -----
app.use(express.static(path.join(ROOT, 'public'), { index: 'index.html', maxAge: '5m' }));
app.use('/api', (req, res) => res.status(404).json({ error: 'NOT_FOUND' }));
app.get(/.*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

app.listen(CFG.port, () => console.log('NQ partner portal listening on', CFG.port));
getPool().then(() => console.log('DB ready')).catch(e => console.error('DB connection failed:', e.message));

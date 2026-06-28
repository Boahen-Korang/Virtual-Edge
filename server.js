/* ================================================================
   VirtualEdge — Express server
   Serves the static site (public/) AND a JSON REST API backed by
   PostgreSQL. Auth is via JWT (member / partner / admin roles).
   ================================================================ */
require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { query, initSchema } = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-change-me';
const ADMIN_PASSCODE = process.env.ADMIN_PASSCODE || '055290';
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

app.use(cors());
app.use(express.json({ limit: '1mb' }));

/* ----------------------------- helpers ----------------------------- */
const sign = (payload) => jwt.sign(payload, JWT_SECRET, { expiresIn: '30d' });
const norm = (e) => String(e || '').trim().toLowerCase();
const hash = (pw) => bcrypt.hashSync(pw, 10);
const check = (pw, h) => { try { return bcrypt.compareSync(pw, h); } catch { return false; } };

function auth(role) {
  return (req, res, next) => {
    const hdr = req.headers.authorization || '';
    const token = hdr.startsWith('Bearer ') ? hdr.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Not signed in' });
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      if (role && decoded.role !== role) return res.status(403).json({ error: 'Forbidden' });
      req.user = decoded;
      next();
    } catch {
      return res.status(401).json({ error: 'Session expired' });
    }
  };
}

const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error(e);
  res.status(500).json({ error: 'Server error' });
});

function parsePrice(label) {
  if (!label) return 0;
  const s = String(label).replace(/ghs/i, '').trim();
  let n = parseFloat(s);
  if (/k/i.test(s)) n *= 1000;
  return isNaN(n) ? 0 : n;
}

function genCode(name) {
  const base = (name || 'PARTNER').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'PART';
  return base + Math.floor(100 + Math.random() * 900);
}
async function uniqueCode(name) {
  let code;
  for (let i = 0; i < 50; i++) {
    code = genCode(name);
    const { rows } = await query('SELECT 1 FROM partners WHERE code=$1', [code]);
    if (!rows.length) return code;
  }
  return code + Date.now().toString().slice(-3);
}

/* Map DB rows to the client-facing field names the front-end expects */
const userOut = (r) => r && ({
  email: r.email, name: r.name, plan: r.plan,
  planEnd: r.plan_end ? Number(r.plan_end) : null,
  ref: r.ref, partner: r.partner,
});
const partnerOut = (r) => r && ({
  id: r.id, name: r.name, email: r.email, code: r.code, status: r.status,
  locked: r.locked, created: r.created_at, approvedAt: r.approved_at, lockedAt: r.locked_at,
});
const pickOut = (r) => r && ({
  id: r.id, email: r.member_email, home: r.home, away: r.away, out: r.outcome,
  label: r.label, odds: r.odds != null ? Number(r.odds) : null,
  from: r.from_code, fromName: r.from_name, used: r.used, date: r.created_at,
});

/* ============================ MEMBER AUTH ============================ */
app.post('/api/auth/register', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = norm(req.body.email);
  const password = String(req.body.password || '');
  const ref = String(req.body.ref || '').trim() || null;
  if (!name) return res.status(400).json({ error: 'Enter your name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const exists = await query('SELECT 1 FROM users WHERE email=$1', [email]);
  if (exists.rows.length) return res.status(409).json({ error: 'An account with this email already exists.' });

  // attribute to a partner only if the ref code belongs to a real partner
  let partner = null;
  if (ref) {
    const p = await query('SELECT code FROM partners WHERE code=$1', [ref]);
    if (p.rows.length) partner = ref;
  }
  const { rows } = await query(
    'INSERT INTO users (email,name,pw_hash,ref,partner) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [email, name, hash(password), ref, partner]
  );
  await query('INSERT INTO credits (email,amount) VALUES ($1,0) ON CONFLICT (email) DO NOTHING', [email]);
  const user = userOut(rows[0]);
  res.json({ token: sign({ email, role: 'member' }), user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = norm(req.body.email);
  const password = String(req.body.password || '');
  const { rows } = await query('SELECT * FROM users WHERE email=$1', [email]);
  const u = rows[0];
  if (!u || !check(password, u.pw_hash)) return res.status(401).json({ error: 'Wrong email or password.' });
  res.json({ token: sign({ email, role: 'member' }), user: userOut(u) });
}));

/* ============================ MEMBER DATA ============================ */
app.get('/api/me', auth('member'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM users WHERE email=$1', [req.user.email]);
  if (!rows.length) return res.status(404).json({ error: 'Not found' });
  const c = await query('SELECT amount FROM credits WHERE email=$1', [req.user.email]);
  res.json({ user: userOut(rows[0]), credits: c.rows[0] ? c.rows[0].amount : 0 });
}));

// member's pushed picks (optionally only pending)
app.get('/api/me/picks', auth('member'), wrap(async (req, res) => {
  const onlyPending = req.query.pending === '1';
  const { rows } = await query(
    `SELECT * FROM pushed_picks WHERE member_email=$1 ${onlyPending ? 'AND used=false' : ''} ORDER BY created_at DESC`,
    [req.user.email]
  );
  res.json(rows.map(pickOut));
}));

// mark a pick as used (consumed by the dashboard prediction flow)
app.post('/api/me/picks/:id/consume', auth('member'), wrap(async (req, res) => {
  await query('UPDATE pushed_picks SET used=true WHERE id=$1 AND member_email=$2', [req.params.id, req.user.email]);
  res.json({ ok: true });
}));

// record a purchase + extend plan / add credits
app.post('/api/me/purchases', auth('member'), wrap(async (req, res) => {
  const pkg = String(req.body.pkg || '');
  const reference = String(req.body.reference || '');
  const predictions = parseInt(req.body.predictions, 10) || 0;
  const planEnd = req.body.planEnd ? Number(req.body.planEnd) : null;
  const plan = req.body.plan != null ? String(req.body.plan) : null;

  await query('INSERT INTO purchases (email,pkg,reference,predictions) VALUES ($1,$2,$3,$4)',
    [req.user.email, pkg, reference, predictions]);
  if (predictions > 0) {
    await query(
      `INSERT INTO credits (email,amount) VALUES ($1,$2)
       ON CONFLICT (email) DO UPDATE SET amount = credits.amount + EXCLUDED.amount`,
      [req.user.email, predictions]
    );
  }
  if (plan != null || planEnd != null) {
    await query('UPDATE users SET plan=COALESCE($2,plan), plan_end=COALESCE($3,plan_end) WHERE email=$1',
      [req.user.email, plan, planEnd]);
  }
  const c = await query('SELECT amount FROM credits WHERE email=$1', [req.user.email]);
  res.json({ ok: true, credits: c.rows[0] ? c.rows[0].amount : 0 });
}));

// spend a credit (when generating a prediction)
app.post('/api/me/credits/spend', auth('member'), wrap(async (req, res) => {
  const n = parseInt(req.body.amount, 10) || 1;
  const { rows } = await query(
    'UPDATE credits SET amount = GREATEST(0, amount - $2) WHERE email=$1 RETURNING amount',
    [req.user.email, n]
  );
  res.json({ credits: rows[0] ? rows[0].amount : 0 });
}));

/* ============================ PARTNER AUTH ============================ */
app.post('/api/partner/register', wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = norm(req.body.email);
  const password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: 'Enter your full name.' });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email.' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });

  const exists = await query('SELECT 1 FROM partners WHERE email=$1', [email]);
  if (exists.rows.length) return res.status(409).json({ error: 'A partner with this email already exists.' });

  const code = await uniqueCode(name);
  await query('INSERT INTO partners (name,email,pw_hash,code,status) VALUES ($1,$2,$3,$4,$5)',
    [name, email, hash(password), code, 'pending']);
  res.json({ ok: true });
}));

app.post('/api/partner/login', wrap(async (req, res) => {
  const email = norm(req.body.email);
  const password = String(req.body.password || '');
  const { rows } = await query('SELECT * FROM partners WHERE email=$1', [email]);
  const p = rows[0];
  if (!p || !check(password, p.pw_hash)) return res.status(401).json({ error: 'Wrong email or password.' });
  if (p.status === 'pending') return res.status(403).json({ error: 'Your application is still awaiting admin approval.' });
  if (p.status === 'rejected') return res.status(403).json({ error: 'Your application was not approved. Contact VirtualEdge.' });
  if (p.locked) return res.status(403).json({ error: 'Your account has been locked. Contact VirtualEdge.' });
  res.json({ token: sign({ code: p.code, email: p.email, role: 'partner' }), partner: partnerOut(p) });
}));

/* ============================ PARTNER DATA ============================ */
async function loadPartner(code) {
  const { rows } = await query('SELECT * FROM partners WHERE code=$1', [code]);
  return rows[0];
}

app.get('/api/partner/me', auth('partner'), wrap(async (req, res) => {
  const p = await loadPartner(req.user.code);
  if (!p || p.status !== 'approved' || p.locked) return res.status(403).json({ error: 'Account unavailable' });
  res.json({ partner: partnerOut(p) });
}));

app.get('/api/partner/referrals', auth('partner'), wrap(async (req, res) => {
  const code = req.user.code;
  const u = await query('SELECT * FROM users WHERE partner=$1', [code]);
  const buys = await query(
    'SELECT email, pkg FROM purchases WHERE email IN (SELECT email FROM users WHERE partner=$1)', [code]);
  const spend = {};
  buys.rows.forEach((b) => { spend[b.email] = (spend[b.email] || 0) + parsePrice(b.pkg); });
  res.json(u.rows.map((r) => ({ ...userOut(r), spend: spend[r.email] || 0 })));
}));

app.get('/api/partner/picks', auth('partner'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM pushed_picks WHERE from_code=$1 ORDER BY created_at DESC', [req.user.code]);
  res.json(rows.map(pickOut));
}));

app.post('/api/partner/picks', auth('partner'), wrap(async (req, res) => {
  const p = await loadPartner(req.user.code);
  if (!p || p.status !== 'approved' || p.locked) return res.status(403).json({ error: 'Account unavailable' });
  const email = norm(req.body.email);
  const picks = Array.isArray(req.body.picks) ? req.body.picks : [];
  if (!email) return res.status(400).json({ error: 'Select an account.' });
  if (!picks.length) return res.status(400).json({ error: 'No picks supplied.' });
  const member = await query('SELECT 1 FROM users WHERE email=$1', [email]);
  if (!member.rows.length) return res.status(404).json({ error: 'Member not found.' });
  await insertPicks(email, picks, p.code, p.name);
  res.json({ ok: true, count: picks.length });
}));

app.delete('/api/partner/picks/:id', auth('partner'), wrap(async (req, res) => {
  await query('DELETE FROM pushed_picks WHERE id=$1 AND from_code=$2 AND used=false', [req.params.id, req.user.code]);
  res.json({ ok: true });
}));

// shared: members list for the "reflect in account" dropdown
app.get('/api/accounts', auth(), wrap(async (req, res) => {
  if (!['partner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  const { rows } = await query('SELECT email,name,partner FROM users ORDER BY name NULLS LAST, email');
  res.json(rows.map((r) => ({ email: r.email, name: r.name, partner: r.partner })));
}));

async function insertPicks(email, picks, fromCode, fromName) {
  for (const pk of picks) {
    await query(
      `INSERT INTO pushed_picks (member_email,home,away,outcome,label,odds,from_code,from_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [email, String(pk.home || ''), String(pk.away || ''), String(pk.out || ''),
       String(pk.label || ''), pk.odds != null ? pk.odds : null, fromCode, fromName]
    );
  }
}

/* ============================ ADMIN ============================ */
app.post('/api/admin/login', wrap(async (req, res) => {
  if (String(req.body.passcode || '') !== ADMIN_PASSCODE) return res.status(401).json({ error: 'Wrong passcode.' });
  res.json({ token: sign({ role: 'admin' }) });
}));

app.get('/api/admin/users', auth('admin'), wrap(async (req, res) => {
  const u = await query('SELECT * FROM users ORDER BY created_at DESC');
  const c = await query('SELECT email, amount FROM credits');
  const credits = {};
  c.rows.forEach((r) => { credits[r.email] = r.amount; });
  res.json(u.rows.map((r) => ({ ...userOut(r), credits: credits[r.email] || 0 })));
}));

app.get('/api/admin/partners', auth('admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM partners ORDER BY created_at DESC');
  res.json(rows.map(partnerOut));
}));

app.post('/api/admin/partners', auth('admin'), wrap(async (req, res) => {
  const name = String(req.body.name || '').trim();
  const email = norm(req.body.email);
  const password = String(req.body.password || '');
  let code = String(req.body.code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!name || !email || !password) return res.status(400).json({ error: 'Name, email and password are required.' });
  const exists = await query('SELECT 1 FROM partners WHERE email=$1', [email]);
  if (exists.rows.length) return res.status(409).json({ error: 'A partner with this email already exists.' });
  if (code) {
    const dup = await query('SELECT 1 FROM partners WHERE code=$1', [code]);
    if (dup.rows.length) return res.status(409).json({ error: 'That code is already taken.' });
  } else {
    code = await uniqueCode(name);
  }
  const { rows } = await query(
    `INSERT INTO partners (name,email,pw_hash,code,status,approved_at)
     VALUES ($1,$2,$3,$4,'approved',now()) RETURNING *`,
    [name, email, hash(password), code]
  );
  res.json({ partner: partnerOut(rows[0]) });
}));

app.patch('/api/admin/partners/:id', auth('admin'), wrap(async (req, res) => {
  const action = String(req.body.action || '');
  const id = req.params.id;
  const map = {
    approve: "UPDATE partners SET status='approved', approved_at=now() WHERE id=$1 RETURNING *",
    reject:  "UPDATE partners SET status='rejected' WHERE id=$1 RETURNING *",
    lock:    "UPDATE partners SET locked=true, locked_at=now() WHERE id=$1 RETURNING *",
    unlock:  "UPDATE partners SET locked=false, locked_at=NULL WHERE id=$1 RETURNING *",
  };
  if (!map[action]) return res.status(400).json({ error: 'Unknown action.' });
  const { rows } = await query(map[action], [id]);
  res.json({ partner: partnerOut(rows[0]) });
}));

app.delete('/api/admin/partners/:id', auth('admin'), wrap(async (req, res) => {
  await query('DELETE FROM partners WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

// grant (or deduct) prediction credits for a member
app.post('/api/admin/credits', auth('admin'), wrap(async (req, res) => {
  const email = norm(req.body.email);
  const amount = parseInt(req.body.amount, 10);
  if (!email || isNaN(amount)) return res.status(400).json({ error: 'Email and a numeric amount are required.' });
  const { rows } = await query(
    `INSERT INTO credits (email,amount) VALUES ($1,$2)
     ON CONFLICT (email) DO UPDATE SET amount = GREATEST(0, credits.amount + EXCLUDED.amount)
     RETURNING amount`,
    [email, amount]
  );
  res.json({ ok: true, credits: rows[0] ? rows[0].amount : 0 });
}));

// delete a member (keeps their transaction history)
app.delete('/api/admin/users/:email', auth('admin'), wrap(async (req, res) => {
  const email = norm(req.params.email);
  await query('DELETE FROM credits WHERE email=$1', [email]);
  await query('DELETE FROM users WHERE email=$1', [email]);
  res.json({ ok: true });
}));

app.get('/api/admin/purchases', auth('admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM purchases ORDER BY created_at DESC');
  res.json(rows.map((r) => ({
    id: r.id, email: r.email, pkg: r.pkg, reference: r.reference,
    predictions: r.predictions, date: r.created_at,
  })));
}));

app.get('/api/admin/picks', auth('admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM pushed_picks ORDER BY created_at DESC');
  res.json(rows.map(pickOut));
}));

app.post('/api/admin/picks', auth('admin'), wrap(async (req, res) => {
  const email = norm(req.body.email);
  const picks = Array.isArray(req.body.picks) ? req.body.picks : [];
  if (!email) return res.status(400).json({ error: 'Select an account.' });
  if (!picks.length) return res.status(400).json({ error: 'No picks supplied.' });
  const member = await query('SELECT 1 FROM users WHERE email=$1', [email]);
  if (!member.rows.length) return res.status(404).json({ error: 'Member not found.' });
  await insertPicks(email, picks, 'ADMIN', 'Admin');
  res.json({ ok: true, count: picks.length });
}));

app.delete('/api/admin/picks/:id', auth('admin'), wrap(async (req, res) => {
  await query('DELETE FROM pushed_picks WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
}));

app.get('/api/admin/payment-config', auth('admin'), wrap(async (req, res) => {
  const { rows } = await query('SELECT * FROM payment_config WHERE id=1');
  const r = rows[0] || {};
  res.json({ provider: r.provider, currency: r.currency, key: r.public_key, secret: r.secret_key, business: r.business });
}));

app.put('/api/admin/payment-config', auth('admin'), wrap(async (req, res) => {
  const { provider, currency, key, secret, business } = req.body;
  await query(
    `UPDATE payment_config SET provider=$1, currency=$2, public_key=$3, secret_key=$4, business=$5 WHERE id=1`,
    [provider || 'paystack', currency || 'GHS', key || '', secret || '', business || 'VirtualEdge']
  );
  res.json({ ok: true });
}));

app.get('/api/admin/stats', auth('admin'), wrap(async (req, res) => {
  const now = Date.now();
  const users = await query('SELECT plan_end FROM users');
  const rev = await query('SELECT pkg FROM purchases');
  const revenue = rev.rows.reduce((a, r) => a + parsePrice(r.pkg), 0);
  res.json({
    members: users.rows.length,
    active: users.rows.filter((u) => u.plan_end && Number(u.plan_end) > now).length,
    purchases: rev.rows.length,
    revenue,
  });
}));

/* ===================== SCREENSHOT SCAN (Gemini proxy) ===================== */
/* The Gemini key lives only here (GEMINI_API_KEY env var) and never reaches
   the browser. Any signed-in role may scan a betslip screenshot. */
const SCAN_PROMPT =
  'This is a screenshot from a SportyBet Instant Virtual Football betslip or fixture list. ' +
  'It may contain SEVERAL matches. Find EVERY match and list ALL of them. ' +
  'Each match has TWO OPPOSING TEAMS shown next to each other, usually separated by "vs", "v", "-", or a scoreline. ' +
  'Return the exact team names as written. Do NOT include country/site names, league names, market names ' +
  '(Over/Under, BTTS, 1X2, Draw), odds, dates, times, or button labels. ' +
  'Also read the EXACT 1X2 odds for each match from the three columns headed "1", "X", "2" ' +
  '(column 1 = Home-win, column X = Draw, column 2 = Away-win). They are decimals between 1.01 and 51.00. ' +
  'Transcribe every digit exactly — do not round or estimate. If unsure about a team use "", about an odd use null. ' +
  'Respond with ONLY compact JSON: {"matches":[{"home":"Home","away":"Away","oddsHome":1.85,"oddsDraw":3.20,"oddsAway":2.10}]}.';

const titleCase = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).trim();

app.post('/api/scan', auth(), wrap(async (req, res) => {
  if (!['member', 'partner', 'admin'].includes(req.user.role)) return res.status(403).json({ error: 'Forbidden' });
  if (!GEMINI_API_KEY) return res.status(503).json({ error: 'Screenshot scanning is not configured.' });
  const m = /^data:(image\/[a-zA-Z+]+);base64,(.*)$/.exec(String(req.body.image || ''));
  if (!m) return res.status(400).json({ error: 'Bad image data' });
  const mimeType = m[1], base64 = m[2];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;
  let json;
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SCAN_PROMPT }, { inline_data: { mime_type: mimeType, data: base64 } }] }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json' },
      }),
    });
    if (!r.ok) return res.status(502).json({ error: 'Scan failed (' + r.status + ')' });
    json = await r.json();
  } catch (e) {
    return res.status(502).json({ error: 'Scan failed' });
  }

  const text = json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || '';
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { const j = text.match(/\{[\s\S]*\}/); parsed = j ? JSON.parse(j[0]) : {}; }
  let arr = [];
  if (Array.isArray(parsed.matches)) arr = parsed.matches;
  else if (Array.isArray(parsed)) arr = parsed;
  else if (parsed.home || parsed.away) arr = [parsed];

  const num = (v) => { const f = parseFloat(v); return (isFinite(f) && f >= 1.01 && f <= 51) ? +f.toFixed(2) : null; };
  const matches = arr.map((mm) => ({
    home: titleCase((mm.home || '').trim()),
    away: titleCase((mm.away || '').trim()),
    odds: { home: num(mm.oddsHome), draw: num(mm.oddsDraw), away: num(mm.oddsAway) },
  })).filter((mm) => mm.home || mm.away);

  res.json({ matches });
}));

/* ===================== PUBLIC payment config ===================== */
// only non-secret fields — safe to expose to the checkout page
app.get('/api/payment-config/public', wrap(async (req, res) => {
  const { rows } = await query('SELECT provider,currency,public_key,business FROM payment_config WHERE id=1');
  const r = rows[0] || {};
  res.json({ provider: r.provider, currency: r.currency, key: r.public_key, business: r.business });
}));

/* ===================== Cowrie gateway proxy ===================== */
/* Cowrie has no CORS, and its secret key must stay server-side, so the
   browser talks to these endpoints instead of Cowrie directly.
   Public (no auth): used during signup before the member account exists.
   Crediting still happens through the authenticated purchase routes once
   this proxy confirms Cowrie reports the charge as paid. */
const COWRIE_BASE = (process.env.COWRIE_API_BASE || 'https://cowrie-gateway.onrender.com').replace(/\/+$/, '');

async function cowrieKey() {
  const { rows } = await query('SELECT secret_key, public_key FROM payment_config WHERE id=1');
  const r = rows[0] || {};
  return (r.secret_key && r.secret_key.trim()) || (r.public_key && r.public_key.trim()) || '';
}

// create a charge → returns { reference, checkoutUrl }
app.post('/api/pay/cowrie/init', wrap(async (req, res) => {
  const key = await cowrieKey();
  if (!key) return res.status(503).json({ error: 'Payment gateway is not configured.' });
  const { amount, currency, email, metadata } = req.body || {};
  if (!amount || isNaN(amount)) return res.status(400).json({ error: 'A valid amount is required.' });
  let charge;
  try {
    const r = await fetch(COWRIE_BASE + '/api/charges', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: Number(amount), currency: currency || 'GHS', email: email || '', metadata: metadata || {} }),
    });
    const data = await r.json().catch(() => null);
    charge = data && data.charge;
    if (!r.ok || !charge || !charge.reference) return res.status(502).json({ error: 'Could not start payment.' });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the payment gateway.' });
  }
  res.json({
    reference: charge.reference,
    checkoutUrl: COWRIE_BASE + '/checkout?reference=' + encodeURIComponent(charge.reference),
  });
}));

// poll a charge → returns { status, paid, failed }
app.get('/api/pay/cowrie/status', wrap(async (req, res) => {
  const key = await cowrieKey();
  if (!key) return res.status(503).json({ error: 'Payment gateway is not configured.' });
  const reference = String(req.query.reference || '');
  if (!reference) return res.status(400).json({ error: 'reference is required.' });
  let charge;
  try {
    const r = await fetch(COWRIE_BASE + '/api/charges/' + encodeURIComponent(reference), {
      headers: { 'Authorization': 'Bearer ' + key },
    });
    const data = await r.json().catch(() => null);
    charge = data && data.charge;
    if (!r.ok || !charge) return res.status(502).json({ error: 'Could not check payment.' });
  } catch (e) {
    return res.status(502).json({ error: 'Could not reach the payment gateway.' });
  }
  const status = charge.status || 'pending';
  res.json({ status, paid: status === 'success' || !!charge.paidAt, failed: status === 'failed' });
}));

/* ============================ static site ============================ */
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

/* ============================ boot ============================ */
initSchema()
  .catch((e) => console.error('Schema init failed (continuing):', e.message))
  .finally(() => {
    app.listen(PORT, () => console.log(`✓ VirtualEdge running on :${PORT}`));
  });

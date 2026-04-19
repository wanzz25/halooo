// ════════════════════════════════════════════════════════
// MC AutoBackup — Backend Server (Node.js)
// ════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT     = 3000;
const DATA_DIR = path.join(__dirname, 'data');
const FILES    = {
  users:   path.join(DATA_DIR, 'users.json'),
  apikeys: path.join(DATA_DIR, 'apikeys.json'),  // multi API keys
  configs: path.join(DATA_DIR, 'configs.json'),
  backups: path.join(DATA_DIR, 'backups.json'),
  session: path.join(DATA_DIR, 'sessions.json'),
};

// ── Defaults ─────────────────────────────────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DEFAULTS = {
  users:   { nextId: 2, users: [{ id:1, username:'admin', password:'wanzz3369', role:'admin', displayName:'Wanzz', createdAt: new Date().toISOString(), lastLogin:null }] },
  apikeys: [],   // [{ id, userId, label, key, panelUrl, serverUuid, prefix, active, createdAt, lastUsed }]
  configs: {},
  backups: [],
  session: {}
};

Object.entries(FILES).forEach(([k, fp]) => {
  if (!fs.existsSync(fp)) { fs.writeFileSync(fp, JSON.stringify(DEFAULTS[k], null, 2)); console.log(`[init] ${fp}`); }
});

// ── Helpers ───────────────────────────────────────────────
const readJSON  = fp => JSON.parse(fs.readFileSync(fp, 'utf8'));
const writeJSON = (fp, d) => fs.writeFileSync(fp, JSON.stringify(d, null, 2));
const genToken  = () => [...Array(40)].map(() => Math.random().toString(36)[2]).join('');
const getToken  = req => { const a = req.headers['authorization']||''; return a.startsWith('Bearer ') ? a.slice(7) : null; };
const maskKey   = k => k ? '••••••••' + k.slice(-6) : '';

function validateSession(req) {
  const token = getToken(req);
  if (!token) return null;
  const s = readJSON(FILES.session);
  const sess = s[token];
  if (!sess) return null;
  if (sess.exp < Date.now()) { delete s[token]; writeJSON(FILES.session, s); return null; }
  return sess;
}

function requireAuth(req, res) {
  const s = validateSession(req);
  if (!s) { send(res, 401, { error: 'Unauthorized' }); return null; }
  return s;
}
function requireAdmin(req, res) {
  const s = requireAuth(req, res);
  if (!s) return null;
  if (s.role !== 'admin') { send(res, 403, { error: 'Forbidden' }); return null; }
  return s;
}

function send(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((res, rej) => {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => { try { res(b ? JSON.parse(b) : {}); } catch { rej(new Error('Invalid JSON')); } });
  });
}

// ── Static server ─────────────────────────────────────────
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'application/javascript', '.json':'application/json' };

function serveStatic(req, res) {
  let fp = path.join(__dirname, req.url === '/' ? 'index.html' : req.url.split('?')[0]);
  if (!fp.startsWith(__dirname) || fp.includes(path.sep+'data'+path.sep)) {
    return send(res, 403, { error: 'Forbidden' });
  }
  if (!fs.existsSync(fp)) { res.writeHead(404); res.end('Not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'text/plain' });
  fs.createReadStream(fp).pipe(res);
}

// ── Pterodactyl proxy ─────────────────────────────────────
function ptProxy(res, keyEntry, method, ptPath, data) {
  const panelUrl = new URL(keyEntry.panelUrl);
  const isHttps  = panelUrl.protocol === 'https:';
  const lib      = isHttps ? https : http;
  const bodyStr  = data ? JSON.stringify(data) : null;

  const opts = {
    hostname: panelUrl.hostname,
    port: panelUrl.port || (isHttps ? 443 : 80),
    path: ptPath,
    method: method || 'GET',
    headers: {
      'Authorization': `Bearer ${keyEntry.key}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {})
    }
  };

  const pReq = lib.request(opts, pRes => {
    let raw = '';
    pRes.on('data', c => raw += c);
    pRes.on('end', () => {
      res.writeHead(pRes.statusCode, { 'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*' });
      res.end(raw);
    });
  });
  pReq.on('error', e => send(res, 502, { error: 'Proxy error: ' + e.message }));
  if (bodyStr) pReq.write(bodyStr);
  pReq.end();
}

// ════════════════════════════════════════════════════════
// ── Router ───────────────────────────────────────────────
// ════════════════════════════════════════════════════════
const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Headers':'Content-Type,Authorization', 'Access-Control-Allow-Methods':'GET,POST,PUT,DELETE,OPTIONS' });
    res.end(); return;
  }

  if (!pathname.startsWith('/api/')) { serveStatic(req, res); return; }

  let body = {};
  try { body = await readBody(req); } catch {}

  // ── AUTH ──────────────────────────────────────────────
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const db = readJSON(FILES.users);
    const user = db.users.find(u => u.username === body.username && u.password === body.password);
    if (!user) return send(res, 401, { error: 'Username atau password salah' });
    const idx = db.users.findIndex(u => u.id === user.id);
    db.users[idx].lastLogin = new Date().toISOString();
    writeJSON(FILES.users, db);
    const token = genToken();
    const sessions = readJSON(FILES.session);
    sessions[token] = { userId: user.id, username: user.username, role: user.role, displayName: user.displayName, exp: Date.now() + 86400000 * 7 };
    writeJSON(FILES.session, sessions);
    console.log(`[auth] Login: ${user.username}`);
    return send(res, 200, { token, user: { id:user.id, username:user.username, role:user.role, displayName:user.displayName } });
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    const token = getToken(req);
    if (token) { const s = readJSON(FILES.session); delete s[token]; writeJSON(FILES.session, s); }
    return send(res, 200, { ok: true });
  }

  // ── USERS ─────────────────────────────────────────────
  if (pathname === '/api/users' && req.method === 'GET') {
    if (!requireAdmin(req, res)) return;
    const db = readJSON(FILES.users);
    return send(res, 200, { users: db.users.map(({ password:_, ...u }) => u) });
  }

  if (pathname === '/api/users' && req.method === 'POST') {
    if (!requireAdmin(req, res)) return;
    const { username, password, displayName, role } = body;
    if (!username || !password || !displayName) return send(res, 400, { error: 'Field tidak lengkap' });
    const db = readJSON(FILES.users);
    if (db.users.find(u => u.username === username)) return send(res, 409, { error: 'Username sudah dipakai' });
    const newUser = { id: db.nextId++, username, password, role: role||'user', displayName, createdAt: new Date().toISOString(), lastLogin: null };
    db.users.push(newUser);
    writeJSON(FILES.users, db);
    console.log(`[users] Created: ${username}`);
    const { password:_, ...safe } = newUser;
    return send(res, 201, { user: safe });
  }

  const uEditM = pathname.match(/^\/api\/users\/(\d+)$/);
  if (uEditM && req.method === 'PUT') {
    const s = requireAuth(req, res); if (!s) return;
    const tid = parseInt(uEditM[1]);
    if (s.role !== 'admin' && s.userId !== tid) return send(res, 403, { error: 'Forbidden' });
    const db = readJSON(FILES.users);
    const idx = db.users.findIndex(u => u.id === tid);
    if (idx === -1) return send(res, 404, { error: 'User tidak ditemukan' });
    ['displayName','password','role'].forEach(k => { if (body[k] !== undefined) db.users[idx][k] = body[k]; });
    if (body.username && s.role === 'admin') db.users[idx].username = body.username;
    writeJSON(FILES.users, db);
    const { password:_, ...safe } = db.users[idx];
    return send(res, 200, { user: safe });
  }

  const uDelM = pathname.match(/^\/api\/users\/(\d+)$/);
  if (uDelM && req.method === 'DELETE') {
    const s = requireAdmin(req, res); if (!s) return;
    const tid = parseInt(uDelM[1]);
    if (s.userId === tid) return send(res, 400, { error: 'Tidak bisa hapus diri sendiri' });
    const db = readJSON(FILES.users);
    db.users = db.users.filter(u => u.id !== tid);
    writeJSON(FILES.users, db);
    // Remove user's api keys too
    let keys = readJSON(FILES.apikeys);
    keys = keys.filter(k => k.userId !== tid);
    writeJSON(FILES.apikeys, keys);
    console.log(`[users] Deleted: id=${tid}`);
    return send(res, 200, { ok: true });
  }

  // ══════════════════════════════════════════════════════
  // ── API KEYS (multi-key manager) ─────────────────────
  // ══════════════════════════════════════════════════════

  // GET /api/apikeys  — list keys milik user (key di-mask)
  if (pathname === '/api/apikeys' && req.method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    const all = readJSON(FILES.apikeys);
    // Admin bisa lihat semua, user hanya miliknya
    const list = s.role === 'admin' ? all : all.filter(k => k.userId === s.userId);
    // Mask API key sebelum kirim
    const safe = list.map(k => ({ ...k, key: maskKey(k.key), keyRaw: undefined }));
    return send(res, 200, { apikeys: safe });
  }

  // POST /api/apikeys  — tambah key baru
  if (pathname === '/api/apikeys' && req.method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    const { label, key, panelUrl, serverUuid, prefix } = body;
    if (!label || !key || !panelUrl || !serverUuid) return send(res, 400, { error: 'label, key, panelUrl, serverUuid wajib diisi' });

    const all  = readJSON(FILES.apikeys);
    const newKey = {
      id:         Date.now(),
      userId:     s.userId,
      label:      label.trim(),
      key:        key.trim(),
      panelUrl:   panelUrl.trim().replace(/\/$/,''),
      serverUuid: serverUuid.trim(),
      prefix:     (prefix||'mc-backup').trim(),
      active:     true,
      createdAt:  new Date().toISOString(),
      lastUsed:   null,
      lastTest:   null,
      testStatus: null
    };
    all.push(newKey);
    writeJSON(FILES.apikeys, all);
    console.log(`[apikeys] Added "${label}" for userId=${s.userId}`);
    // Return masked
    return send(res, 201, { apikey: { ...newKey, key: maskKey(newKey.key) } });
  }

  // PUT /api/apikeys/:id  — update label/url/uuid/prefix/active
  const keyEditM = pathname.match(/^\/api\/apikeys\/(\d+)$/);
  if (keyEditM && req.method === 'PUT') {
    const s = requireAuth(req, res); if (!s) return;
    const kid = parseInt(keyEditM[1]);
    const all = readJSON(FILES.apikeys);
    const idx = all.findIndex(k => k.id === kid && (k.userId === s.userId || s.role === 'admin'));
    if (idx === -1) return send(res, 404, { error: 'API Key tidak ditemukan' });
    const allowed = ['label','panelUrl','serverUuid','prefix','active'];
    allowed.forEach(f => { if (body[f] !== undefined) all[idx][f] = body[f]; });
    if (body.key && body.key.trim() && !body.key.includes('•')) all[idx].key = body.key.trim();
    writeJSON(FILES.apikeys, all);
    return send(res, 200, { apikey: { ...all[idx], key: maskKey(all[idx].key) } });
  }

  // DELETE /api/apikeys/:id
  const keyDelM = pathname.match(/^\/api\/apikeys\/(\d+)$/);
  if (keyDelM && req.method === 'DELETE') {
    const s = requireAuth(req, res); if (!s) return;
    const kid = parseInt(keyDelM[1]);
    let all = readJSON(FILES.apikeys);
    const entry = all.find(k => k.id === kid);
    if (!entry || (entry.userId !== s.userId && s.role !== 'admin')) return send(res, 404, { error: 'Tidak ditemukan' });
    all = all.filter(k => k.id !== kid);
    writeJSON(FILES.apikeys, all);
    console.log(`[apikeys] Deleted id=${kid}`);
    return send(res, 200, { ok: true });
  }

  // POST /api/apikeys/:id/test  — test koneksi key tertentu
  const keyTestM = pathname.match(/^\/api\/apikeys\/(\d+)\/test$/);
  if (keyTestM && req.method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    const kid = parseInt(keyTestM[1]);
    const all = readJSON(FILES.apikeys);
    const idx = all.findIndex(k => k.id === kid && (k.userId === s.userId || s.role === 'admin'));
    if (idx === -1) return send(res, 404, { error: 'Tidak ditemukan' });
    const entry = all[idx];

    // Test via Pterodactyl API
    const panelUrl = new URL(entry.panelUrl);
    const isHttps  = panelUrl.protocol === 'https:';
    const lib      = isHttps ? https : http;

    const opts = {
      hostname: panelUrl.hostname,
      port: panelUrl.port || (isHttps ? 443 : 80),
      path: `/api/client/servers/${entry.serverUuid}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${entry.key}`, 'Accept': 'application/json' }
    };

    const testReq = lib.request(opts, testRes => {
      let raw = '';
      testRes.on('data', c => raw += c);
      testRes.on('end', () => {
        const ok = testRes.statusCode === 200;
        let serverName = entry.serverUuid;
        try { serverName = JSON.parse(raw)?.attributes?.name || serverName; } catch {}
        all[idx].lastTest   = new Date().toISOString();
        all[idx].testStatus = ok ? 'ok' : `HTTP ${testRes.statusCode}`;
        if (ok) { all[idx].serverName = serverName; all[idx].lastUsed = new Date().toISOString(); }
        writeJSON(FILES.apikeys, all);
        send(res, 200, { ok, serverName: ok ? serverName : null, status: all[idx].testStatus });
        console.log(`[apikeys] Test id=${kid} → ${all[idx].testStatus} (${serverName})`);
      });
    });
    testReq.on('error', e => {
      all[idx].lastTest   = new Date().toISOString();
      all[idx].testStatus = 'error: ' + e.message;
      writeJSON(FILES.apikeys, all);
      send(res, 200, { ok: false, status: all[idx].testStatus });
    });
    testReq.end();
    return;
  }

  // POST /api/apikeys/:id/backup  — jalankan backup pakai key tertentu
  const keyBkM = pathname.match(/^\/api\/apikeys\/(\d+)\/backup$/);
  if (keyBkM && req.method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    const kid = parseInt(keyBkM[1]);
    const all = readJSON(FILES.apikeys);
    const idx = all.findIndex(k => k.id === kid && (k.userId === s.userId || s.role === 'admin'));
    if (idx === -1) return send(res, 404, { error: 'Tidak ditemukan' });
    const entry = all[idx];

    // Update lastUsed
    all[idx].lastUsed = new Date().toISOString();
    writeJSON(FILES.apikeys, all);

    // Proxy the backup creation
    ptProxy(res, entry, 'POST', `/api/client/servers/${entry.serverUuid}/backups`, { name: body.name || `${entry.prefix}-backup`, is_locked: false });
    return;
  }

  // POST /api/proxy  — generic proxy pakai keyId
  if (pathname === '/api/proxy' && req.method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    const { keyId, method, ptPath, data } = body;
    if (!keyId) return send(res, 400, { error: 'keyId wajib' });
    const all = readJSON(FILES.apikeys);
    const entry = all.find(k => k.id === parseInt(keyId) && (k.userId === s.userId || s.role === 'admin'));
    if (!entry) return send(res, 404, { error: 'API Key tidak ditemukan' });
    ptProxy(res, entry, method, ptPath, data);
    return;
  }

  // ── BACKUPS ───────────────────────────────────────────
  if (pathname === '/api/backups' && req.method === 'GET') {
    const s = requireAuth(req, res); if (!s) return;
    const db = readJSON(FILES.backups);
    const { keyId } = new URL(req.url, `http://localhost`).searchParams;
    let list = db.filter(b => b.userId === s.userId);
    if (keyId) list = list.filter(b => b.keyId === parseInt(keyId));
    return send(res, 200, { backups: list });
  }

  if (pathname === '/api/backups' && req.method === 'POST') {
    const s = requireAuth(req, res); if (!s) return;
    const db = readJSON(FILES.backups);
    const record = { id: Date.now(), userId: s.userId, ...body, createdAt: new Date().toISOString() };
    db.unshift(record);
    writeJSON(FILES.backups, db.slice(0, 1000));
    console.log(`[backup] ${record.name} (keyId=${record.keyId}) user=${s.userId}`);
    return send(res, 201, { backup: record });
  }

  const bkDelM = pathname.match(/^\/api\/backups\/(\d+)$/);
  if (bkDelM && req.method === 'DELETE') {
    const s = requireAuth(req, res); if (!s) return;
    const bid = parseInt(bkDelM[1]);
    let db = readJSON(FILES.backups);
    db = db.filter(b => !(b.userId === s.userId && b.id === bid));
    writeJSON(FILES.backups, db);
    return send(res, 200, { ok: true });
  }

  send(res, 404, { error: 'Endpoint tidak ditemukan' });
});

server.listen(PORT, () => {
  console.log('\n  ╔══════════════════════════════════════╗');
  console.log(`  ║  MC AutoBackup  →  http://localhost:${PORT}  ║`);
  console.log('  ║  Data folder   →  ./data/            ║');
  console.log('  ╚══════════════════════════════════════╝\n');
  console.log('  Files:');
  Object.entries(FILES).forEach(([k,v]) => console.log(`    ${k.padEnd(10)}→ ${v}`));
  console.log('');
});

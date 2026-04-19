// ════════════════════════════════════════════
// MC AutoBackup — Shared Utilities (API Mode)
// Data disimpan di server → file data/*.json
// ════════════════════════════════════════════

const API_BASE = window.location.origin;

// ─── API Client ──────────────────────────────
const API = {
  _token() { return localStorage.getItem('mcb_token') || ''; },
  _headers() {
    return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${this._token()}` };
  },
  async get(path) {
    const r = await fetch(API_BASE + path, { headers: this._headers() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  },
  async post(path, body = {}) {
    const r = await fetch(API_BASE + path, { method: 'POST', headers: this._headers(), body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  },
  async put(path, body = {}) {
    const r = await fetch(API_BASE + path, { method: 'PUT', headers: this._headers(), body: JSON.stringify(body) });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  },
  async del(path) {
    const r = await fetch(API_BASE + path, { method: 'DELETE', headers: this._headers() });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    return d;
  }
};

// ─── Session ──────────────────────────────────
const Session = {
  get() { try { return JSON.parse(localStorage.getItem('mcb_session')); } catch { return null; } },
  set(user, token) {
    localStorage.setItem('mcb_session', JSON.stringify(user));
    localStorage.setItem('mcb_token', token);
  },
  clear() { localStorage.removeItem('mcb_session'); localStorage.removeItem('mcb_token'); },
  require(to = '/index.html') {
    const s = this.get();
    if (!s) { window.location.href = to; return null; }
    return s;
  },
  requireAdmin(to = '/pages/dashboard.html') {
    const s = this.require();
    if (s && s.role !== 'admin') { window.location.href = to; return null; }
    return s;
  }
};

// ─── Toast ────────────────────────────────────
const Toast = {
  _c: null,
  init() {
    if (!this._c) {
      let el = document.getElementById('toast');
      if (!el) { el = document.createElement('div'); el.id = 'toast'; document.body.appendChild(el); }
      this._c = el;
    }
  },
  show(msg, type = 'ok', dur = 3500) {
    this.init();
    const el = document.createElement('div');
    el.className = 'toast-item' + (type === 'err' ? ' err' : type === 'warn' ? ' warn' : '');
    el.textContent = (type === 'err' ? '✖ ' : type === 'warn' ? '⚠ ' : '✔ ') + msg;
    this._c.appendChild(el);
    requestAnimationFrame(() => el.classList.add('show'));
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 400); }, dur);
  },
  ok(m)   { this.show(m, 'ok'); },
  err(m)  { this.show(m, 'err'); },
  warn(m) { this.show(m, 'warn'); }
};

// ─── Helpers ──────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('id-ID', { day:'2-digit', month:'short', year:'numeric' })
    + ' ' + d.toLocaleTimeString('id-ID', { hour:'2-digit', minute:'2-digit' });
}
function fmtSize(mb) {
  if (!mb) return '0 MB';
  if (mb >= 1024) return (mb/1024).toFixed(2)+' GB';
  return parseFloat(mb).toFixed(1)+' MB';
}
function avatarColor(letter) {
  const c = ['#00e5a0','#60a5fa','#f472b6','#ffd166','#a78bfa','#fb923c'];
  return c[(letter||'A').charCodeAt(0) % c.length];
}
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

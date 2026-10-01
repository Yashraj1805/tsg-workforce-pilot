// Main UI / router for the TSG Workforce app. Talks to a real backend (see api.js) —
// every screen that shows data now fetches it over the network, so this file is built
// around async render functions with explicit loading and error states, instead of the
// old instant localStorage reads.

const GPS_ACCURACY_LIMIT_M = 100; // fallback if a location has no accuracy_limit set
// getApiBase/setApiBase/getSession/setSessionData/clearSessionData/getDeviceId are already
// global (api.js declares them as top-level functions), so they're callable here directly —
// redeclaring them via `const {...} = window.ApiSession` threw "Identifier already declared"
// on every load, since classic <script> tags share one global lexical scope and you can't
// mix a function-style global binding with a lexical const of the same name.

function fmtTime(ts) { if (!ts) return '--'; const d = new Date(ts); return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
function esc(s) { return (s ?? '').toString().replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function statusBadge(status) {
  const map = {
    present: ['badge-ok', 'Present'], half_day: ['badge-warn', 'Half day'],
    missed_punch_out: ['badge-warn', 'Missed punch-out'], absent: ['badge-bad', 'Absent'],
    pending: ['badge-warn', 'Pending'], approved: ['badge-ok', 'Approved'],
    rejected: ['badge-bad', 'Rejected'], sent_back: ['badge-warn', 'Sent back'],
  };
  const [cls, label] = map[status] || ['badge-neutral', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

const ICONS = {
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>',
  calendar: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  menu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M12 20V4M20 20v-7"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.3 2.3L16 10"/></svg>',
  doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h9l4 4v14H6z"/><path d="M14 3v5h5M9 13h6M9 17h6"/></svg>',
  warn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l10 18H2z"/><path d="M12 10v4M12 17.5v.1"/></svg>',
  building: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18"/><path d="M9 8h1M14 8h1M9 12h1M14 12h1M9 16h1M14 16h1"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c1.5-4.5 5-6 8-6s6.5 1.5 8 6"/></svg>',
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.6 7-12a7 7 0 10-14 0c0 5.4 7 12 7 12z"/><circle cx="12" cy="9" r="2.3"/></svg>',
  inbox: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12h4l2 3h4l2-3h4"/><path d="M5.5 5h13L21 12v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6L5.5 5z"/></svg>',
  grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8h3l2-2h6l2 2h3a1 1 0 011 1v10a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l8 3v6c0 4.5-3.4 7.5-8 9-4.6-1.5-8-4.5-8-9V6l8-3z"/><path d="M9 12l2 2 4-4"/></svg>',
  sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18"/></svg>',
  plug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 3v4M15 3v4M6 7h12l-1 5a5 5 0 01-10 0L6 7z"/><path d="M12 16v5"/></svg>',
};
function icon(name) { return ICONS[name] || ''; }

function avatarHtml(worker) {
  if (worker.photo_data_url) return `<img src="${worker.photo_data_url}" class="avatar" />`;
  const initials = (worker.name || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  return `<div class="avatar">${esc(initials)}</div>`;
}

function emptyState(message, iconName) {
  return `<div class="empty-state"><div class="empty-icon">${icon(iconName || 'inbox')}</div><p>${message}</p></div>`;
}
function spinnerRow(label) {
  return `<div class="spinner-row" role="status" aria-live="polite"><div class="spinner"></div><span>${label}</span></div>`;
}
function errorState(message) {
  return `<div class="empty-state"><div class="empty-icon">${icon('warn')}</div><p>${esc(message)}</p><button class="btn secondary" onclick="render()">Retry</button></div>`;
}

// ---------------- Toasts ----------------
function toast(message, type) {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const el = document.createElement('div');
  el.className = `toast ${type || 'info'}`;
  el.textContent = message;
  container.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 250); }, 3200);
}

// ---------------- Async render helper ----------------
// Shows a loading spinner immediately, runs `fetcher`, then either renders the result
// via `onSuccess` or shows a retry state on failure (e.g. server unreachable).
async function withLoading(fetcher, onSuccess, loadingLabel) {
  renderShell(`<div class="card">${spinnerRow(loadingLabel || 'Loading…')}</div>`);
  try {
    const data = await fetcher();
    onSuccess(data);
  } catch (e) {
    renderShell(`<div class="card">${errorState(e.message || 'Something went wrong')}</div>`);
  }
}

// ---------------- Smart Alerts / Insights engine ----------------
// Deterministic, computed-on-the-fly pattern detection over live backend data — the
// "AI Time Guard" style anomaly flags. No ML model involved; a production version
// would run equivalent checks server-side, likely backed by a trained model.

function minutesOfDay(ts) { const d = new Date(ts); return d.getHours() * 60 + d.getMinutes(); }
function fmtMinutes(min) { const h = Math.floor(min / 60), m = Math.round(min % 60); const d = new Date(); d.setHours(h, m, 0, 0); return fmtTime(d.getTime()); }

function computeTimeGuardFlags({ workers, locations, punches, regularisations }) {
  const flags = [];
  const now = Date.now();
  const sevenDaysAgo = now - 7 * 86400000;
  const thirtyDaysAgo = now - 30 * 86400000;
  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const locById = Object.fromEntries(locations.map(l => [l.id, l]));
  const nameById = Object.fromEntries(workers.map(w => [w.id, w.name || w.mobile]));

  workers.filter(w => w.status === 'approved').forEach(w => {
    const wPunches = punches.filter(p => p.worker_id === w.id && p.result === 'ok');
    const inPunches = wPunches.filter(p => p.type === 'in').sort((a, b) => a.ts - b.ts);

    if (inPunches.length >= 4) {
      const recentIns = inPunches.slice(-10);
      const avgMinute = recentIns.reduce((sum, p) => sum + minutesOfDay(p.ts), 0) / recentIns.length;
      const last = recentIns[recentIns.length - 1];
      const lastMinute = minutesOfDay(last.ts);
      if (last.ts > sevenDaysAgo && Math.abs(lastMinute - avgMinute) > 45) {
        flags.push({ type: 'unusual_time', severity: 'warn', workerId: w.id, ts: last.ts,
          message: `Punched in ${Math.round(Math.abs(lastMinute - avgMinute))} min ${lastMinute > avgMinute ? 'later' : 'earlier'} than usual (their average is ${fmtMinutes(avgMinute)})` });
      }
    }

    const blocked7d = punches.filter(p => p.worker_id === w.id && p.result === 'blocked' && p.reason === 'outside_geofence' && p.ts > sevenDaysAgo);
    if (blocked7d.length >= 2) {
      flags.push({ type: 'geofence_pattern', severity: 'bad', workerId: w.id, ts: blocked7d[blocked7d.length - 1].ts,
        message: `${blocked7d.length} outside-geofence attempts in the last 7 days` });
    }

    const loc = locById[w.location_id];
    if (loc) {
      const nearEdge = wPunches.filter(p => p.distance_m != null && p.distance_m > loc.radius * 0.8 && p.distance_m <= loc.radius && p.ts > thirtyDaysAgo);
      if (nearEdge.length >= 3) {
        flags.push({ type: 'borderline_location', severity: 'warn', workerId: w.id, ts: nearEdge[nearEdge.length - 1].ts,
          message: `${nearEdge.length} punches within 80-100% of the geofence radius in 30 days` });
      }
    }

    for (let i = 0; i < 14; i++) {
      const d = todayStr(now - i * 86400000);
      const st = attendanceStatusForDay(wPunches, d);
      if (st.hours && st.hours > 10) {
        flags.push({ type: 'overtime_risk', severity: 'warn', workerId: w.id, ts: st.outTime || now,
          message: `Worked ${st.hours}h on ${d} — check for a missed punch-out or approve overtime` });
      }
    }

    const regThisMonth = regularisations.filter(r => r.worker_id === w.id && r.created_at >= monthStart.getTime());
    const punchDaysThisMonth = new Set(wPunches.filter(p => p.ts >= monthStart.getTime()).map(p => todayStr(p.ts))).size || 1;
    const regRate = regThisMonth.length / punchDaysThisMonth;
    if (regThisMonth.length >= 2 && regRate > 0.02) {
      flags.push({ type: 'high_regularisation', severity: 'warn', workerId: w.id, ts: now,
        message: `${regThisMonth.length} regularisations this month (${Math.round(regRate * 100)}% of days) — above the BRD's 2% target` });
    }
  });

  const okPunches = punches.filter(p => p.result === 'ok' && p.lat != null).sort((a, b) => a.ts - b.ts);
  for (let i = 0; i < okPunches.length; i++) {
    for (let j = i + 1; j < okPunches.length; j++) {
      const a = okPunches[i], b = okPunches[j];
      if (b.ts - a.ts > 120000) break;
      if (a.worker_id === b.worker_id) continue;
      const d = haversineMeters(a.lat, a.lng, b.lat, b.lng);
      if (d < 5) {
        flags.push({ type: 'shared_device', severity: 'bad', workerId: a.worker_id, ts: b.ts,
          message: `${esc(nameById[a.worker_id])} and ${esc(nameById[b.worker_id])} punched ${Math.round((b.ts - a.ts) / 1000)}s apart at nearly the same GPS point (${d.toFixed(1)}m) — check for a shared device` });
      }
    }
  }

  flags.sort((x, y) => y.ts - x.ts);
  return flags;
}

function computeSmartInsights({ workers, locations, punches, flags }) {
  const today = todayStr(Date.now());
  const activeWorkers = workers.filter(w => w.status === 'approved');
  const todayIns = punches.filter(p => p.type === 'in' && p.result === 'ok' && todayStr(p.ts) === today);
  const locNameById = Object.fromEntries(locations.map(l => [l.id, l.name]));
  const workerLocId = Object.fromEntries(workers.map(w => [w.id, w.location_id]));
  const byLocation = {};
  todayIns.forEach(p => {
    const name = locNameById[workerLocId[p.worker_id]]; if (!name) return;
    byLocation[name] = (byLocation[name] || 0) + 1;
  });
  const sortedLocs = Object.entries(byLocation).sort((a, b) => b[1] - a[1]);
  const blocked7d = punches.filter(p => p.result === 'blocked' && p.ts > Date.now() - 7 * 86400000).length;
  const total7d = punches.filter(p => p.ts > Date.now() - 7 * 86400000).length || 1;
  const notPunched = activeWorkers.length - todayIns.length;

  const lines = [];
  lines.push(notPunched > 0
    ? `${notPunched} of ${activeWorkers.length} active workers haven't punched in yet today.`
    : `All ${activeWorkers.length} active workers have punched in today.`);
  if (sortedLocs.length) lines.push(`${sortedLocs[0][0]} has the most punch-ins today (${sortedLocs[0][1]}).`);
  if (blocked7d > 0) lines.push(`${blocked7d} blocked punch attempt${blocked7d > 1 ? 's' : ''} in the last 7 days (${Math.round(blocked7d / total7d * 100)}% of all attempts).`);
  lines.push(flags.length > 0
    ? `${flags.length} pattern alert${flags.length > 1 ? 's' : ''} need review — see AI Time Guard.`
    : `No unusual patterns detected in the last check.`);
  return { lines, byLocation: sortedLocs };
}

function barChart(entries) {
  if (!entries.length) return '';
  const max = Math.max(...entries.map(e => e[1]));
  return `<div class="bar-chart">${entries.map(([label, val]) => `
    <div class="bar-row">
      <span class="bar-label">${esc(label)}</span>
      <div class="bar-track"><div class="bar-fill" style="width:${Math.max(6, Math.round(val / max * 100))}%"></div></div>
      <span class="bar-value">${val}</span>
    </div>`).join('')}</div>`;
}

// ---------------- Layout ----------------

function renderShell(innerHtml) {
  const s = getSession();
  const app = document.getElementById('app');
  const nav = s ? renderNav(s.role) : '';
  app.innerHTML = `
    <header class="topbar">
      <div class="topbar-title">
        <div class="app-name">${t('appName')}</div>
        <div class="demo-badge">${getApiBase() ? esc(getApiBase().replace(/^https?:\/\//, '')) : t('demoBadge')}</div>
      </div>
      <div class="topbar-actions">
        <button class="lang-btn ${currentLang==='en'?'active':''}" onclick="switchLang('en')">EN</button>
        <button class="lang-btn ${currentLang==='hi'?'active':''}" onclick="switchLang('hi')">HI</button>
      </div>
    </header>
    <main class="content">${innerHtml}</main>
    ${nav}
  `;
}

// ---------------- Admin roles (BRD §5) ----------------
// The server decides what each role can do (tsg-workforce-backend/src/rbac.js) and
// enforces it on every request. The permission list it sends at login is only used
// here to hide screens and buttons the user would just get a 403 from.
const ROLE_LABELS = {
  reporting_manager: 'Reporting Manager', site_hr: 'Site HR', central_hr: 'Central HR',
  location_head: 'Location Head', vendor_coordinator: 'Vendor Coordinator',
  mis_finance: 'MIS / Finance', security: 'Security', system_admin: 'System Admin',
};
function isAdminSession(s) { return !!s && s.role !== 'worker'; }
function hasPerm(p) { const s = getSession(); return !!(s && s.permissions && s.permissions.includes(p)); }

// Every admin screen, in nav-priority order. `perms` must all be held to open it; the
// first three a role can open (among `nav: true`) become its bottom-nav tabs, the rest
// go under "More".
const ADMIN_SCREENS = [
  { hash: '#/hr/dashboard', icon: 'chart', label: () => t('hrDashboard'), perms: ['workers.read', 'punches.read'], nav: true },
  { hash: '#/hr/approvals', icon: 'check', label: () => t('hrApprovals'), perms: ['workers.approve'], nav: true },
  { hash: '#/hr/attendance', icon: 'calendar', label: () => t('hrAttendance'), perms: ['workers.read', 'punches.read'], nav: true },
  { hash: '#/hr/exceptions', icon: 'warn', label: () => t('hrExceptions'), perms: ['punches.read'], nav: true },
  { hash: '#/hr/masters', icon: 'building', label: () => t('hrMasters'), perms: ['masters.write'], nav: true },
  { hash: '#/hr/users', icon: 'user', label: () => 'Users', perms: ['users.manage'], nav: true },
  { hash: '#/hr/audit', icon: 'ledger', label: () => t('hrAudit'), perms: ['audit.read'], nav: true },
  { hash: '#/hr/timeguard', icon: 'shield', label: () => t('timeGuard'), perms: ['workers.read', 'punches.read'] },
  { hash: '#/hr/regularisations', icon: 'doc', label: () => t('hrRegularisations'), perms: ['regularisations.read', 'workers.read'] },
  { hash: '#/hr/account', icon: 'user', label: () => t('account'), perms: [] },
];
const ADMIN_ROUTE_PERMS = { '#/hr/worker': ['workers.read'], '#/hr/more': [], '#/hr/logout-confirm': [] };
function canOpenAdminRoute(hash) {
  const screen = ADMIN_SCREENS.find(x => x.hash === hash);
  const perms = screen ? screen.perms : ADMIN_ROUTE_PERMS[hash];
  return !!perms && perms.every(hasPerm);
}
function adminNavScreens() { return ADMIN_SCREENS.filter(x => x.nav && x.perms.every(hasPerm)).slice(0, 3); }
function adminMoreScreens() {
  const inNav = adminNavScreens().map(x => x.hash);
  return ADMIN_SCREENS.filter(x => !inNav.includes(x.hash) && x.perms.every(hasPerm));
}
function adminHomeHash() { const first = adminNavScreens()[0]; return first ? first.hash : '#/hr/account'; }

function navLink(href, iconName, label, forceActive) {
  const active = forceActive != null ? forceActive : location.hash === href;
  return `<a href="${href}" class="${active ? 'active' : ''}"><span class="nav-icon">${icon(iconName)}</span>${label}</a>`;
}

function renderNav(role) {
  if (role === 'worker') {
    return `<nav class="bottom-nav">
      ${navLink('#/w/home', 'home', t('home'))}
      ${navLink('#/w/attendance', 'calendar', t('attendance'))}
      ${navLink('#/w/menu', 'menu', t('menu'))}
    </nav>`;
  }
  const moreRoutes = ['#/hr/more', ...adminMoreScreens().map(x => x.hash)];
  return `<nav class="bottom-nav">
    ${adminNavScreens().map(x => navLink(x.hash, x.icon, x.label())).join('')}
    ${navLink('#/hr/more', 'grid', t('more'), moreRoutes.includes(location.hash))}
  </nav>`;
}

function switchLang(l) { setLang(l); render(); }

// ---------------- Splash / Server settings ----------------

function renderSplash() {
  loginState = {}; // reaching splash by any path (logout, settings save, back) resets any in-flight login sub-step
  const base = getApiBase();
  renderShell(`
    <div class="card center-card">
      <h2>${t('appName')}</h2>
      <p class="muted small">${t('connectedTo')} ${esc(base)}</p>
      <button class="btn primary block" onclick="startWorkerLogin()">${t('roleWorker')}</button>
      <button class="btn secondary block" onclick="startHrLogin()">${t('roleHr')}</button>
      <button class="link-btn small" style="margin-top:16px" onclick="location.hash='#/settings';render()">${t('serverSettings')}</button>
    </div>
  `);
}

function renderSettings() {
  const current = getApiBase();
  renderShell(`
    <div class="card center-card">
      <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('plug')}</span>${t('serverSettings')}</h3>
      <p class="muted small">${t('serverSettingsHint')}</p>
      <input id="apiBaseInput" class="input" placeholder="http://192.168.1.23:4000" value="${esc(current)}" />
      <button class="btn secondary block" onclick="testConnection()">${t('testConnection')}</button>
      <div id="connStatus"></div>
      <button class="btn primary block" style="margin-top:10px" onclick="saveApiBase()">${t('save')}</button>
      ${current ? `<button class="link-btn small" style="margin-top:10px" onclick="location.hash='#/';render()">${t('back')}</button>` : ''}
    </div>
  `);
}
async function testConnection() {
  const url = document.getElementById('apiBaseInput').value.trim();
  const statusEl = document.getElementById('connStatus');
  statusEl.className = 'gps-status loading';
  statusEl.innerHTML = spinnerRow(t('checkingConnection'));
  setApiBase(url);
  const result = await window.Api.checkHealth();
  if (result.ok) { statusEl.className = 'gps-status ok'; statusEl.innerHTML = '✅ ' + t('connectionOk'); }
  else { statusEl.className = 'gps-status bad'; statusEl.innerHTML = '❌ ' + esc(result.error); }
}
function saveApiBase() {
  const url = document.getElementById('apiBaseInput').value.trim();
  if (!url) { toast(t('enterServerUrl'), 'error'); return; }
  setApiBase(url);
  toast(t('serverSaved'), 'success');
  location.hash = '#/'; render();
}

// ---------------- Worker: login ----------------

let loginState = {};

function startWorkerLogin() {
  loginState = { step: 'mobile' };
  renderShell(`
    <div class="card center-card">
      <h3>${t('mobileNumber')}</h3>
      <input id="loginMobile" class="input" maxlength="10" inputmode="numeric" placeholder="98xxxxxxxx" />
      <button class="btn primary block" onclick="workerRequestOtp()">${t('sendOtp')}</button>
    </div>
  `);
}
async function workerRequestOtp() {
  const mobile = document.getElementById('loginMobile').value.trim();
  if (!/^\d{10}$/.test(mobile)) { toast(t('invalidMobile'), 'error'); return; }
  try {
    const result = await window.Api.workerOtpRequest(mobile);
    loginState = { step: 'otp', mobile };
    renderShell(`
      <div class="card center-card">
        <h3>${t('enterOtp')}</h3>
        <p class="muted small">${result.devOtp ? `${t('otpHint')}: ${result.devOtp}` : `OTP sent to ${esc(mobile)}`}</p>
        <input id="loginOtp" class="input" maxlength="6" inputmode="numeric" />
        <button class="btn primary block" onclick="workerVerifyOtp()">${t('verify')}</button>
      </div>
    `);
  } catch (e) { toast(e.message, 'error'); }
}
async function workerVerifyOtp() {
  const otp = document.getElementById('loginOtp').value.trim();
  try {
    const result = await window.Api.workerOtpVerify(loginState.mobile, otp);
    setSessionData({ token: result.token, role: 'worker', mobile: loginState.mobile, workerId: result.worker.id });
    loginState = {}; // otherwise a stale step:'otp' would hijack the back button deep in the app later
    if (result.worker.status === 'approved') location.hash = '#/w/home';
    else if (result.worker.status === 'draft') location.hash = '#/w/register';
    else location.hash = '#/w/pending';
    render();
  } catch (e) { toast(e.message, 'error'); }
}

function requireWorker() {
  const s = getSession();
  if (!s || s.role !== 'worker') { location.hash = '#/'; render(); return false; }
  return true;
}

// ---------------- Worker: registration wizard ----------------

let regState = { step: 1 };

function renderRegister() {
  if (!requireWorker()) return;
  withLoading(() => window.Api.getMe(), (w) => {
    regState = { ...regState, worker: w };
    if (w.status !== 'draft' && w.status !== 'sent_back') { location.hash = w.status === 'approved' ? '#/w/home' : '#/w/pending'; render(); return; }
    renderRegStep(regState.step || 1);
  });
}

async function renderRegStep(step) {
  regState.step = step;
  if (step === 1) return renderRegStep1();
  if (step === 2) return renderRegStep2();
  return renderRegStep3();
}

function renderRegStep1() {
  const w = regState.worker;
  renderShell(`
    <div class="card">
      <h3>Aadhaar card</h3>
      ${w.aadhaar_qr_at
        ? `<div class="kyc-status ok">✅ Aadhaar scanned — ${esc(w.aadhaar_masked || '')}</div>`
        : `<p class="muted small">Scan the QR code on the Aadhaar card — your details below fill in by themselves.</p>`}
      ${regState.aadhaarNameWarning ? `<div class="gps-status bad">Name on Aadhaar is "${esc(regState.aadhaarNameWarning)}" — your name below must match it.
        <button class="btn secondary small" style="margin-top:6px" onclick="useAadhaarName(this)">Use Aadhaar name</button></div>` : ''}
      <button class="btn ${w.aadhaar_qr_at ? 'secondary' : 'primary'} block big" onclick="regScanAadhaar()"><span class="icon-inline">${icon('camera')}</span> ${w.aadhaar_qr_at ? 'Scan again' : 'Scan Aadhaar QR'}</button>
    </div>
    <div class="card">
      <h3>${t('personalDetails')}</h3>
      <label>${t('fullName')}</label><input id="f_name" class="input" value="${esc(w.name||'')}" />
      <label>${t('fatherName')}</label><input id="f_father" class="input" value="${esc(w.father_name||'')}" />
      <label>${t('dob')}</label><input id="f_dob" type="date" class="input" value="${esc(w.dob||'')}" />
      <label>${t('gender')}</label>
      <select id="f_gender" class="input">
        <option value="male" ${w.gender==='male'?'selected':''}>${t('male')}</option>
        <option value="female" ${w.gender==='female'?'selected':''}>${t('female')}</option>
        <option value="other" ${w.gender==='other'?'selected':''}>${t('other')}</option>
      </select>
      <label>${t('address')}</label><textarea id="f_address" class="input">${esc(w.address||'')}</textarea>
      <label>${t('emergencyContact')}</label><input id="f_emg" class="input" maxlength="10" value="${esc(w.emergency_contact||'')}" />
      <label>${t('qualification')}</label><input id="f_qual" class="input" value="${esc(w.qualification||'')}" />
      <label>${t('experience')}</label><input id="f_exp" type="number" min="0" class="input" value="${esc(w.experience||'')}" />
      <div class="wizard-actions">
        <span></span>
        <button class="btn primary" onclick="regStep1Next()">${t('next')}</button>
      </div>
    </div>
  `);
}
// R04: Aadhaar captured by scanning its QR. The server decodes it, keeps only the
// masked number, and fills any empty name/DOB/gender — so re-render with what it saved.
async function regScanAadhaar() {
  const scan = await window.TSGNative.scanQrCode();
  if (!scan.ok) { if (!scan.cancelled) toast(scan.error, 'error'); return; }
  try {
    const result = await window.Api.aadhaarQr(scan.text);
    regState.worker = result.worker;
    // R05: names must match. The server won't block the scan (the typed name may just be
    // a draft), but submit will — so say so now, with the Aadhaar name to copy.
    regState.aadhaarNameWarning = result.nameMatches === false ? result.name : null;
    toast(`Aadhaar scanned (…${result.last4})`, result.nameMatches === false ? 'error' : 'success');
    renderRegStep(regState.step);
  } catch (e) { toast(e.message, 'error'); }
}
function useAadhaarName(btn) {
  document.getElementById('f_name').value = regState.aadhaarNameWarning;
  regState.aadhaarNameWarning = null;
  btn.parentNode.remove();
}
async function regStep1Next() {
  const get = id => document.getElementById(id).value.trim();
  const fields = {
    name: get('f_name'), fatherName: get('f_father'), dob: get('f_dob'), gender: get('f_gender'),
    address: get('f_address'), emergencyContact: get('f_emg'), qualification: get('f_qual'), experience: get('f_exp'),
  };
  if (!fields.name) { toast('Name is required', 'error'); return; }
  try {
    regState.worker = await window.Api.updateMe(fields);
    renderRegStep(2);
  } catch (e) { toast(e.message, 'error'); }
}

async function renderRegStep2() {
  await withLoading(
    () => Promise.all([window.Api.listVendors(), window.Api.listLocations()]),
    ([vendors, locations]) => {
      const w = regState.worker;
      const blocked = vendors.length === 0 || locations.length === 0;
      renderShell(`
        <div class="card">
          <h3>${t('workDetails')}</h3>
          ${blocked ? `<div class="gps-status bad">${t('noVendorsLocationsYet')}</div>` : ''}
          <label>${t('vendor')}</label>
          <select id="f_vendor" class="input" ${vendors.length===0?'disabled':''}>${vendors.length===0 ? `<option value="">${t('none')}</option>` : vendors.map(v=>`<option value="${v.id}" ${w.vendor_id===v.id?'selected':''}>${esc(v.name)}</option>`).join('')}</select>
          <label>${t('location')}</label>
          <select id="f_location" class="input" ${locations.length===0?'disabled':''}>${locations.length===0 ? `<option value="">${t('none')}</option>` : locations.map(l=>`<option value="${l.id}" ${w.location_id===l.id?'selected':''}>${esc(l.name)}</option>`).join('')}</select>
          <label>${t('designation')}</label><input id="f_designation" class="input" value="${esc(w.designation||'')}" />
          <label>${t('doj')}</label><input id="f_doj" type="date" class="input" value="${esc(w.doj||'')}" />
          <h3>${t('capturePhoto')}</h3>
          <div class="selfie-frame">
            ${w.photo_data_url ? `<img src="${w.photo_data_url}" class="selfie-preview" />` : `<div class="selfie-placeholder"><span class="icon-inline" style="width:28px;height:28px;margin:0 0 6px">${icon('camera')}</span><br/>No photo yet</div>`}
          </div>
          <button class="btn secondary block" onclick="regCapturePhoto()">${w.photo_data_url ? t('retake') : t('capturePhoto')}</button>
          <div class="wizard-actions">
            <button class="btn secondary" onclick="renderRegStep(1)">${t('back')}</button>
            <button class="btn primary" ${blocked?'disabled':''} onclick="regStep2Next()">${t('next')}</button>
          </div>
        </div>
      `);
    }
  );
}
async function regCapturePhoto() {
  const res = await window.TSGNative.takeSelfie();
  if (!res.ok) { toast('Camera failed: ' + res.error, 'error'); return; }
  try {
    regState.worker = await window.Api.updateMe({ photoDataUrl: res.dataUrl });
    renderRegStep(2);
  } catch (e) { toast(e.message, 'error'); }
}
async function regStep2Next() {
  const get = id => document.getElementById(id).value.trim();
  if (!regState.worker.photo_data_url) { toast('Please capture a live photo before continuing', 'error'); return; }
  try {
    regState.worker = await window.Api.updateMe({
      vendorId: get('f_vendor'), locationId: get('f_location'), designation: get('f_designation'), doj: get('f_doj'),
    });
    renderRegStep(3);
  } catch (e) { toast(e.message, 'error'); }
}

function renderRegStep3() {
  const w = regState.worker;
  renderShell(`
    <div class="card">
      <h3>Aadhaar</h3>
      <div class="kyc-status ${w.aadhaar_qr_at?'ok':''}">${w.aadhaar_qr_at ? `✅ Card scanned — ${esc(w.aadhaar_masked || '')}` : '⏳ Card not scanned yet'}</div>
      ${!w.aadhaar_qr_at ? `<button class="btn secondary block" onclick="regScanAadhaar()"><span class="icon-inline">${icon('camera')}</span> Scan Aadhaar QR</button>` : ''}
      <div class="kyc-status ${w.aadhaar_verified?'ok':''}">${w.aadhaar_verified ? '✅ Aadhaar verified (OTP via DigiLocker)' : '⏳ Not yet verified'}</div>
      ${!w.aadhaar_verified ? `<button class="btn secondary block" onclick="startDigilocker()">Verify with DigiLocker (Aadhaar OTP)</button>` : ''}

      <h3 style="margin-top:18px">PAN</h3>
      <div class="kyc-status ${w.pan_verified?'ok':''}">${w.pan_verified ? '✅ PAN verified' : '⏳ Not yet verified'}</div>
      ${!w.pan_verified ? `
        ${w.pan_photo_data_url ? `<img src="${w.pan_photo_data_url}" class="selfie-preview" style="border-radius:8px;max-height:140px" />` : ''}
        ${regState.panRead ? `<div class="kyc-status">PAN read from photo: <b>${esc(regState.panRead.panNumber)}</b>${regState.panRead.nameOnCard ? ` · ${esc(regState.panRead.nameOnCard)}` : ''}</div>
          <button class="btn primary block" onclick="verifyPan(true)">Yes, verify this PAN</button>` : ''}
        <button class="btn secondary block" onclick="regPanPhoto()"><span class="icon-inline">${icon('camera')}</span> ${w.pan_photo_data_url ? 'Retake PAN photo' : 'Take photo of PAN card'}</button>
        ${regState.panManual ? `
          <input id="f_pan" class="input" maxlength="10" placeholder="ABCDE1234F" style="text-transform:uppercase" />
          <button class="btn secondary block" onclick="verifyPan(false)">Verify PAN</button>
        ` : `<button class="link-btn small" onclick="regState.panManual=true;renderRegStep(3)">Can't take a photo? Type the PAN instead</button>`}
      ` : ''}

      ${(!w.aadhaar_verified || !w.pan_verified) ? `
        <div class="gps-status warn" style="margin-top:16px">
          <div>${t('devSkipHint')}</div>
          <button class="btn warn block" style="margin-top:8px" onclick="skipKycDev()">${t('devSkipButton')}</button>
        </div>
      ` : ''}

      <label class="consent-row" style="margin-top:16px">
        <input type="checkbox" id="f_consent" />
        <span>${t('consent')}</span>
      </label>

      <div class="wizard-actions">
        <button class="btn secondary" onclick="renderRegStep(2)">${t('back')}</button>
        <button class="btn primary" ${(w.aadhaar_verified && w.pan_verified) ? '' : 'disabled'} onclick="regSubmit()">${t('submitRegistration')}</button>
      </div>
    </div>
  `);
}
async function skipKycDev() {
  try {
    const result = await window.Api.skipKycDev();
    regState.worker = result.worker;
    toast('KYC skipped (dev mode)', 'success');
    renderRegStep(3);
  } catch (e) { toast(e.message, 'error'); }
}
async function startDigilocker() {
  try {
    // No dedicated web callback endpoint exists for this pilot, so the worker
    // completes consent in the system browser then manually returns to the app and
    // taps "I've completed verification" to fetch the result using the request id
    // we already hold — see tsg-workforce-backend/README for the real flow this
    // simplifies.
    const result = await window.Api.digilockerInit('https://www.google.com/');
    regState.digilockerId = result.id;
    window.open(result.url, '_system');
    toast('Complete verification in the browser, then come back and tap "I\'ve completed verification"', 'info');
    renderRegStep3ContinueButton();
  } catch (e) { toast(e.message, 'error'); }
}
function renderRegStep3ContinueButton() {
  const container = document.querySelector('.content .card');
  if (!container) return;
  const btn = document.createElement('button');
  btn.className = 'btn primary block';
  btn.textContent = "I've completed verification";
  btn.onclick = checkDigilockerComplete;
  container.appendChild(btn);
}
async function checkDigilockerComplete() {
  if (!regState.digilockerId) { toast('Start DigiLocker verification first', 'error'); return; }
  try {
    const result = await window.Api.digilockerComplete(regState.digilockerId);
    regState.worker = result.worker;
    toast('Aadhaar verified', 'success');
    renderRegStep(3);
  } catch (e) { toast(e.message, 'error'); }
}
// R04: PAN by photo — the server reads the number (OCR) and the worker only confirms it.
async function regPanPhoto() {
  const photo = await window.TSGNative.takeDocumentPhoto();
  if (!photo.ok) { toast('Camera failed: ' + photo.error, 'error'); return; }
  toast('Reading PAN card…', 'info');
  try {
    regState.panRead = await window.Api.panPhoto(photo.dataUrl);
    regState.worker = await window.Api.getMe();
    renderRegStep(3);
  } catch (e) {
    regState.panRead = null;
    if (e.data && e.data.manualEntry) regState.panManual = true;
    toast(e.message, 'error');
    renderRegStep(3);
  }
}
async function verifyPan(fromPhoto) {
  let pan;
  if (!fromPhoto) {
    pan = document.getElementById('f_pan').value.trim().toUpperCase();
    if (!/^[A-Z]{5}\d{4}[A-Z]$/.test(pan)) { toast('Enter a valid PAN, e.g. ABCDE1234F', 'error'); return; }
  }
  try {
    const result = await window.Api.panVerify(pan); // no pan = verify the number read from the photo
    regState.worker = result.worker;
    toast('PAN verified', 'success');
    renderRegStep(3);
  } catch (e) { toast(e.message, 'error'); }
}
async function regSubmit() {
  if (!document.getElementById('f_consent').checked) { toast(t('consent'), 'error'); return; }
  try {
    await window.Api.submitMe();
    toast('Submitted for HR approval', 'success');
    location.hash = '#/w/pending'; render();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------- Worker: pending / home / attendance / menu ----------------

function renderPending() {
  if (!requireWorker()) return;
  withLoading(() => window.Api.getMe(), (w) => {
    if (w.status === 'approved') { location.hash = '#/w/home'; render(); return; }
    renderShell(`
      <div class="card center-card">
        <h3>${t('pendingTitle')}</h3>
        <p>${t('pendingBody')}</p>
        ${w.status === 'rejected' ? `<p class="badge badge-bad">Rejected</p>` : ''}
        ${w.status === 'sent_back' ? `<p class="badge badge-warn">Sent back: ${esc(w.send_back_reason||'')}</p><button class="btn secondary" onclick="location.hash='#/w/register';render()">Edit & resubmit</button>` : ''}
        <div class="worker-summary">
          <div><b>${esc(w.name)}</b></div>
        </div>
      </div>
    `);
  });
}

function renderWorkerHome() {
  if (!requireWorker()) return;
  withLoading(() => window.Api.getMe(), (w) => {
    if (w.status !== 'approved') { location.hash = '#/w/pending'; render(); return; }
    withLoading(() => window.Api.myPunches(), (punches) => {
      window._myWorker = w; window._myPunches = punches;
      const openIn = lastOpenPunchIn(punches);
      const today = todayStr(Date.now());
      const todayStatus = attendanceStatusForDay(punches, today);
      const completedToday = todayStatus.status !== 'absent' && todayStatus.outTime;

      let statusLine = '';
      if (completedToday) statusLine = `<p class="muted">${t('alreadyOutToday')}</p>`;
      else if (openIn) statusLine = `<p class="muted">${t('alreadyIn')} ${fmtTime(openIn.ts)}</p>`;
      else statusLine = `<p class="muted">${t('notPunched')}</p>`;

      renderShell(`
        <div class="card">
          <div class="profile-header">
            ${avatarHtml(w)}
            <div class="profile-text">
              <h3>${esc(w.name)}</h3>
              <div class="muted small">${esc(w.vendor && w.vendor.name)} · ${esc(w.location && w.location.name)} · ${esc(w.designation)}</div>
            </div>
          </div>
          ${statusLine}
          <div id="punchArea">
            <button class="btn ${openIn?'warn':'success'} block big" ${completedToday?'disabled':''} onclick="doPunch()">
              ${openIn ? t('punchOut') : t('punchIn')}
            </button>
          </div>
          <p class="muted small">Assigned site: ${esc(w.location?w.location.name:'')} (geofence ${w.location?w.location.radius:''} m)</p>
          <button class="btn secondary block" onclick="checkMyLocation()"><span class="icon-inline">${icon('pin')}</span> ${t('checkLocation')}</button>
          <div id="gpsStatus"></div>
          <div id="gpsMap" class="map-box" style="display:none"></div>
        </div>
      `);
    }, t('checkingLocation'));
  });
}

async function checkMyLocation() {
  const w = window._myWorker;
  const loc = w && w.location;
  const statusEl = document.getElementById('gpsStatus');
  const mapEl = document.getElementById('gpsMap');
  statusEl.className = 'gps-status loading';
  statusEl.innerHTML = spinnerRow(t('gpsChecking'));
  mapEl.style.display = 'none';

  const pos = await window.TSGNative.getPosition();
  if (!pos.ok) { statusEl.className = 'gps-status bad'; statusEl.innerHTML = '❌ ' + esc(pos.error); return; }
  const accLimit = (loc && loc.accuracy_limit) || GPS_ACCURACY_LIMIT_M;
  const distance = loc ? Math.round(haversineMeters(pos.lat, pos.lng, loc.lat, loc.lng)) : null;
  const lowAcc = pos.accuracy && pos.accuracy > accLimit;
  const outside = loc && distance !== null && distance > loc.radius;

  let cls = 'ok', headline = '✅ ' + t('gpsInsideSite');
  if (lowAcc) { cls = 'warn'; headline = '⚠️ ' + t('gpsLowAccuracy'); }
  else if (outside) { cls = 'bad'; headline = '❌ ' + t('gpsOutsideSite'); }

  statusEl.className = 'gps-status ' + cls;
  statusEl.innerHTML = `
    <div>${headline}</div>
    <div class="gps-row"><span>${t('accuracyLabel')}</span><span>${Math.round(pos.accuracy||0)} m (limit ${accLimit} m)</span></div>
    ${loc ? `<div class="gps-row"><span>${t('distanceLabel')}</span><span>${distance} m (geofence ${loc.radius} m)</span></div>` : ''}
  `;

  if (loc && window.L) {
    mapEl.style.display = 'block'; mapEl.innerHTML = '';
    const map = L.map(mapEl, { zoomControl: false, attributionControl: false }).setView([loc.lat, loc.lng], 17);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
    L.circle([loc.lat, loc.lng], { radius: loc.radius, color: '#1e40af', fillOpacity: 0.1 }).addTo(map);
    L.marker([loc.lat, loc.lng]).addTo(map).bindPopup(loc.name);
    L.circleMarker([pos.lat, pos.lng], { radius: 8, color: outside ? '#b91c1c' : '#16a34a', fillOpacity: 0.9 }).addTo(map).bindPopup('You');
    map.fitBounds(L.latLngBounds([[loc.lat, loc.lng], [pos.lat, pos.lng]]).pad(0.3));
    setTimeout(() => map.invalidateSize(), 100);
  }
}

// ---- Hands-free punch selfie: live camera preview (native, behind the WebView) with
// a circular guide overlay. Every ~1.2s the current frame is checked by Gemini for "is
// a face framed here" (geminiClient.detectFace, server-side) — no shutter tap needed.
// Once detected, a full-quality frame is captured automatically and used as the punch
// selfie, which then goes through the actual identity check (compareFaces) as part of
// the punch itself. This detection step only answers "is a face here", never "whose".
function createScanOverlay() {
  const el = document.createElement('div');
  el.className = 'scan-overlay';
  el.innerHTML = `
    <div class="scan-guide-ring" id="scanRing"></div>
    <div class="scan-status" id="scanStatus">${t('scanHint')}</div>
    <button class="btn secondary scan-cancel" id="scanCancelBtn">${t('cancel')}</button>
  `;
  document.body.appendChild(el);
  return el;
}

function scanFaceForPunch() {
  return new Promise((resolve) => {
    (async () => {
      const startResult = await window.TSGNative.startFacePreview();
      if (!startResult.ok) { resolve({ ok: false, error: startResult.error }); return; }

      document.documentElement.style.background = 'transparent';
      document.body.classList.add('scanning-active');
      const overlay = createScanOverlay();
      // start() resolving doesn't guarantee the native camera session is actually
      // ready to serve capture calls yet — confirmed on-device the first sample right
      // after start() can fail with "Camera is not running". A short settle delay
      // avoids that instead of just burning the first poll attempt on it every time.
      await new Promise((r) => setTimeout(r, 500));
      const ringEl = overlay.querySelector('#scanRing');
      const statusEl = overlay.querySelector('#scanStatus');
      const cancelBtn = overlay.querySelector('#scanCancelBtn');

      let stopped = false;
      let attempts = 0;
      const MAX_ATTEMPTS = 20; // each attempt is faster now (smaller image, less dead time), so more fit in roughly the same wall-clock budget

      async function cleanup() {
        stopped = true;
        await window.TSGNative.stopFacePreview();
        document.documentElement.style.background = '';
        document.body.classList.remove('scanning-active');
        overlay.remove();
      }

      cancelBtn.onclick = async () => { await cleanup(); resolve({ ok: false, cancelled: true }); };

      async function loop() {
        if (stopped) return;
        attempts++;
        if (attempts > MAX_ATTEMPTS) { await cleanup(); resolve({ ok: false, error: t('scanTimeout') }); return; }

        const sample = await window.TSGNative.grabPreviewSample();
        if (stopped) return;
        if (!sample.ok) { statusEl.textContent = sample.error; setTimeout(loop, 800); return; }

        try {
          const detectResult = await window.Api.detectFace(sample.dataUrl);
          if (stopped) return;
          if (detectResult.faceDetected) {
            ringEl.classList.add('detected');
            statusEl.textContent = t('scanLocked');
            const photo = await window.TSGNative.capturePreviewPhoto();
            await cleanup();
            if (!photo.ok) { resolve({ ok: false, error: photo.error }); return; }
            resolve({ ok: true, dataUrl: photo.dataUrl });
            return;
          }
          statusEl.textContent = detectResult.reason || t('scanHint');
        } catch (e) {
          statusEl.textContent = e.message || t('scanHint');
        }
        // The round trip itself (upload + Gemini inference) already paces each attempt —
        // this just stops back-to-back hammering if a response ever comes back instantly.
        setTimeout(loop, 300);
      }
      loop();
    })();
  });
}

async function doPunch() {
  const w = window._myWorker;
  const openIn = lastOpenPunchIn(window._myPunches || []);
  const type = openIn ? 'out' : 'in';

  const selfie = await scanFaceForPunch();
  if (!selfie.ok) {
    if (!selfie.cancelled) toast(selfie.error, 'error');
    return;
  }

  const area = document.getElementById('punchArea');
  area.innerHTML = spinnerRow(t('checkingLocation'));
  const pos = await window.TSGNative.getPosition();
  if (!pos.ok) { toast(t('punchBlocked') + ': ' + pos.error, 'error'); renderWorkerHome(); return; }

  try {
    const result = await window.Api.punch({ type, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, selfieDataUrl: selfie.dataUrl });
    toast(t('punchAccepted') + (type === 'in' ? ' — ' + t('punchIn') : ' — ' + t('punchOut')), 'success');
    renderWorkerHome();
  } catch (e) {
    const d = e.data || {};
    const detail = d.distanceM != null ? ` (${d.distanceM}m away, accuracy ${Math.round(d.accuracy||0)}m)` : '';
    toast(t('punchBlocked') + ': ' + e.message + detail, 'error');
    renderWorkerHome();
  }
}

function renderWorkerAttendance() {
  if (!requireWorker()) return;
  loadWorkerAttendance();
}
async function loadWorkerAttendance() {
  renderShell(`<div class="card">${spinnerRow('Loading…')}</div>`);
  try {
    const [punches, myRegs] = await Promise.all([window.Api.myPunches(), window.Api.myRegularisations()]);
    const days = [];
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    for (let d = new Date(start); d <= now; d.setDate(d.getDate() + 1)) {
      const dayStr = d.toISOString().slice(0, 10);
      const st = attendanceStatusForDay(punches, dayStr);
      const reg = myRegs.find(r => r.date === dayStr);
      days.push({ dayStr, ...st, regularised: reg && reg.status === 'approved', regPending: reg && reg.status === 'pending' });
    }
    days.reverse();
    renderShell(`
      <div class="card">
        <h3>${t('attendance')}</h3>
        <p class="muted small">${t('missedPunchHint')}</p>
        <table class="tbl">
          <thead><tr><th>${t('date')}</th><th>In</th><th>Out</th><th>Hrs</th><th>${t('status')}</th><th></th></tr></thead>
          <tbody>
            ${days.map(d => `<tr>
              <td>${d.dayStr}</td><td>${fmtTime(d.inTime)}</td><td>${fmtTime(d.outTime)}</td><td>${d.hours||'-'}</td>
              <td>${d.regularised && d.status!=='present' ? statusBadge('present') + ' <span class="badge badge-neutral">Regularised</span>' : statusBadge(d.status)}</td>
              <td>${(d.status==='absent' || d.status==='missed_punch_out') && !d.regularised ?
                (d.regPending ? `<span class="muted small">Pending</span>` : `<button class="btn warn small" onclick="callSiteHr()">${t('callSiteHr')}</button>`)
                : ''}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    `);
  } catch (e) {
    renderShell(`<div class="card">${errorState(e.message)}</div>`);
  }
}
function callSiteHr() {
  const w = window._myWorker;
  const phone = (w && w.vendor && w.vendor.phone) || '18001234567';
  toast(t('missedPunchBody'), 'info');
  location.href = 'tel:' + phone;
}

function renderWorkerMenu() {
  if (!requireWorker()) return;
  withLoading(() => window.Api.getMe(), (w) => {
    renderShell(`
      <div class="card">
        <div class="profile-header">
          ${avatarHtml(w)}
          <div class="profile-text">
            <h3>${esc(w.name)}</h3>
            <div class="muted small">${esc(w.vendor && w.vendor.name)} · ${esc(w.location && w.location.name)}</div>
          </div>
        </div>
      </div>
      <div class="card">
        <details open><summary class="link-btn">${t('myDetails')}</summary>
          <table class="tbl">
            <tr><td class="muted">${t('mobileNumber')}</td><td>${esc(w.mobile)}</td></tr>
            <tr><td class="muted">${t('fatherName')}</td><td>${esc(w.father_name||'-')}</td></tr>
            <tr><td class="muted">${t('dob')}</td><td>${esc(w.dob||'-')}</td></tr>
            <tr><td class="muted">${t('designation')}</td><td>${esc(w.designation||'-')}</td></tr>
            <tr><td class="muted">${t('doj')}</td><td>${esc(w.doj||'-')}</td></tr>
            <tr><td class="muted">Aadhaar</td><td>${w.aadhaar_masked ? esc(w.aadhaar_masked) : '—'}</td></tr>
            <tr><td class="muted">PAN</td><td>${w.pan_number ? '••••••' + esc(w.pan_number.slice(-4)) : '—'}</td></tr>
          </table>
          <p class="muted small">${t('detailsViewOnly')}</p>
        </details>
        <div style="margin-top:14px">
          <label>${t('language')}</label><br/>
          <div class="lang-toggle">
            <button class="lang-btn on-light ${currentLang==='en'?'active':''}" onclick="switchLang('en')">EN</button>
            <button class="lang-btn on-light ${currentLang==='hi'?'active':''}" onclick="switchLang('hi')">HI</button>
          </div>
        </div>
        <button class="btn secondary block" style="margin-top:14px" onclick="callSiteHr()">${t('callSiteHr')}</button>
        <button class="btn danger block" style="margin-top:8px" onclick="location.hash='#/w/logout-confirm';render()">${t('logout')}</button>
      </div>
    `);
  });
}

function renderLogoutConfirm() {
  if (!requireWorker()) return;
  renderShell(`
    <div class="card center-card">
      <h3>${t('logoutConfirmTitle')}</h3>
      <p class="muted">${t('logoutConfirmBody')}</p>
      <button class="btn danger block" onclick="clearSessionData();location.hash='#/';render()">${t('yesLogout')}</button>
      <button class="btn secondary block" onclick="history.back()">${t('noStay')}</button>
    </div>
  `);
}

// ---------------- HR: login ----------------

function startHrLogin() {
  loginState = { step: 'email' };
  renderShell(`
    <div class="card center-card">
      <h3>${t('hrUser')}</h3>
      <input id="hrEmail" class="input" placeholder="name@thesachdevgroup.com" />
      <input id="hrName" class="input" placeholder="Your name" />
      <button class="btn primary block" onclick="hrRequestOtp()">${t('sendOtp')}</button>
    </div>
  `);
}
async function hrRequestOtp() {
  const email = document.getElementById('hrEmail').value.trim();
  const name = document.getElementById('hrName').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Enter a valid email', 'error'); return; }
  try {
    const result = await window.Api.hrOtpRequest(email);
    loginState = { step: 'otp', email, name };
    renderShell(`
      <div class="card center-card">
        <h3>${t('enterOtp')}</h3>
        <p class="muted small">${result.devOtp ? `${t('otpHint')}: ${result.devOtp}` : `OTP sent to ${esc(email)}`}</p>
        <input id="hrOtp" class="input" maxlength="6" inputmode="numeric" />
        ${result.devOtp ? `
          <label>Role (dev server only — used if this email has no account yet)</label>
          <select id="hrDevRole" class="input">${Object.entries(ROLE_LABELS).map(([id, label]) => `<option value="${id}" ${id === 'central_hr' ? 'selected' : ''}>${label}</option>`).join('')}</select>
        ` : ''}
        <button class="btn primary block" onclick="hrVerifyOtp()">${t('verify')}</button>
      </div>
    `);
  } catch (e) { toast(e.message, 'error'); }
}
async function hrVerifyOtp() {
  const otp = document.getElementById('hrOtp').value.trim();
  const devRoleEl = document.getElementById('hrDevRole');
  try {
    const result = await window.Api.hrOtpVerify(loginState.email, otp, loginState.name, devRoleEl ? devRoleEl.value : undefined);
    setSessionData({ token: result.token, role: result.hrUser.role, permissions: result.permissions, email: result.hrUser.email, name: result.hrUser.name });
    loginState = {}; // otherwise a stale step:'otp' would hijack the back button deep in the app later
    location.hash = adminHomeHash(); render();
  } catch (e) { toast(e.message, 'error'); }
}

// Admin screens: must be signed in as an admin, and the role must be allowed to open
// the current screen — otherwise land on the role's own home screen instead.
function requireHr() {
  const s = getSession();
  if (!isAdminSession(s)) { location.hash = '#/'; render(); return null; }
  if (!canOpenAdminRoute(location.hash)) { location.hash = adminHomeHash(); render(); return null; }
  return s;
}

// Pick up role/permission changes a System Admin made since this session signed in
// (the server already enforces them; this just keeps the visible screens in sync).
async function refreshAdminPermissions() {
  const s = getSession();
  if (!isAdminSession(s)) return;
  try {
    const me = await window.Api.getAdminMe();
    if (me.hrUser.role !== s.role || JSON.stringify(me.permissions) !== JSON.stringify(s.permissions)) {
      setSessionData({ ...s, role: me.hrUser.role, permissions: me.permissions });
      render();
    }
  } catch (e) { /* offline or signed out — the next API call surfaces it */ }
}

// Fetches only what the signed-in role is allowed to read; anything else comes back
// empty instead of failing the whole screen with a 403.
function fetchIfAllowed(perm, fetcher) { return hasPerm(perm) ? fetcher() : Promise.resolve([]); }

// ---------------- HR: dashboard ----------------

async function loadHrContext() {
  const [workers, locations, vendors, punches, regularisations] = await Promise.all([
    fetchIfAllowed('workers.read', () => window.Api.listWorkers()), window.Api.listLocations(), window.Api.listVendors(),
    fetchIfAllowed('punches.read', () => window.Api.listPunches()), fetchIfAllowed('regularisations.read', () => window.Api.listRegularisations()),
  ]);
  return { workers, locations, vendors, punches, regularisations };
}

function renderHrDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(loadHrContext, (ctx) => {
    const today = todayStr(Date.now());
    const activeWorkers = ctx.workers.filter(w => w.status === 'approved');
    const punchedInToday = new Set(ctx.punches.filter(p => p.type === 'in' && p.result === 'ok' && todayStr(p.ts) === today).map(p => p.worker_id));
    const notPunched = activeWorkers.filter(w => !punchedInToday.has(w.id)).length;
    const blocked7d = ctx.punches.filter(p => p.result === 'blocked' && p.ts > Date.now() - 7 * 86400000).length;
    const pendingApprovals = ctx.workers.filter(w => w.status === 'pending').length;
    const flags = computeTimeGuardFlags(ctx);
    const insights = computeSmartInsights({ ...ctx, flags });

    renderShell(`
      <div class="card insight-card">
        <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('sparkle')}</span>${t('smartInsights')}</h3>
        <ul class="insight-list">${insights.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
        ${insights.byLocation.length ? `<p class="muted small" style="margin-top:12px">${t('punchesByLocationToday')}</p>${barChart(insights.byLocation)}` : ''}
        <a href="#/hr/timeguard" class="link-btn small" style="display:inline-block;margin-top:8px">${t('viewTimeGuard')} (${flags.length}) →</a>
        <p class="muted small" style="margin-top:10px">${t('onDeviceNote')}</p>
      </div>
      <div class="stat-grid">
        <div class="stat-card"><div class="stat-num">${activeWorkers.length}</div><div class="stat-label">${t('activeManpower')}</div></div>
        <div class="stat-card"><div class="stat-num">${punchedInToday.size}</div><div class="stat-label">${t('punchedInToday')}</div></div>
        <div class="stat-card"><div class="stat-num">${notPunched}</div><div class="stat-label">${t('notPunched')}</div></div>
        <div class="stat-card warn"><div class="stat-num">${blocked7d}</div><div class="stat-label">${t('blockedAttempts')}</div></div>
        <div class="stat-card ${hasPerm('workers.approve') ? 'action' : ''}" ${hasPerm('workers.approve') ? `onclick="location.hash='#/hr/approvals';render()"` : ''}>
          <div class="stat-num">${pendingApprovals}</div><div class="stat-label">${t('pendingApprovals')}</div>
        </div>
      </div>
      <div class="card">
        <h3>By location</h3>
        <table class="tbl">
          <thead><tr><th>${t('location')}</th><th>${t('activeManpower')}</th><th>${t('punchedInToday')}</th></tr></thead>
          <tbody>
            ${ctx.locations.map(l => {
              const ws = activeWorkers.filter(w => w.location_id === l.id);
              const inCount = ws.filter(w => punchedInToday.has(w.id)).length;
              return `<tr><td>${esc(l.name)}</td><td>${ws.length}</td><td>${inCount}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `);
  });
}

function renderHrApprovals() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.listWorkers(), window.Api.listReportingManagers()]), ([all, managers]) => {
    window._knownManagers = managers;
    const pending = all.filter(w => w.status === 'pending' || w.status === 'sent_back');
    renderShell(`
      <div class="card">
        <h3>${t('pendingApprovals')}</h3>
        <datalist id="mgrEmails">${managers.map(m => `<option value="${esc(m.email)}">${esc(m.name)}</option>`).join('')}</datalist>
        ${pending.length === 0 ? emptyState(t('noData'), 'check') : pending.map(w => `
          <div class="approval-row" id="approvalRow_${w.id}">
            <a href="javascript:void(0)" onclick="viewWorker('${w.id}')">${w.photo_data_url ? `<img src="${w.photo_data_url}" class="thumb" />` : `<div class="thumb placeholder"></div>`}</a>
            <div class="approval-info">
              <b><a href="javascript:void(0)" onclick="viewWorker('${w.id}')" style="color:inherit">${esc(w.name)}</a></b> ${statusBadge(w.status)}<br/>
              <span class="muted small">${esc(w.mobile)} · ${esc(w.designation||'')}</span><br/>
              <span class="muted small">Aadhaar: ${w.aadhaar_verified ? '✅' : '⏳'} · PAN: ${w.pan_verified ? '✅' : '⏳'}</span>
            </div>
            <div class="approval-actions">
              <button class="btn primary small" onclick="hrApprove('${w.id}')">${t('approve')}</button>
              <button class="btn secondary small" onclick="hrSendBack('${w.id}')">${t('sendBack')}</button>
              <button class="btn danger small" onclick="hrReject('${w.id}')">${t('reject')}</button>
            </div>
          </div>
        `).join('')}
      </div>
    `);
  });
}
// R08: approval needs the worker's reporting manager, so "Approve" opens a small form
// under the row instead of approving straight away.
function hrApprove(id) {
  const row = document.getElementById('approvalRow_' + id); if (!row) return;
  if (document.getElementById('mgrForm_' + id)) return;
  const form = document.createElement('div');
  form.id = 'mgrForm_' + id;
  form.className = 'worker-summary';
  form.style.width = '100%';
  form.innerHTML = reportingManagerFields(id, {}) + `
    <div class="wizard-actions">
      <button class="btn secondary small" onclick="document.getElementById('mgrForm_${id}').remove()">${t('cancel')}</button>
      <button class="btn primary small" onclick="hrConfirmApprove('${id}')">${t('approve')}</button>
    </div>`;
  row.after(form);
}
function reportingManagerFields(id, current) {
  return `
    <label>Reporting manager email</label>
    <input id="mgrEmail_${id}" class="input" list="mgrEmails" value="${esc(current.email || '')}" placeholder="manager@thesachdevgroup.com" oninput="fillManagerName('${id}')" />
    <label>Reporting manager name</label>
    <input id="mgrName_${id}" class="input" value="${esc(current.name || '')}" />`;
}
// Picking a known manager's email from the list fills their name in.
function fillManagerName(id) {
  const email = document.getElementById('mgrEmail_' + id).value.trim().toLowerCase();
  const known = (window._knownManagers || []).find(m => m.email === email);
  const nameEl = document.getElementById('mgrName_' + id);
  if (known && !nameEl.value) nameEl.value = known.name;
}
function readManagerFields(id) {
  return { reportingManagerEmail: document.getElementById('mgrEmail_' + id).value.trim(), reportingManagerName: document.getElementById('mgrName_' + id).value.trim() };
}
async function hrConfirmApprove(id) {
  try { await window.Api.approveWorker(id, readManagerFields(id)); toast('Approved', 'success'); renderHrApprovals(); }
  catch (e) { toast(e.message, 'error'); }
}
async function hrSendBack(id) {
  const reason = prompt('Reason for sending back?'); if (!reason) return;
  try { await window.Api.sendBackWorker(id, reason); toast('Sent back', 'success'); renderHrApprovals(); }
  catch (e) { toast(e.message, 'error'); }
}
async function hrReject(id) {
  if (!confirm('Reject this registration?')) return;
  try { await window.Api.rejectWorker(id); toast('Rejected', 'success'); renderHrApprovals(); }
  catch (e) { toast(e.message, 'error'); }
}

function renderHrAttendance() {
  const s = requireHr(); if (!s) return;
  const dateSel = window._hrAttDate || todayStr(Date.now());
  withLoading(
    () => Promise.all([window.Api.listWorkers('approved'), window.Api.listPunches({ date: dateSel }), fetchIfAllowed('regularisations.read', () => window.Api.listRegularisations())]),
    ([workers, punches, regs]) => {
      const rows = workers.map(w => {
        const wPunches = punches.filter(p => p.worker_id === w.id);
        const st = attendanceStatusForDay(wPunches, dateSel);
        const reg = regs.find(r => r.worker_id === w.id && r.date === dateSel);
        return { w, st, regularised: reg && reg.status === 'approved', regPending: reg && reg.status === 'pending' };
      });
      renderShell(`
        <div class="card">
          <h3>${t('hrAttendance')}</h3>
          <input type="date" class="input" value="${dateSel}" max="${todayStr(Date.now())}" onchange="window._hrAttDate=this.value;renderHrAttendance()" />
          <table class="tbl">
            <thead><tr><th>${t('worker')}</th><th>In</th><th>Out</th><th>${t('status')}</th><th></th></tr></thead>
            <tbody>
              ${rows.map(r => `<tr>
                <td><a href="javascript:void(0)" onclick="viewWorker('${r.w.id}')">${esc(r.w.name)}</a></td>
                <td>${fmtTime(r.st.inTime)}</td><td>${fmtTime(r.st.outTime)}</td>
                <td>${r.regularised && r.st.status!=='present' ? statusBadge('present') + ' <span class="badge badge-neutral">Regularised</span>' : statusBadge(r.st.status)}</td>
                <td>${(r.st.status==='absent' || r.st.status==='missed_punch_out') && !r.regularised ?
                  (r.regPending ? `<span class="muted small">Pending</span>` : hasPerm('regularisations.raise') ? `<button class="btn secondary small" onclick="hrRaiseRegularisation('${r.w.id}','${dateSel}')">${t('raiseRegularisation')}</button>` : '')
                  : ''}</td>
              </tr>`).join('')}
            </tbody>
          </table>
          <p class="muted small">${t('raiseHint')}</p>
        </div>
      `);
    }
  );
}
async function hrSaveManager(id) {
  try { await window.Api.setReportingManager(id, readManagerFields(id)); toast('Reporting manager updated', 'success'); renderHrWorkerDetail(); }
  catch (e) { toast(e.message, 'error'); }
}
function viewWorker(id) {
  window._viewWorkerId = id;
  location.hash = '#/hr/worker';
  render();
}

function renderHrWorkerDetail() {
  const s = requireHr(); if (!s) return;
  const id = window._viewWorkerId;
  if (!id) { location.hash = '#/hr/approvals'; render(); return; }
  withLoading(
    () => Promise.all([window.Api.getWorkerById(id), window.Api.listPunches({ workerId: id })]),
    ([w, punches]) => {
      const sorted = [...punches].sort((a, b) => b.ts - a.ts).slice(0, 20);
      renderShell(`
        <div class="card">
          <div class="profile-header">
            ${avatarHtml(w)}
            <div class="profile-text">
              <h3>${esc(w.name || w.mobile)}</h3>
              <div class="muted small">${esc(w.mobile)} · ${esc(w.vendor && w.vendor.name || '')} · ${esc(w.location && w.location.name || '')}</div>
            </div>
          </div>
          <div style="margin-top:10px">${statusBadge(w.status)} ${w.aadhaar_verified ? '<span class="badge badge-ok">Aadhaar ✓</span>' : '<span class="badge badge-warn">Aadhaar pending</span>'} ${w.pan_verified ? '<span class="badge badge-ok">PAN ✓</span>' : '<span class="badge badge-warn">PAN pending</span>'}</div>
          <table class="tbl" style="margin-top:12px">
            <tr><td class="muted">${t('designation')}</td><td>${esc(w.designation||'-')}</td></tr>
            <tr><td class="muted">${t('doj')}</td><td>${esc(w.doj||'-')}</td></tr>
            <tr><td class="muted">Aadhaar</td><td>${w.aadhaar_masked ? esc(w.aadhaar_masked) : '—'}</td></tr>
            <tr><td class="muted">PAN</td><td>${w.pan_number ? '••••••' + esc(w.pan_number.slice(-4)) : '—'}</td></tr>
            <tr><td class="muted">Reporting manager</td><td>${w.reporting_manager_email ? `${esc(w.reporting_manager_name || '')}<br/><span class="muted small">${esc(w.reporting_manager_email)}</span>` : '—'}</td></tr>
          </table>
          ${hasPerm('workers.manage') ? `
            <details><summary class="link-btn">Change reporting manager</summary>
              ${reportingManagerFields(w.id, { name: w.reporting_manager_name, email: w.reporting_manager_email })}
              <button class="btn primary small" onclick="hrSaveManager('${w.id}')">${t('save')}</button>
            </details>` : ''}
        </div>
        <div class="card">
          <h3>${t('comparePhotos')}</h3>
          <p class="muted small">${t('comparePhotosHint')}</p>
          ${sorted.length === 0 ? emptyState(t('noData'), 'calendar') : sorted.map(p => `
            <div class="compare-row">
              <div class="compare-pair">
                <div class="compare-item">
                  ${w.photo_data_url ? `<img src="${w.photo_data_url}" />` : `<div class="compare-placeholder">${icon('user')}</div>`}
                  <span>${t('registrationPhoto')}</span>
                </div>
                <div class="compare-item">
                  ${p.selfie_data_url ? `<img src="${p.selfie_data_url}" />` : `<div class="compare-placeholder">${icon('camera')}</div>`}
                  <span>${t('punchSelfie')}</span>
                </div>
              </div>
              <div class="compare-meta">
                <span class="badge ${p.type==='in'?'badge-ok':'badge-warn'}">${p.type.toUpperCase()}</span>
                ${p.result === 'blocked' ? `<span class="badge badge-bad">${esc(p.reason)}</span>` : ''}
                <span class="muted small">${new Date(p.ts).toLocaleString()}</span>
                ${p.distance_m != null ? `<span class="muted small"> · ${p.distance_m}m</span>` : ''}
              </div>
              ${p.face_match_note ? `<div class="muted small" style="text-align:center;margin-top:4px">${t('aiNote')}: ${esc(p.face_match_note)}</div>` : ''}
            </div>
          `).join('')}
        </div>
      `);
    }
  );
}

async function hrRaiseRegularisation(workerId, dateStr) {
  const reason = prompt(t('regularisationReason') + '?'); if (!reason) return;
  try { await window.Api.raiseRegularisation(workerId, dateStr, reason); toast('Raised', 'success'); renderHrAttendance(); }
  catch (e) { toast(e.message, 'error'); }
}

function renderHrRegularisations() {
  const s = requireHr(); if (!s) return;
  withLoading(
    () => Promise.all([window.Api.listRegularisations(), window.Api.listWorkers()]),
    ([list, workers]) => {
      const nameById = Object.fromEntries(workers.map(w => [w.id, w.name]));
      const sorted = [...list].sort((a, b) => b.created_at - a.created_at);
      renderShell(`
        <div class="card">
          <h3>${t('hrRegularisations')}</h3>
          ${sorted.length === 0 ? emptyState(t('noData'), 'doc') : `
          <table class="tbl">
            <thead><tr><th>${t('worker')}</th><th>${t('date')}</th><th>${t('reason')}</th><th>Maker</th><th>${t('status')}</th><th></th></tr></thead>
            <tbody>
              ${sorted.map(r => `<tr>
                <td><a href="javascript:void(0)" onclick="viewWorker('${r.worker_id}')">${esc(nameById[r.worker_id]||r.worker_id)}</a></td><td>${r.date}</td><td>${esc(r.reason)}</td><td>${esc(r.maker)}</td>
                <td>${statusBadge(r.status)}</td>
                <td>${r.status==='pending' ? (hasPerm('regularisations.decide') ? `
                  <button class="btn primary small" onclick="hrDecideReg('${r.id}','approved')">${t('approve')}</button>
                  <button class="btn danger small" onclick="hrDecideReg('${r.id}','rejected')">${t('reject')}</button>
                ` : '') : (r.checker ? `<span class="muted small">by ${esc(r.checker)}</span>` : '')}</td>
              </tr>`).join('')}
            </tbody>
          </table>`}
        </div>
      `);
    }
  );
}
async function hrDecideReg(id, decision) {
  try { await window.Api.decideRegularisation(id, decision); toast('Done', 'success'); renderHrRegularisations(); }
  catch (e) { toast(e.message, 'error'); }
}

function renderHrExceptions() {
  const s = requireHr(); if (!s) return;
  withLoading(
    () => window.Api.listPunches({ result: 'blocked' }),
    (blocked) => {
      // worker_name comes joined in from the server, so Security (no worker-list
      // access) still sees whose attempt it was; only roles that can open a worker
      // record get the name as a link.
      const canView = hasPerm('workers.read');
      const sorted = [...blocked].sort((a, b) => b.ts - a.ts);
      renderShell(`
        <div class="card">
          <h3>${t('hrExceptions')}</h3>
          ${sorted.length === 0 ? emptyState(t('noData'), 'warn') : sorted.map(p => `
            <div class="approval-row">
              ${p.selfie_data_url ? `<img src="${p.selfie_data_url}" class="thumb" />` : `<div class="thumb placeholder"></div>`}
              <div class="approval-info">
                <b>${canView ? `<a href="javascript:void(0)" onclick="viewWorker('${p.worker_id}')" style="color:inherit">${esc(p.worker_name||p.worker_id)}</a>` : esc(p.worker_name||p.worker_id)}</b> — ${p.type.toUpperCase()} <span class="badge badge-bad">${esc(p.reason)}</span><br/>
                <span class="muted small">${new Date(p.ts).toLocaleString()} · accuracy ${p.accuracy||'?'}m · distance ${p.distance_m!=null?p.distance_m+'m':'?'}</span>
                ${p.face_match_note ? `<br/><span class="muted small">${t('aiNote')}: ${esc(p.face_match_note)}</span>` : ''}
              </div>
            </div>
          `).join('')}
        </div>
      `);
    }
  );
}

function renderHrTimeGuard() {
  const s = requireHr(); if (!s) return;
  withLoading(loadHrContext, (ctx) => {
    const flags = computeTimeGuardFlags(ctx);
    const nameById = Object.fromEntries(ctx.workers.map(w => [w.id, w.name]));
    const flagLabels = {
      unusual_time: 'Unusual clock-in time', geofence_pattern: 'Repeated geofence violations',
      borderline_location: 'Borderline GPS accuracy', overtime_risk: 'Long shift / overtime risk',
      high_regularisation: 'High regularisation rate', shared_device: 'Possible shared device',
    };
    renderShell(`
      <div class="card">
        <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('shield')}</span>${t('timeGuard')}</h3>
        <p class="muted small">${t('timeGuardHint')}</p>
        ${flags.length === 0 ? emptyState(t('noFlagsFound'), 'shield') : flags.map(f => `
          <div class="approval-row">
            <span class="thumb placeholder" style="background:${f.severity === 'bad' ? 'var(--bad-tint)' : 'var(--warn-tint)'}; color:${f.severity === 'bad' ? 'var(--bad)' : 'var(--warn)'}"><span class="icon-inline" style="width:22px;height:22px">${icon('warn')}</span></span>
            <div class="approval-info">
              <b><a href="javascript:void(0)" onclick="viewWorker('${f.workerId}')" style="color:inherit">${esc(nameById[f.workerId]||f.workerId)}</a></b> <span class="badge ${f.severity === 'bad' ? 'badge-bad' : 'badge-warn'}">${f.severity === 'bad' ? 'Critical' : 'Review'}</span> <span class="badge badge-neutral">${flagLabels[f.type] || f.type}</span><br/>
              <span class="small">${esc(f.message)}</span><br/>
              <span class="muted small">${new Date(f.ts).toLocaleString()}</span>
            </div>
          </div>
        `).join('')}
      </div>
    `);
  });
}

function renderHrMore() {
  const s = requireHr(); if (!s) return;
  withLoading(loadHrContext, (ctx) => {
    const pendingReg = ctx.regularisations.filter(r => r.status === 'pending').length;
    const flagCount = computeTimeGuardFlags(ctx).length;
    const counts = { '#/hr/timeguard': flagCount, '#/hr/regularisations': pendingReg };
    const tiles = adminMoreScreens().map(x => [x.hash, x.icon, x.label(), counts[x.hash] || null]);
    renderShell(`
      <div class="more-grid">
        ${tiles.map(([href, iconName, label, count]) => `
          <a href="${href}" class="more-tile">
            <span class="more-tile-icon">${icon(iconName)}</span>
            <span class="more-tile-label">${label}</span>
            ${count ? `<span class="more-tile-count">${count}</span>` : ''}
          </a>
        `).join('')}
      </div>
    `);
  });
}

function renderHrMasters() {
  const s = requireHr(); if (!s) return;
  withLoading(
    () => Promise.all([window.Api.listVendors(), window.Api.listLocations()]),
    ([vendors, locations]) => {
      window._hrVendors = vendors; window._hrLocations = locations;
      renderShell(`
        <div class="card">
          <h3>Vendors</h3>
          <table class="tbl">
            <thead><tr><th>${t('name')}</th><th>GSTIN</th><th>PAN</th><th>Contact</th></tr></thead>
            <tbody>${vendors.map(v => `<tr><td>${esc(v.name)}</td><td>${esc(v.gstin||'')}</td><td>${esc(v.pan||'')}</td><td>${esc(v.contact_person||'')}</td></tr>`).join('')}</tbody>
          </table>
          <details><summary class="link-btn">${t('addVendor')}</summary>
            <label>${t('name')}</label><input id="nv_name" class="input" />
            <label>GSTIN</label><input id="nv_gstin" class="input" />
            <label>PAN</label><input id="nv_pan" class="input" />
            <label>Contact person / phone</label><input id="nv_contact" class="input" />
            <button class="btn primary" onclick="addVendor()">${t('save')}</button>
          </details>
        </div>
        <div class="card">
          <h3>Locations</h3>
          <table class="tbl">
            <thead><tr><th>${t('name')}</th><th>Lat/Lng</th><th>${t('radius')}</th><th></th></tr></thead>
            <tbody>${locations.map(l => `<tr>
                <td>${esc(l.name)}</td><td>${l.lat.toFixed(5)}, ${l.lng.toFixed(5)}</td><td>${l.radius} m</td>
                <td>
                  <button class="btn secondary small" onclick="fixLocationToMyGps('${l.id}')">Set to my GPS now</button>
                  <button class="btn secondary small" onclick="startEditLocation('${l.id}')">Edit</button>
                </td>
              </tr>`).join('')}</tbody>
          </table>
          <p class="muted small">"Set to my GPS now" updates that location's coordinates to wherever this phone is standing right now.</p>
          ${editingLocation ? renderLocationEditForm() : ''}
          <details ontoggle="this.open && setTimeout(initAddLocationMap,50)"><summary class="link-btn">${t('addLocation')}</summary>
            <label>${t('name')}</label><input id="nl_name" class="input" />
            <label>Brand</label><input id="nl_brand" class="input" />
            <label>${t('setOnMap')}</label>
            <div id="mapAdd" class="map-box"></div>
            <button class="btn secondary small" onclick="useMyLocation()"><span class="icon-inline">${icon('pin')}</span> Use my current GPS</button>
            <label>${t('latitude')}</label><input id="nl_lat" type="number" step="any" class="input" />
            <label>${t('longitude')}</label><input id="nl_lng" type="number" step="any" class="input" />
            <label>${t('radius')}</label><input id="nl_radius" type="number" class="input" value="150" />
            <label>${t('accuracyTolerance')}</label><input id="nl_acc" type="number" class="input" value="100" />
            <p class="map-hint">${t('accuracyToleranceHint')}</p>
            <button class="btn primary" onclick="addLocation()">${t('save')}</button>
          </details>
        </div>
      `);
    }
  );
}

function setupLocationPicker(instanceKey, mapElId, latId, lngId, radiusId, initialLat, initialLng, initialRadius) {
  const mapEl = document.getElementById(mapElId);
  if (!mapEl || !window.L) return null;
  if (window[instanceKey]) { try { window[instanceKey].map.remove(); } catch (e) {} window[instanceKey] = null; }
  const hasPoint = initialLat != null && initialLng != null && !isNaN(initialLat) && !isNaN(initialLng);
  const center = hasPoint ? [initialLat, initialLng] : [22.9734, 78.6569];
  const map = L.map(mapEl, { attributionControl: false }).setView(center, hasPoint ? 17 : 5);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  const marker = L.marker(center, { draggable: true }).addTo(map);
  const circle = L.circle(center, { radius: initialRadius || 150, color: '#1e40af', fillOpacity: 0.12 }).addTo(map);
  function applyPoint(latlng) {
    marker.setLatLng(latlng); circle.setLatLng(latlng);
    document.getElementById(latId).value = latlng.lat.toFixed(6);
    document.getElementById(lngId).value = latlng.lng.toFixed(6);
  }
  marker.on('dragend', () => applyPoint(marker.getLatLng()));
  map.on('click', (e) => applyPoint(e.latlng));
  const radiusInput = document.getElementById(radiusId);
  if (radiusInput) radiusInput.addEventListener('input', () => circle.setRadius(parseInt(radiusInput.value, 10) || 150));
  const picker = { map, marker, circle, applyPoint };
  window[instanceKey] = picker;
  setTimeout(() => map.invalidateSize(), 150);
  return picker;
}
function initAddLocationMap() { setupLocationPicker('_addMap', 'mapAdd', 'nl_lat', 'nl_lng', 'nl_radius', null, null, 150); }

let editingLocation = null;
function startEditLocation(id) {
  const l = (window._hrLocations || []).find(x => x.id === id); if (!l) return;
  editingLocation = { ...l };
  renderHrMasters();
  setTimeout(() => setupLocationPicker('_editMap', 'mapEdit', 'el_lat', 'el_lng', 'el_radius', l.lat, l.lng, l.radius), 300);
}
function renderLocationEditForm() {
  const l = editingLocation;
  return `
    <div class="worker-summary">
      <h3>Edit: ${esc(l.name)}</h3>
      <label>${t('name')}</label><input id="el_name" class="input" value="${esc(l.name)}" />
      <label>Brand</label><input id="el_brand" class="input" value="${esc(l.brand||'')}" />
      <label>${t('setOnMap')}</label>
      <div id="mapEdit" class="map-box"></div>
      <button class="btn secondary small" onclick="useMyLocationEdit()"><span class="icon-inline">${icon('pin')}</span> Use my current GPS</button>
      <label>${t('latitude')}</label><input id="el_lat" type="number" step="any" class="input" value="${l.lat}" />
      <label>${t('longitude')}</label><input id="el_lng" type="number" step="any" class="input" value="${l.lng}" />
      <label>${t('radius')}</label><input id="el_radius" type="number" class="input" value="${l.radius}" />
      <label>${t('accuracyTolerance')}</label><input id="el_acc" type="number" class="input" value="${l.accuracy_limit||100}" />
      <p class="map-hint">${t('accuracyToleranceHint')}</p>
      <div class="wizard-actions">
        <button class="btn secondary" onclick="editingLocation=null;renderHrMasters()">${t('cancel')}</button>
        <button class="btn primary" onclick="saveEditLocation()">${t('save')}</button>
      </div>
    </div>
  `;
}
async function useMyLocationEdit() {
  const pos = await window.TSGNative.getPosition();
  if (!pos.ok) { toast('Could not get GPS: ' + pos.error, 'error'); return; }
  document.getElementById('el_lat').value = pos.lat.toFixed(6);
  document.getElementById('el_lng').value = pos.lng.toFixed(6);
  if (window._editMap) { window._editMap.applyPoint({ lat: pos.lat, lng: pos.lng }); window._editMap.map.setView([pos.lat, pos.lng], 18); }
}
async function saveEditLocation() {
  const lat = parseFloat(document.getElementById('el_lat').value);
  const lng = parseFloat(document.getElementById('el_lng').value);
  if (isNaN(lat) || isNaN(lng)) { toast('Latitude and longitude are required', 'error'); return; }
  try {
    await window.Api.updateLocation(editingLocation.id, {
      name: document.getElementById('el_name').value.trim(), brand: document.getElementById('el_brand').value.trim(),
      lat, lng, radius: parseInt(document.getElementById('el_radius').value, 10) || undefined,
      accuracyLimit: parseInt(document.getElementById('el_acc').value, 10) || undefined,
    });
    toast('Location updated', 'success');
    editingLocation = null;
    if (window._editMap) { try { window._editMap.map.remove(); } catch (e) {} window._editMap = null; }
    renderHrMasters();
  } catch (e) { toast(e.message, 'error'); }
}
async function fixLocationToMyGps(id) {
  const pos = await window.TSGNative.getPosition();
  if (!pos.ok) { toast('Could not get GPS: ' + pos.error, 'error'); return; }
  try {
    await window.Api.updateLocation(id, { lat: pos.lat, lng: pos.lng });
    toast(`Updated to your current location (accuracy ${Math.round(pos.accuracy||0)}m)`, 'success');
    renderHrMasters();
  } catch (e) { toast(e.message, 'error'); }
}
async function addVendor() {
  const name = document.getElementById('nv_name').value.trim();
  if (!name) { toast('Name required', 'error'); return; }
  try {
    await window.Api.createVendor({
      name, gstin: document.getElementById('nv_gstin').value.trim(), pan: document.getElementById('nv_pan').value.trim(),
      contactPerson: document.getElementById('nv_contact').value.trim(),
    });
    toast('Vendor added', 'success'); renderHrMasters();
  } catch (e) { toast(e.message, 'error'); }
}
async function useMyLocation() {
  const pos = await window.TSGNative.getPosition();
  if (!pos.ok) { toast('Could not get GPS: ' + pos.error, 'error'); return; }
  document.getElementById('nl_lat').value = pos.lat.toFixed(6);
  document.getElementById('nl_lng').value = pos.lng.toFixed(6);
  if (window._addMap) { window._addMap.applyPoint({ lat: pos.lat, lng: pos.lng }); window._addMap.map.setView([pos.lat, pos.lng], 18); }
}
async function addLocation() {
  const name = document.getElementById('nl_name').value.trim();
  const lat = parseFloat(document.getElementById('nl_lat').value);
  const lng = parseFloat(document.getElementById('nl_lng').value);
  if (!name || isNaN(lat) || isNaN(lng)) { toast('Name, latitude and longitude are required', 'error'); return; }
  try {
    await window.Api.createLocation({
      name, brand: document.getElementById('nl_brand').value.trim(), lat, lng,
      radius: parseInt(document.getElementById('nl_radius').value, 10) || 150,
      accuracyLimit: parseInt(document.getElementById('nl_acc').value, 10) || 100,
    });
    toast('Location added', 'success');
    if (window._addMap) { try { window._addMap.map.remove(); } catch (e) {} window._addMap = null; }
    renderHrMasters();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------------- System Admin: admin-portal users ----------------
// Create users with a role and, for location/vendor-scoped roles, the site or vendor
// they can see. Which roles need which scope comes from the server (/admin-users/roles).

let editingUser = null; // null = not editing; {} = new user; {...row} = editing that user
function renderHrUsers() {
  const s = requireHr(); if (!s) return;
  withLoading(
    () => Promise.all([window.Api.listAdminUsers(), window.Api.listAdminRoles(), window.Api.listLocations(), window.Api.listVendors()]),
    ([users, roles, locations, vendors]) => {
      window._adminRoles = roles;
      const locName = Object.fromEntries(locations.map(l => [l.id, l.name]));
      const vendorName = Object.fromEntries(vendors.map(v => [v.id, v.name]));
      const scopeText = (u) => u.location_id ? locName[u.location_id] || '?' : u.vendor_id ? vendorName[u.vendor_id] || '?' : '';
      renderShell(`
        <div class="card">
          <h3>Users</h3>
          <table class="tbl">
            <thead><tr><th>${t('name')}</th><th>Role</th><th>Site / vendor</th><th>${t('status')}</th><th></th></tr></thead>
            <tbody>${users.map(u => `<tr>
              <td>${esc(u.name)}<br/><span class="muted small">${esc(u.email)}</span></td>
              <td>${esc(ROLE_LABELS[u.role] || u.role)}</td>
              <td>${esc(scopeText(u))}</td>
              <td>${u.status === 'active' ? '<span class="badge badge-ok">Active</span>' : '<span class="badge badge-bad">Inactive</span>'}</td>
              <td><button class="btn secondary small" onclick="startEditUser('${u.id}')">Edit</button></td>
            </tr>`).join('')}</tbody>
          </table>
          ${editingUser ? renderUserForm(roles, locations, vendors) : `<button class="btn primary" onclick="startEditUser(null)">Add user</button>`}
        </div>
      `);
      window._adminUsers = users;
      syncUserScopeFields();
    }
  );
}
function startEditUser(id) {
  editingUser = id ? { ...(window._adminUsers || []).find(u => u.id === id) } : {};
  renderHrUsers();
}
function renderUserForm(roles, locations, vendors) {
  const u = editingUser, isNew = !u.id;
  return `
    <div class="worker-summary">
      <h3>${isNew ? 'Add user' : 'Edit: ' + esc(u.email)}</h3>
      <label>${t('name')}</label><input id="au_name" class="input" value="${esc(u.name || '')}" />
      ${isNew ? `<label>Email</label><input id="au_email" class="input" placeholder="name@thesachdevgroup.com" />` : ''}
      <label>Role</label>
      <select id="au_role" class="input" onchange="syncUserScopeFields()">${roles.map(r => `<option value="${r.id}" ${u.role === r.id ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
      <div id="au_loc_wrap"><label>${t('location')}</label>
        <select id="au_location" class="input"><option value="">—</option>${locations.map(l => `<option value="${l.id}" ${u.location_id === l.id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></div>
      <div id="au_vendor_wrap"><label>${t('vendor')}</label>
        <select id="au_vendor" class="input"><option value="">—</option>${vendors.map(v => `<option value="${v.id}" ${u.vendor_id === v.id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select></div>
      <p class="muted small" id="au_scope_hint"></p>
      ${isNew ? '' : `<label>${t('status')}</label>
        <select id="au_status" class="input">
          <option value="active" ${u.status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${u.status === 'inactive' ? 'selected' : ''}>Inactive (cannot log in)</option>
        </select>`}
      <div class="wizard-actions">
        <button class="btn secondary" onclick="editingUser=null;renderHrUsers()">${t('cancel')}</button>
        <button class="btn primary" onclick="saveUser()">${t('save')}</button>
      </div>
    </div>
  `;
}
// Show only the scope picker the selected role actually uses.
function syncUserScopeFields() {
  const roleEl = document.getElementById('au_role'); if (!roleEl) return;
  const role = (window._adminRoles || []).find(r => r.id === roleEl.value) || {};
  document.getElementById('au_loc_wrap').style.display = role.scope === 'location' ? '' : 'none';
  document.getElementById('au_vendor_wrap').style.display = role.scope === 'vendor' ? '' : 'none';
  const hints = {
    manager: 'Sees workers whose reporting manager email is this user\'s email.',
    all: 'Sees workers at every location.',
    none: 'No access to worker data — sets up vendors, locations and users.',
  };
  document.getElementById('au_scope_hint').textContent = hints[role.scope] || '';
}
async function saveUser() {
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : undefined; };
  const body = { name: val('au_name'), role: val('au_role'), locationId: val('au_location') || null, vendorId: val('au_vendor') || null };
  try {
    if (editingUser.id) await window.Api.updateAdminUser(editingUser.id, { ...body, status: val('au_status') });
    else await window.Api.createAdminUser({ ...body, email: val('au_email') });
    toast('User saved', 'success');
    editingUser = null;
    renderHrUsers();
  } catch (e) { toast(e.message, 'error'); }
}

function renderHrAudit() {
  const s = requireHr(); if (!s) return;
  withLoading(() => window.Api.listAudit(), (rows) => {
    renderShell(`
      <div class="card">
        <h3>${t('hrAudit')}</h3>
        <table class="tbl">
          <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
          <tbody>${rows.map(a => `<tr><td>${new Date(a.ts).toLocaleString()}</td><td>${esc(a.user)}</td><td>${esc(a.action)}</td><td>${esc(a.detail)}</td></tr>`).join('')}</tbody>
        </table>
      </div>
    `);
  });
}

function renderHrAccount() {
  const s = requireHr(); if (!s) return;
  const initials = (s.name || '?').trim().split(/\s+/).map(p => p[0]).slice(0, 2).join('').toUpperCase();
  renderShell(`
    <div class="card center-card">
      <div class="avatar" style="margin:0 auto 12px; width:64px; height:64px; font-size:22px">${esc(initials)}</div>
      <h3>${esc(s.name)}</h3>
      <p class="muted">${esc(s.email)}</p>
      <span class="badge badge-neutral">${esc(ROLE_LABELS[s.role] || s.role)}</span>
      <div style="margin:16px 0">
        <label>${t('language')}</label><br/>
        <div class="lang-toggle">
          <button class="lang-btn on-light ${currentLang==='en'?'active':''}" onclick="switchLang('en')">EN</button>
          <button class="lang-btn on-light ${currentLang==='hi'?'active':''}" onclick="switchLang('hi')">HI</button>
        </div>
      </div>
      <button class="link-btn small" onclick="location.hash='#/settings';render()">${t('serverSettings')}</button>
      <button class="btn danger block" style="margin-top:12px" onclick="location.hash='#/hr/logout-confirm';render()">${t('logout')}</button>
    </div>
  `);
}
function renderHrLogoutConfirm() {
  const s = requireHr(); if (!s) return;
  renderShell(`
    <div class="card center-card">
      <h3>${t('logoutConfirmTitle')}</h3>
      <p class="muted">${t('hrLogoutConfirmBody')}</p>
      <button class="btn danger block" onclick="clearSessionData();location.hash='#/';render()">${t('yesLogout')}</button>
      <button class="btn secondary block" onclick="history.back()">${t('noStay')}</button>
    </div>
  `);
}

// ---------------- Router ----------------

function render() {
  // Redirects update location.hash (so the URL/back-button stays correct) but never
  // rely on the resulting 'hashchange' event to trigger the actual re-render — on at
  // least one real device that event did not reliably fire after a programmatic hash
  // change, which left the screen permanently blank with no error at all. Falling
  // through to render the target screen directly, in the same call, fixes that.
  let hash = location.hash || '#/';
  if (hash !== '#/settings' && !getApiBase()) { location.hash = hash = '#/settings'; }
  const s = getSession();
  if (hash === '#/' || hash === '') {
    if (s && s.role === 'worker') { location.hash = hash = '#/w/home'; }
    else if (isAdminSession(s)) { location.hash = hash = adminHomeHash(); }
    else return renderSplash();
  }
  const routes = {
    '#/settings': renderSettings,
    '#/w/register': renderRegister,
    '#/w/pending': renderPending,
    '#/w/home': renderWorkerHome,
    '#/w/attendance': renderWorkerAttendance,
    '#/w/menu': renderWorkerMenu,
    '#/w/logout-confirm': renderLogoutConfirm,
    '#/hr/dashboard': renderHrDashboard,
    '#/hr/approvals': renderHrApprovals,
    '#/hr/attendance': renderHrAttendance,
    '#/hr/regularisations': renderHrRegularisations,
    '#/hr/exceptions': renderHrExceptions,
    '#/hr/masters': renderHrMasters,
    '#/hr/audit': renderHrAudit,
    '#/hr/more': renderHrMore,
    '#/hr/timeguard': renderHrTimeGuard,
    '#/hr/account': renderHrAccount,
    '#/hr/worker': renderHrWorkerDetail,
    '#/hr/users': renderHrUsers,
    '#/hr/logout-confirm': renderHrLogoutConfirm,
  };
  const fn = routes[hash];
  if (fn) fn(); else renderSplash();
}

window.addEventListener('hashchange', render);
// Don't rely solely on DOMContentLoaded firing after this listener attaches — on some
// WebViews the event can already have fired by the time this script (loaded after
// several others) finishes parsing, which left the screen permanently blank with no
// error. If the document is already ready, render immediately instead of waiting.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', render);
} else {
  render();
}
refreshAdminPermissions();

// Last-resort safety net: if anything ever throws uncaught during rendering, show a
// visible error instead of silently leaving a blank screen.
window.addEventListener('error', (e) => {
  const app = document.getElementById('app');
  if (app && !app.innerHTML.trim()) {
    app.innerHTML = `<div style="padding:24px;font-family:sans-serif;color:#b91c1c">
      <h3>Something went wrong loading the app</h3>
      <p style="font-size:13px;color:#475569">${(e.message || 'Unknown error').replace(/[<>]/g, '')}</p>
      <button onclick="location.reload()" style="margin-top:12px;padding:10px 16px;border:none;border-radius:8px;background:#1e40af;color:#fff;font-weight:700">Reload</button>
    </div>`;
  }
});

// ---------------- Hardware/gesture back button ----------------
// Capacitor's default, with nothing listening, is to just close the app whenever
// there's no browser history entry to pop — and several screens here (login
// sub-steps, the registration wizard) swap content directly instead of changing
// location.hash, so there's often no history entry at all. This owns every back
// press explicitly instead of relying on that default.
function handleBackButton() {
  // Login sub-steps never touch location.hash, so they have to be checked first,
  // independent of whatever the current hash happens to be.
  if (loginState && loginState.step === 'otp') {
    if (loginState.mobile !== undefined) startWorkerLogin(); else startHrLogin();
    return;
  }
  if (loginState && (loginState.step === 'mobile' || loginState.step === 'email')) {
    loginState = {};
    location.hash = '#/'; render();
    return;
  }
  // Registration wizard steps also change in place, not via the hash.
  if (location.hash === '#/w/register' && regState && regState.step > 1) {
    renderRegStep(regState.step - 1);
    return;
  }

  const s = getSession();
  const hash = location.hash || '#/';
  if (!s) {
    if (hash !== '#/') { location.hash = '#/'; render(); return; }
    window.TSGNative.minimizeApp(); // at the true root with nothing to go back to — minimize, don't kill
    return;
  }
  const homeHash = s.role === 'worker' ? '#/w/home' : adminHomeHash();
  if (hash !== homeHash) { location.hash = homeHash; render(); return; }
  window.TSGNative.minimizeApp();
}
window.TSGNative.onBackButton(handleBackButton);

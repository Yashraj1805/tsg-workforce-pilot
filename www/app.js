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

// ---------------- Voice (BRD design rule 2, R11) ----------------
// Reads a screen or a result aloud in the worker's chosen language (Hindi by default).
// On by default for worker screens — "Many workers can read very little" — and can be
// switched off from the worker menu. `force` speaks even when voice is off (Listen again).
const VOICE_KEY = 'tsg_voice';
function voiceOn() { try { return localStorage.getItem(VOICE_KEY) !== 'off'; } catch (e) { return true; } }
function setVoice(on) { try { localStorage.setItem(VOICE_KEY, on ? 'on' : 'off'); } catch (e) { /* ignore */ } if (!on) stopVoice(); }
function speak(hi, en, force) {
  if (!force && !voiceOn()) return;
  if (!window.TSGNative || !window.TSGNative.speakText) return;
  const useHindi = currentLang !== 'en';
  const text = (useHindi ? hi : en) || hi || en;
  if (text) window.TSGNative.speakText(String(text).replace(/<[^>]+>/g, ''), useHindi ? 'hi-IN' : 'en-IN');
}
function stopVoice() { if (window.TSGNative && window.TSGNative.stopSpeaking) window.TSGNative.stopSpeaking(); }

// Design rule 9 (low-cost phones, weak networks): photos are shrunk on the phone before
// upload — a full-resolution camera frame is several MB.
function shrinkDataUrl(dataUrl, maxDim, quality) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      if (scale === 1 && dataUrl.length < 400000) { resolve(dataUrl); return; }
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale); canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', quality || 0.8));
    };
    img.onerror = () => resolve(dataUrl);
    setTimeout(() => resolve(dataUrl), 4000); // never block an upload on a decoder that stalls
    img.src = dataUrl;
  });
}

function statusBadge(status) {
  const map = {
    present: ['badge-ok', 'Present'], half_day: ['badge-warn', 'Half day'],
    missed_punch_out: ['badge-warn', 'Missed punch-out'], absent: ['badge-bad', 'Absent'],
    pending: ['badge-warn', 'Pending'], approved: ['badge-ok', 'Approved'],
    rejected: ['badge-bad', 'Rejected'], sent_back: ['badge-warn', 'Sent back'], exited: ['badge-neutral', 'Exited'],
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
// A thumbnail only when there's an actual image — a blocked punch can carry a selfie
// field that isn't a usable data: URL, which the bare <img> rendered as a broken icon.
function thumbHtml(dataUrl) {
  // < 200 chars is a bare header with no pixels (seen on test rows), never a real photo.
  return dataUrl && /^data:image\//.test(dataUrl) && dataUrl.length > 200 ? `<img src="${esc(dataUrl)}" class="thumb" />` : `<div class="thumb placeholder">${icon('user')}</div>`;
}
// Punch block reasons are stored as codes (punches.js); HR reads words.
const REASON_LABELS = {
  fake_gps: 'Fake GPS', outside_geofence: 'Outside site', low_accuracy: 'Weak GPS signal', face_mismatch: "Face didn't match",
  spoof_suspected: 'Photo / screen suspected', device_mismatch: 'Different phone', offline_expired: 'Offline punch too old',
  offline_rebooted: 'Phone restarted (offline punch)', offline_no_clock: 'Offline punch, no clock proof',
};
function reasonLabel(code) { return REASON_LABELS[code] || String(code || '').replace(/_/g, ' '); }
// The stored AI note is a diagnostic string ("[check 1] samePerson=false confidence=0.99
// spoofSuspected=false: The faces…"). HR gets the human sentences; the raw form stays
// behind a tap for anyone who needs to see exactly what the model said.
function aiNoteHtml(note) {
  if (!note) return '';
  const sentences = note.split(/\s*\|\s*/).map(part => {
    const m = /:\s*(.+)$/.exec(part.replace(/^\[[^\]]*\]\s*/, ''));
    return m ? m[1].trim() : '';
  }).filter(Boolean);
  const summary = sentences.length ? sentences.join(' ') : note;
  return `<details class="ai-note"><summary class="muted small">${t('aiNote')}: ${esc(summary)}</summary><div class="muted small" style="margin-top:4px;word-break:break-word">${esc(note)}</div></details>`;
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
    if (e.status === 401) return sessionEnded(e.message);
    renderShell(`<div class="card">${errorState(e.message || 'Something went wrong')}</div>`);
  }
}

// ---------------- Sign-out (R17 logout audit, R18 admin idle timeout) ----------------
// Logout tells the server first so the session is ended (and audited) there, not just
// forgotten on this phone. Signing out locally still happens if the server is unreachable.
async function doLogout() {
  try { await window.Api.logout(); } catch (e) { /* offline: the server session still idles out */ }
  clearSessionData();
  location.hash = '#/'; render();
}
// The server ended the session (logout elsewhere, idle timeout, deactivated account):
// back to the start screen with the server's reason, rather than a "Retry" button.
function sessionEnded(message) {
  if (isAssisted()) { toast(message || 'Registration session ended', 'error'); return endAssistedSession(); }
  clearSessionData();
  toast(message || 'Please sign in again', 'error');
  location.hash = '#/'; render();
}
// R18: the admin portal signs itself out after 15 minutes without use, so data isn't left
// on screen. (The server enforces the same limit on the next request regardless.)
const ADMIN_IDLE_MS = 15 * 60 * 1000;
let lastActivity = Date.now();
['click', 'keydown', 'touchstart', 'input'].forEach(ev => document.addEventListener(ev, () => { lastActivity = Date.now(); }, { passive: true }));
setInterval(() => {
  if (isAdminSession(getSession()) && Date.now() - lastActivity > ADMIN_IDLE_MS) {
    lastActivity = Date.now();
    doLogout().then(() => toast('Signed out after 15 minutes without use', 'info'));
  }
}, 30000);

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
  const nav = s && !s.assisted ? renderNav(s.role) : '';
  const assistBanner = s && s.assisted ? `<div class="gps-status warn" style="margin:0;border-radius:0">
      Registering worker <b>${esc(s.mobile)}</b> on ${esc(s.assistedBy || 'Site HR')}'s phone
      <button class="btn secondary small" style="margin-left:8px" onclick="endAssistedSession()">Exit</button></div>` : '';
  app.innerHTML = assistBanner + `
    <header class="topbar">
      <div class="topbar-title">
        <div class="app-name">${t('appName')}</div>
        ${s ? '' : `<div class="demo-badge">${getApiBase() ? esc(getApiBase().replace(/^https?:\/\//, '')) : t('demoBadge')}</div>`}
      </div>
      <div class="topbar-actions">
        <div class="lang-seg" role="group" aria-label="Language">
          <button class="lang-btn ${currentLang==='en'?'active':''}" onclick="switchLang('en')">EN</button>
          <button class="lang-btn ${currentLang==='hi'?'active':''}" onclick="switchLang('hi')">HI</button>
        </div>
      </div>
    </header>
    <main class="content">${innerHtml}</main>
    ${nav}
  `;
  labelTables(app);
}
// Copies each multi-column table's header text onto its cells as data-label, which the
// phone-width stylesheet turns into "LABEL  value" stacked rows (no sideways scrolling).
// Runs on every render, and on any table injected later (see billDetail).
function labelTables(root) {
  root.querySelectorAll('table.tbl').forEach(tbl => {
    const labels = [...tbl.querySelectorAll('thead th')].map(th => th.textContent.trim());
    if (!labels.length) return;
    tbl.querySelectorAll('tbody tr').forEach(tr => [...tr.children].forEach((td, i) => td.setAttribute('data-label', labels[i] || '')));
  });
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
function isAdminSession(s) { return !!s && s.role !== 'worker' && s.role !== 'kiosk'; }
function hasPerm(p) { const s = getSession(); return !!(s && s.permissions && s.permissions.includes(p)); }

// Every admin screen, in nav-priority order. `perms` must all be held to open it; the
// first three a role can open (among `nav: true`) become its bottom-nav tabs, the rest
// go under "More".
const ADMIN_SCREENS = [
  // Security's first tab: "Security at the gate checks the portal" (proposal).
  { hash: '#/hr/gate', icon: 'shield', label: () => 'Gate check', perms: ['workers.gatecheck'], nav: true, onlyWithout: 'workers.read' },
  // Role-tailored home screens — these replace the generic dashboard (below) for the
  // one role each is built for, so that role never sees two dashboard tabs.
  { hash: '#/hr/location-dashboard', icon: 'chart', label: () => 'My location', perms: ['workers.read', 'punches.read'], nav: true, onlyRole: ['location_head'] },
  { hash: '#/hr/finance-dashboard', icon: 'chart', label: () => 'Finance overview', perms: ['billing.read'], nav: true, onlyRole: ['mis_finance'] },
  { hash: '#/hr/dashboard', icon: 'chart', label: () => dashLabel(), perms: ['workers.read', 'punches.read'], nav: true, hiddenIfVisible: ['#/hr/location-dashboard', '#/hr/finance-dashboard'] },
  { hash: '#/hr/approvals', icon: 'check', label: () => t('hrApprovals'), perms: ['workers.approve'], nav: true },
  { hash: '#/hr/assist', icon: 'user', label: () => 'Register worker', perms: ['workers.register_assisted'], nav: true },
  { hash: '#/hr/attendance', icon: 'calendar', label: () => t('hrAttendance'), perms: ['workers.read', 'punches.read'], nav: true },
  { hash: '#/hr/exceptions', icon: 'warn', label: () => t('hrExceptions'), perms: ['punches.read'], nav: true },
  { hash: '#/hr/masters', icon: 'building', label: () => t('hrMasters'), perms: ['masters.write'], nav: true },
  { hash: '#/hr/users', icon: 'user', label: () => 'Users', perms: ['users.manage'], nav: true },
  { hash: '#/hr/audit', icon: 'ledger', label: () => t('hrAudit'), perms: ['audit.read'], nav: true },
  { hash: '#/hr/workers', icon: 'user', label: () => 'Workers', perms: ['workers.read'] },
  { hash: '#/hr/billing', icon: 'ledger', label: () => 'Vendor bill check', perms: ['billing.read'] },
  { hash: '#/hr/reports', icon: 'doc', label: () => 'Reports (Excel)', perms: ['reports.read'] },
  { hash: '#/hr/emails', icon: 'inbox', label: () => 'Automatic emails', perms: ['emails.manage'] },
  { hash: '#/hr/kiosks', icon: 'camera', label: () => 'Gate tablets', perms: ['kiosks.manage'] },
  { hash: '#/hr/requests', icon: 'doc', label: () => 'Transfer & exit requests', perms: ['requests.view'] },
  { hash: '#/hr/timeguard', icon: 'shield', label: () => t('timeGuard'), perms: ['workers.read', 'punches.read'] },
  { hash: '#/hr/ask', icon: 'sparkle', label: () => 'Ask AI', perms: ['reports.read'] },
  { hash: '#/hr/regularisations', icon: 'doc', label: () => t('hrRegularisations'), perms: ['regularisations.read', 'workers.read'] },
  { hash: '#/hr/account', icon: 'user', label: () => t('account'), perms: [] },
];
const ADMIN_ROUTE_PERMS = { '#/hr/worker': ['workers.read'], '#/hr/more': [], '#/hr/logout-confirm': [] };
// onlyRole: shown only to a listed role (a tailored dashboard built for that one role).
// hiddenIfVisible: hidden only once one of the listed replacement screens is actually
// visible (perms and all) — not just "this role has a replacement," so a role never
// ends up with zero dashboards if its replacement's permissions ever turn out not to
// match what's actually granted (e.g. an RBAC edit later gives mis_finance a role
// without billing.read) — the generic dashboard stays as a fallback in that case.
function screenVisible(x) {
  const s = getSession();
  const role = s && s.role;
  if (x.onlyRole && !x.onlyRole.includes(role)) return false;
  if (!x.perms.every(hasPerm)) return false;
  if (x.hiddenIfVisible && x.hiddenIfVisible.some(h => { const other = ADMIN_SCREENS.find(y => y.hash === h); return other && screenVisible(other); })) return false;
  return true;
}
function canOpenAdminRoute(hash) {
  const screen = ADMIN_SCREENS.find(x => x.hash === hash);
  if (screen) return screenVisible(screen);
  const perms = ADMIN_ROUTE_PERMS[hash];
  return !!perms && perms.every(hasPerm);
}
// onlyWithout: a tab only for roles lacking that permission (e.g. Gate check is Security's
// main tab; HR roles, who can see workers, find it under More).
function adminNavScreens() { return ADMIN_SCREENS.filter(x => x.nav && (!x.onlyWithout || !hasPerm(x.onlyWithout)) && screenVisible(x)).slice(0, 3); }
function adminMoreScreens() {
  const inNav = adminNavScreens().map(x => x.hash);
  return ADMIN_SCREENS.filter(x => !inNav.includes(x.hash) && screenVisible(x));
}
function adminHomeHash() { const first = adminNavScreens()[0]; return first ? first.hash : '#/hr/account'; }

function navLink(href, iconName, label, forceActive) {
  const active = forceActive != null ? forceActive : location.hash === href;
  return `<a href="${href}" class="${active ? 'active' : ''}"><span class="nav-icon">${icon(iconName)}</span>${label}</a>`;
}

function renderNav(role) {
  if (role === 'kiosk') return '';
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
      <button class="link-btn small" style="margin-top:10px" onclick="renderKioskPair()">🖥️ Gate tablet (kiosk)</button>
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

// BRD §10 screen 3: "Resend after 30 s." The button counts down, then enables. (The
// server enforces the same wait and the 15-minute lock after 3 wrong OTPs.)
let resendTimer = null;
function resendOtpButton(onclickJs, seconds) {
  clearInterval(resendTimer);
  let left = seconds || 30;
  resendTimer = setInterval(() => {
    const b = document.getElementById('resendOtpBtn');
    if (!b) { clearInterval(resendTimer); return; }
    left -= 1;
    if (left <= 0) { clearInterval(resendTimer); b.disabled = false; b.textContent = 'Resend OTP / OTP फिर भेजें'; }
    else b.textContent = `Resend OTP in ${left} s`;
  }, 1000);
  return `<button id="resendOtpBtn" class="link-btn small" disabled onclick="${onclickJs}">Resend OTP in ${left} s</button>`;
}

// ---------------- Worker: login ----------------

let loginState = {};

function startWorkerLogin() {
  // Starting a fresh login means whatever session was in storage is being replaced —
  // otherwise renderShell draws the old session's bottom nav under the login card.
  clearSessionData();
  loginState = { step: 'mobile' };
  renderShell(`
    <div class="card center-card">
      <h3>${t('mobileNumber')}</h3>
      <input id="loginMobile" class="input" maxlength="10" inputmode="numeric" placeholder="98xxxxxxxx" />
      <button class="btn primary block" onclick="workerRequestOtp()">${t('sendOtp')}</button>
    </div>
  `);
}
// Where the OTP went (the server picks WhatsApp first for a mobile, SMS if that fails),
// plus the "send on SMS instead" escape hatch when it went by WhatsApp — the worker may
// have WhatsApp on a different number, or none at all.
function otpSentLine(result, mobile, smsOnclick) {
  if (result.devOtp) return `<p class="muted small">${t('otpHint')}: ${result.devOtp}</p>`;
  const where = { whatsapp: `WhatsApp (${esc(mobile)})`, sms: `SMS (${esc(mobile)})`, email: esc(mobile) }[result.channel] || esc(mobile);
  const icon = result.channel === 'whatsapp' ? '💬 ' : result.channel === 'sms' ? '📩 ' : '';
  return `<p class="muted small">${icon}${bi('OTP भेजा गया', 'OTP sent to')} ${where}</p>` +
    (result.channel === 'whatsapp' && smsOnclick ? `<button class="link-btn small" onclick="${smsOnclick}">${bi('WhatsApp पर नहीं आया? SMS पर भेजें', "Didn't get it on WhatsApp? Send on SMS")}</button>` : '');
}
async function workerRequestOtp(resend, channel) {
  const mobile = resend ? loginState.mobile : document.getElementById('loginMobile').value.trim();
  if (!/^\d{10}$/.test(mobile)) { toast(t('invalidMobile'), 'error'); return; }
  try {
    const result = await window.Api.workerOtpRequest(mobile, channel);
    loginState = { step: 'otp', mobile };
    renderShell(`
      <div class="card center-card">
        <h3>${t('enterOtp')}</h3>
        ${otpSentLine(result, mobile, "workerRequestOtp(true, 'sms')")}
        <input id="loginOtp" class="input" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />
        ${resendOtpButton("workerRequestOtp(true)", result.resendInSeconds)}
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

// BRD §10 registration, one task per screen (design rule 6), in the BRD's order:
// consent → photo → Aadhaar → PAN → job → vendor + site → education → review.
// Headings are Hindi first, English below (rule 2) and each step is read aloud; choices
// are picture tiles with a tick (rule 5). Everything is saved to the server as the
// worker goes, so leaving and coming back resumes where they were.
let regState = { step: 1 };
const REG_STEPS = 8;

// Hindi first, English below.
function bi(hi, en) {
  if (currentLang === 'en') return `<span class="bi-en">${en}</span>`;
  if (currentLang === 'hi') return `<span class="bi-hi">${hi}</span>`;
  return `<span class="bi-hi">${hi}</span><span class="bi-en">${en}</span>`;
}
function regHeader(n, hi, en) {
  speak(hi, en);
  return `<div class="muted small">${n} / ${REG_STEPS}</div><div class="step-bar"><div style="width:${Math.round(n / REG_STEPS * 100)}%"></div></div><h3>${bi(hi, en)}</h3>`;
}
function regNav(back, nextLabel, nextFn, disabled) {
  return `<div class="wizard-actions">
    ${back ? `<button class="btn secondary" onclick="renderRegStep(${back})">${t('back')}</button>` : '<span></span>'}
    ${nextFn ? `<button class="btn primary" ${disabled ? 'disabled' : ''} onclick="${nextFn}">${nextLabel || t('next')}</button>` : ''}
  </div>`;
}
// Picture tiles with a tick (rule 5). `field` is the worker property; `pick` the handler.
function tiles(items, selected, pick) {
  return `<div class="tile-grid">${items.map(i => `
    <button class="tile ${i.id === selected ? 'selected' : ''}" onclick="${pick}('${i.id}')">
      <span class="tile-icon">${i.icon || '•'}</span>
      ${currentLang !== 'en' ? `<span class="tile-hi">${esc(i.hi || i.name_hi || '')}</span>` : ''}
      ${currentLang !== 'hi' ? `<span class="tile-en">${esc(i.en || i.name || '')}</span>` : ''}
      ${i.id === selected ? '<span class="tile-tick">✓</span>' : ''}
    </button>`).join('')}</div>`;
}

function renderRegister() {
  if (!requireWorker()) return;
  withLoading(() => Promise.all([window.Api.getMe(), window.Api.registrationOptions()]), ([w, opts]) => {
    regState = { ...regState, worker: w, opts };
    if (w.status !== 'draft' && w.status !== 'sent_back') { location.hash = w.status === 'approved' ? '#/w/home' : '#/w/pending'; render(); return; }
    // Resume at the first unfinished step.
    if (!regState.resumed) {
      regState.resumed = true;
      const done = [w.consent_version === opts.consent.version, !!w.photo_data_url, !!(w.aadhaar_qr_at || w.aadhaar_verified) && !!w.name,
        !!w.pan_verified, !!w.job_id, !!(w.vendor_id && w.location_id), !!w.qualification];
      const first = done.indexOf(false);
      regState.step = first === -1 ? REG_STEPS : first + 1;
    }
    renderRegStep(regState.step || 1);
  });
}

async function renderRegStep(step) {
  regState.step = step;
  return [null, regConsent, regPhoto, regAadhaar, regPan, regJob, regVendorSite, regEducation, regReview][step]();
}
async function regSave(fields, nextStep) {
  try {
    regState.worker = await window.Api.updateMe(fields);
    if (nextStep) renderRegStep(nextStep);
    return true;
  } catch (e) { toast(e.message, 'error'); return false; }
}

// ---- 1 Consent (screen 4: read aloud, tick required, saved with date/time/version) ----
function regConsent() {
  const c = regState.opts.consent;
  const w = regState.worker;
  const accepted = w.consent_version === c.version;
  renderShell(`
    <div class="card">
      ${regHeader(1, 'सहमति', 'Consent')}
      ${currentLang !== 'en' ? `<p class="consent-text bi-hi">${esc(c.hi)}</p>` : ''}
      ${currentLang !== 'hi' ? `<p class="consent-text bi-en">${esc(c.en)}</p>` : ''}
      <button class="btn secondary small" onclick="speak(regState.opts.consent.hi, regState.opts.consent.en, true)">🔊 ${bi('फिर से सुनें', 'Listen again')}</button>
      <label class="consent-row" style="margin-top:14px"><input type="checkbox" id="f_consent" ${accepted ? 'checked' : ''} /><span>${bi('मैं सहमत हूँ', 'I agree')}</span></label>
      ${regNav(null, null, 'regConsentNext()')}
    </div>`);
}
async function regConsentNext() {
  if (!document.getElementById('f_consent').checked) { toast('Tick "I agree" to continue', 'error'); return; }
  try {
    regState.worker = await window.Api.giveConsent(regState.opts.consent.version, currentLang);
    renderRegStep(2);
  } catch (e) { toast(e.message, 'error'); }
}

// ---- 2 Face photo (screen 5: live camera only, one live face — checked by the server) ----
function regPhoto() {
  const w = regState.worker;
  renderShell(`
    <div class="card">
      ${regHeader(2, 'अपनी फोटो लें', 'Take your photo')}
      <p class="muted small">${bi('कैमरे की ओर सीधे देखें। फोटो में सिर्फ़ आप हों।', 'Look straight at the camera. Only you in the photo.')}</p>
      <div class="selfie-frame">
        ${w.photo_data_url ? `<img src="${w.photo_data_url}" class="selfie-preview" />` : `<div class="selfie-placeholder"><span class="icon-inline" style="width:28px;height:28px;margin:0 0 6px">${icon('camera')}</span></div>`}
      </div>
      <button class="btn ${w.photo_data_url ? 'secondary' : 'primary'} block big" onclick="regCapturePhoto()">📷 ${w.photo_data_url ? bi('फिर से लें', 'Retake') : bi('फोटो लें', 'Take photo')}</button>
      ${regNav(1, null, 'renderRegStep(3)', !w.photo_data_url)}
    </div>`);
}
async function regCapturePhoto() {
  const res = await window.TSGNative.takeSelfie(isAssisted() ? 'REAR' : 'FRONT');
  if (!res.ok) { toast('Camera failed: ' + res.error, 'error'); return; }
  const small = await shrinkDataUrl(res.dataUrl, 960, 0.8);
  toast('Checking photo…', 'info');
  if (await regSave({ photoDataUrl: small })) renderRegStep(2);
}

// ---- 3 Aadhaar QR (screen 6) — fills name, father's name, DOB, gender, address ----
function regAadhaar() {
  const w = regState.worker;
  renderShell(`
    <div class="card">
      ${regHeader(3, 'आधार कार्ड', 'Aadhaar card')}
      ${w.aadhaar_qr_at
        ? `<div class="kyc-status ok">✅ ${bi('आधार स्कैन हो गया', 'Aadhaar scanned')} — ${esc(w.aadhaar_masked || '')}</div>`
        : `<p class="muted small">${bi('आधार कार्ड के QR की <b>फोटो लें</b> — आपकी जानकारी अपने-आप भर जाएगी। कार्ड सीधा रखें, QR फोटो में बड़ा दिखे, रोशनी अच्छी हो।', 'Take a <b>photo</b> of the QR on the Aadhaar card — your details fill in by themselves. Card flat, QR large in the photo, good light.')}</p>`}
      ${regState.aadhaarNameWarning ? `<div class="gps-status bad">Name on Aadhaar is "${esc(regState.aadhaarNameWarning)}" — your name below must match it.
        <button class="btn secondary small" style="margin-top:6px" onclick="useAadhaarName(this)">Use Aadhaar name</button></div>` : ''}
      ${regState.qrHelp ? `<div class="gps-status warn" style="margin-top:8px">${bi('लाइव स्कैनर QR नहीं पढ़ पाया (आधार का QR बहुत घना होता है)। नीचे वाले बटन से उसकी फोटो लें — वह काम करता है।', "The live scanner couldn't read it (the Aadhaar QR is very dense). Use the photo button below — that one works.")}</div>` : ''}
      <button class="btn primary block big" onclick="regPhotoAadhaarQr()">📷 ${w.aadhaar_qr_at ? bi('फिर से फोटो लें', 'Take the photo again') : bi('आधार QR की फोटो लें', 'Take a photo of the Aadhaar QR')}</button>
      <button class="btn secondary block" onclick="regScanAadhaar()">${bi('लाइव स्कैनर आज़माएँ', 'Try the live scanner instead')}</button>
      ${w.aadhaar_qr_at ? `
        <div class="kyc-status ${w.aadhaar_verified ? 'ok' : ''}" style="margin-top:14px">${w.aadhaar_verified ? '✅ ' + bi('OTP से पुष्टि हो गई', 'Verified with OTP') : '⏳ ' + bi('अब OTP से पुष्टि करें', 'Now verify with OTP')}</div>
        ${!w.aadhaar_verified ? `<button class="btn primary block" onclick="startDigilocker()">🔐 ${bi('आधार OTP से पुष्टि करें', 'Verify Aadhaar with OTP')}</button>
          <p class="muted small">${bi('OTP आपके आधार से जुड़े मोबाइल पर आएगा।', 'The OTP goes to the mobile linked to your Aadhaar.')}</p>` : ''}` : ''}
      ${w.aadhaar_qr_at || w.name ? `
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
        <label>${t('emergencyContact')}</label><input id="f_emg" class="input" maxlength="10" inputmode="numeric" value="${esc(w.emergency_contact||'')}" />` : ''}
      ${regNav(2, null, 'regAadhaarNext()', !(w.aadhaar_qr_at || w.name))}
    </div>`);
}
// R04: the server decodes the QR, keeps only the masked number, and fills empty fields.
async function regScanAadhaar() {
  const scan = await window.TSGNative.scanQrCode();
  if (!scan.ok) {
    // The Aadhaar Secure QR is very dense and the live scanner often can't lock onto a
    // printed card — offer the still-photo route rather than failing silently.
    regState.qrHelp = true;
    if (!scan.cancelled) toast(scan.error, 'error');
    renderRegStep(3);
    speak('QR नहीं पढ़ा गया। QR की फोटो लें।', "Couldn't read the QR. Take a photo of the QR instead.");
    return;
  }
  try { aadhaarQrAccepted(await window.Api.aadhaarQr(scan.text)); } catch (e) { toast(e.message, 'error'); }
}
// Fallback: a full-resolution photo of the QR, read by ML Kit on the phone or, failing
// that, by the server.
async function regPhotoAadhaarQr() {
  const r = await window.TSGNative.scanQrFromPhoto();
  if (r.cancelled) return;
  toast('Reading the QR…', 'info');
  try {
    if (r.ok) return aadhaarQrAccepted(await window.Api.aadhaarQr(r.text));
    if (r.dataUrl) return aadhaarQrAccepted(await window.Api.aadhaarQrImage(r.dataUrl));
    toast(r.error || 'Could not take the photo', 'error');
  } catch (e) { toast(e.message, 'error'); }
}
function aadhaarQrAccepted(result) {
  regState.qrHelp = false;
  regState.worker = result.worker;
  // R05: names must match. The server won't block the scan (the typed name may just be
  // a draft), but submit will — so say so now, with the Aadhaar name to copy.
  regState.aadhaarNameWarning = result.nameMatches === false ? result.name : null;
  toast(`Aadhaar scanned (…${result.last4})`, result.nameMatches === false ? 'error' : 'success');
  renderRegStep(3);
}
function useAadhaarName(btn) {
  document.getElementById('f_name').value = regState.aadhaarNameWarning;
  regState.aadhaarNameWarning = null;
  btn.parentNode.remove();
}
async function regAadhaarNext() {
  const get = id => document.getElementById(id).value.trim();
  const fields = { name: get('f_name'), fatherName: get('f_father'), dob: get('f_dob'), gender: get('f_gender'), address: get('f_address'), emergencyContact: get('f_emg') };
  if (!fields.name) { toast('Name is required', 'error'); return; }
  regSave(fields, 4);
}

// ---- 4 PAN photo + verification (screen 7), DigiLocker Aadhaar OTP ----
function regPan() {
  const w = regState.worker;
  renderShell(`
    <div class="card">
      ${regHeader(4, 'पैन कार्ड', 'PAN card')}
      ${!w.aadhaar_verified ? `<div class="gps-status warn">${bi('आधार की OTP पुष्टि अभी बाकी है — पिछले स्टेप में करें।', 'Aadhaar OTP verification is still pending — do it in the previous step.')}
        <button class="btn secondary small" style="margin-top:6px" onclick="renderRegStep(3)">${bi('आधार पर जाएँ', 'Go to Aadhaar')}</button></div>` : ''}
      <div class="kyc-status ${w.pan_verified?'ok':''}">${w.pan_verified ? '✅ ' + bi('पैन की पुष्टि हो गई', 'PAN verified') : '⏳ ' + bi('पैन की पुष्टि बाकी है', 'PAN not yet verified')}</div>
      ${!w.pan_verified ? `
        ${w.pan_photo_data_url ? `<img src="${w.pan_photo_data_url}" class="selfie-preview" style="border-radius:8px;max-height:140px" />` : ''}
        ${regState.panRead ? `<div class="kyc-status">PAN read from photo: <b>${esc(regState.panRead.panNumber)}</b>${regState.panRead.nameOnCard ? ` · ${esc(regState.panRead.nameOnCard)}` : ''}</div>
          <button class="btn primary block" onclick="verifyPan(true)">Yes, verify this PAN</button>` : ''}
        <button class="btn secondary block" onclick="regPanPhoto()">📷 ${w.pan_photo_data_url ? bi('पैन की फोटो फिर से लें', 'Retake PAN photo') : bi('पैन कार्ड की फोटो लें', 'Take photo of PAN card')}</button>
        ${regState.panManual ? `
          <input id="f_pan" class="input" maxlength="10" placeholder="ABCDE1234F" style="text-transform:uppercase" />
          <button class="btn secondary block" onclick="verifyPan(false)">Verify PAN</button>
        ` : `<button class="link-btn small" onclick="regState.panManual=true;renderRegStep(4)">Can't take a photo? Type the PAN instead</button>`}
      ` : ''}
      ${(!w.aadhaar_verified || !w.pan_verified) && regState.opts.devSkipAllowed ? `
        <div class="gps-status warn" style="margin-top:16px">
          <div>${t('devSkipHint')}</div>
          <button class="btn warn block" style="margin-top:8px" onclick="skipKycDev()">${t('devSkipButton')}</button>
        </div>` : ''}
      <details style="margin-top:12px"><summary class="link-btn small">${bi('बैंक पासबुक (अगर ज़रूरत हो)', 'Bank passbook (if needed)')}</summary>
        ${w.bank_passbook_data_url ? `<img src="${w.bank_passbook_data_url}" class="selfie-preview" style="border-radius:8px;max-height:120px" />` : ''}
        <button class="btn secondary small" onclick="regPassbookPhoto()">📷 ${w.bank_passbook_data_url ? 'Retake' : 'Take photo'}</button>
      </details>
      ${regNav(3, null, 'renderRegStep(5)', !(w.aadhaar_verified && w.pan_verified))}
    </div>`);
}
async function skipKycDev() {
  try {
    const result = await window.Api.skipKycDev();
    regState.worker = result.worker;
    toast('KYC skipped (dev mode)', 'success');
    renderRegStep(4);
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
    renderDigilockerContinueButton();
  } catch (e) { toast(e.message, 'error'); }
}
function renderDigilockerContinueButton() {
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
    renderRegStep(4);
  } catch (e) { toast(e.message, 'error'); }
}
// R04: PAN by photo — the server reads the number (OCR) and the worker only confirms it.
async function regPanPhoto() {
  const photo = await window.TSGNative.takeDocumentPhoto();
  if (!photo.ok) { toast('Camera failed: ' + photo.error, 'error'); return; }
  toast('Reading PAN card…', 'info');
  try {
    regState.panRead = await window.Api.panPhoto(await shrinkDataUrl(photo.dataUrl, 1600, 0.85));
    regState.worker = await window.Api.getMe();
    renderRegStep(4);
  } catch (e) {
    regState.panRead = null;
    if (e.data && e.data.manualEntry) regState.panManual = true;
    toast(e.message, 'error');
    renderRegStep(4);
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
    renderRegStep(4);
  } catch (e) { toast(e.message, 'error'); }
}
// Design rule 4: "bank passbook if needed" — optional.
async function regPassbookPhoto() {
  const photo = await window.TSGNative.takeDocumentPhoto();
  if (!photo.ok) { toast('Camera failed: ' + photo.error, 'error'); return; }
  if (await regSave({ bankPassbookDataUrl: await shrinkDataUrl(photo.dataUrl, 1600, 0.85) })) renderRegStep(4);
}

// ---- 5 Job (screen 8: one choice from the admin's list) ----
function regJob() {
  renderShell(`
    <div class="card">
      ${regHeader(5, 'आपका काम', 'Your job')}
      ${tiles(regState.opts.jobs, regState.worker.job_id, 'regPickJob')}
      ${regNav(4, null, 'renderRegStep(6)', !regState.worker.job_id)}
    </div>`);
}
async function regPickJob(id) { if (await regSave({ jobId: id })) renderRegStep(5); }

// ---- 6 Vendor + site (screen 9: vendor from admin list; site set by GPS) ----
async function regVendorSite() {
  await withLoading(() => window.Api.listVendors(), (allVendors) => {
    const w = regState.worker;
    // R01: only vendors with a current contract (the server refuses others anyway).
    const today = todayStr(Date.now());
    const vendors = allVendors.filter(v => v.id === w.vendor_id || (v.status !== 'inactive' && !(v.contract_end && v.contract_end < today) && !(v.contract_start && v.contract_start > today)));
    renderShell(`
      <div class="card">
        ${regHeader(6, 'वेंडर और साइट', 'Vendor and site')}
        <label>${t('vendor')}</label>
        ${vendors.length === 0 ? `<div class="gps-status bad">${t('noVendorsLocationsYet')}</div>` :
          tiles(vendors.map(v => ({ id: v.id, en: v.name, icon: '🏢' })), w.vendor_id, 'regPickVendor')}
        <label style="margin-top:14px">${bi('काम की जगह', 'Work site')}</label>
        ${w.location_id ? `<div class="kyc-status ok">📍 ${esc(regState.siteName || (w.location && w.location.name) || 'Site set')}</div>` : ''}
        ${isAssisted() ? `<p class="muted small">Site is the Site HR's location.</p>` :
          `<button class="btn ${w.location_id ? 'secondary' : 'primary'} block" onclick="regSiteFromGps()">📍 ${w.location_id ? bi('फिर से जाँचें', 'Check again') : bi('मेरी साइट GPS से पता करें', 'Find my site by GPS')}</button>`}
        ${regNav(5, null, 'renderRegStep(7)', !(w.vendor_id && w.location_id))}
      </div>`);
  });
}
async function regPickVendor(id) { if (await regSave({ vendorId: id })) renderRegStep(6); }
async function regSiteFromGps() {
  toast(t('gpsChecking'), 'info');
  const pos = await window.TSGNative.getPosition();
  if (!pos.ok) { toast(pos.error, 'error'); return; }
  try {
    const r = await window.Api.siteFromGps(pos.lat, pos.lng, pos.accuracy);
    regState.worker = r.worker;
    regState.siteName = r.location.name;
    toast(`📍 ${r.location.name} (${r.location.distanceM} m)`, 'success');
    renderRegStep(6);
  } catch (e) { toast(e.message, 'error'); }
}

// ---- 7 Education + experience (screen 10: one choice each) ----
function regEducation() {
  const w = regState.worker;
  renderShell(`
    <div class="card">
      ${regHeader(7, 'पढ़ाई और अनुभव', 'Education and experience')}
      <label>${bi('पढ़ाई', 'Education')}</label>
      ${tiles(regState.opts.education, w.qualification, 'regPickEducation')}
      <label style="margin-top:14px">${bi('अनुभव', 'Experience')}</label>
      ${tiles(regState.opts.experience, w.experience, 'regPickExperience')}
      ${regNav(6, null, 'renderRegStep(8)', !w.qualification)}
    </div>`);
}
async function regPickEducation(id) { if (await regSave({ qualification: id })) renderRegStep(7); }
async function regPickExperience(id) { if (await regSave({ experience: id })) renderRegStep(7); }

// ---- 8 Review and submit (screen 11) ----
function regReview() {
  // Reload so vendor/site names (joined by GET /me) are current.
  withLoading(() => window.Api.getMe(), (fresh) => { regState.worker = fresh; regReviewRender(); });
}
function regReviewRender() {
  const w = regState.worker, o = regState.opts;
  const label = (list, id) => { const x = list.find(i => i.id === id); return x ? `${x.hi || x.name_hi || ''} / ${x.en || x.name}` : '—'; };
  const row = (hi, en, val, step) => `<tr><td class="muted">${bi(hi, en)}</td><td>${val}</td><td><button class="link-btn small" onclick="renderRegStep(${step})">✏️</button></td></tr>`;
  renderShell(`
    <div class="card">
      ${regHeader(8, 'जाँचें और भेजें', 'Check and submit')}
      ${w.photo_data_url ? `<img src="${w.photo_data_url}" class="avatar" style="width:80px;height:80px;display:block;margin:0 auto 10px" />` : ''}
      <table class="tbl">
        ${row('नाम', 'Name', esc(w.name || '—'), 3)}
        ${row('आधार', 'Aadhaar', `${esc(w.aadhaar_masked || '—')} ${w.aadhaar_verified ? '✅' : '⏳'}`, 3)}
        ${row('पैन', 'PAN', `${w.pan_number ? '••••••' + esc(w.pan_number.slice(-4)) : '—'} ${w.pan_verified ? '✅' : '⏳'}`, 4)}
        ${row('काम', 'Job', esc(label(o.jobs, w.job_id)), 5)}
        ${row('वेंडर / साइट', 'Vendor / site', `${esc((w.vendor && w.vendor.name) || '—')} / ${esc((w.location && w.location.name) || regState.siteName || '—')}`, 6)}
        ${row('पढ़ाई', 'Education', esc(label(o.education, w.qualification)), 7)}
        ${row('अनुभव', 'Experience', esc(label(o.experience, w.experience)), 7)}
      </table>
      ${regNav(7, bi('HR को भेजें', 'Submit to HR'), 'regSubmit()')}
    </div>`);
}
async function regSubmit() {
  try {
    await window.Api.submitMe();
    toast('Submitted for HR approval', 'success');
    if (isAssisted()) return endAssistedSession();
    location.hash = '#/w/pending'; render();
  } catch (e) {
    toast(e.message, 'error');
    if (e.data && e.data.consentVersion) renderRegStep(1);
  }
}

// ---------------- Worker: pending / home / attendance / menu ----------------

function renderPending() {
  if (!requireWorker()) return;
  withLoading(() => window.Api.getMe(), (w) => {
    if (w.status === 'approved') { location.hash = '#/w/home'; render(); return; }
    // Not submitted yet (or Home tapped mid-registration): back to the wizard, never a
    // false "Registration submitted".
    if (w.status === 'draft') { location.hash = '#/w/register'; render(); return; }
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

// Last profile + punches kept on the phone so the home screen (and offline punching, R19)
// still works with no network.
const HOME_CACHE_KEY = 'tsg_home_cache';
async function loadWorkerHomeData() {
  try {
    const [w, punches] = await Promise.all([window.Api.getMe(), window.Api.myPunches()]);
    try { localStorage.setItem(HOME_CACHE_KEY, JSON.stringify({ w, punches })); } catch (e) { /* storage full */ }
    return { w, punches, offline: false };
  } catch (e) {
    if (e.status !== 0) throw e;
    let cached = null;
    try { cached = JSON.parse(localStorage.getItem(HOME_CACHE_KEY) || 'null'); } catch (e2) { /* corrupt */ }
    if (!cached || !cached.w || cached.w.id !== (getSession() || {}).workerId) throw e;
    return { ...cached, offline: true };
  }
}

function renderWorkerHome() {
  if (!requireWorker()) return;
  withLoading(loadWorkerHomeData, ({ w, punches, offline }) => {
    if (w.status !== 'approved') { location.hash = '#/w/pending'; render(); return; }
    // Punches still waiting on the phone count for today's button state.
    const queued = offlineQueue().filter(i => i.workerId === w.id);
    const all = [...punches, ...queued.map(i => ({ type: i.payload.type, ts: i.capturedAt, result: 'ok', pending: true }))];
    window._myWorker = w; window._myPunches = all;
    const openIn = lastOpenPunchIn(all);
    const todayStatus = attendanceStatusForDay(all, todayStr(Date.now()));
    const completedToday = todayStatus.status !== 'absent' && todayStatus.outTime;

    let statusLine = '';
    if (completedToday) statusLine = `<div class="punch-status done">${t('alreadyOutToday')}</div>`;
    else if (openIn) statusLine = `<div class="punch-status in">${t('alreadyIn')} ${fmtTime(openIn.ts)}</div>`;
    else statusLine = `<div class="punch-status">${t('notPunched')}</div>`;

    renderShell(`
      ${offline ? `<div class="gps-status warn" style="margin-bottom:10px">📵 ${bi('नेटवर्क नहीं है — साइट के अंदर पंच फ़ोन में सेव होगा', 'No network — a punch inside the site is saved on the phone')}</div>` : ''}
      ${queued.length ? `<div class="gps-status warn" style="margin-bottom:10px">⏳ ${bi(`${queued.length} पंच भेजना बाकी है`, `${queued.length} punch(es) waiting to be sent`)}</div>` : ''}
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
    if (completedToday) speak('आज का काम पूरा हो गया', 'Day complete');
    else if (openIn) speak(`आपने ${fmtTime(openIn.ts)} पर पंच इन किया। जाते समय पंच आउट करें।`, `Punched in at ${fmtTime(openIn.ts)}. Punch out when you leave.`);
    else speak('पंच इन करने के लिए हरा बटन दबाएँ', 'Press the green button to punch in');
    // BRD §11 screen 1: "Shows inside or outside site" — without an extra tap.
    if (!completedToday) checkMyLocation();
    if (queued.length && !offline) syncOfflinePunches();
  }, t('checkingLocation'));
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
      // Passive liveness (phase 1): the low-res preview sample from the attempt BEFORE
      // the one that locks is a free second frame, taken a fraction of a second earlier
      // — paired with the final full-quality capture for an anti-spoofing check on the
      // server (geminiClient.checkLiveness), no extra camera call or worker action needed.
      let prevSampleDataUrl = null;

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
            resolve({ ok: true, dataUrl: photo.dataUrl, livenessFrameDataUrl: prevSampleDataUrl });
            return;
          }
          statusEl.textContent = detectResult.reason || t('scanHint');
        } catch (e) {
          statusEl.textContent = e.message || t('scanHint');
        }
        // Skip attempt 1 as a liveness candidate — right after the camera opens,
        // auto-exposure/focus hasn't settled yet and the frame can come back black or
        // blank even though grabPreviewSample() reports ok (confirmed live: a real punch
        // got wrongly blocked as a spoof because the "earlier" frame was pitch black from
        // camera warm-up, not an actual spoof attempt). Only start offering frames once
        // the preview has had at least one full cycle to stabilize.
        if (attempts >= 2) prevSampleDataUrl = sample.dataUrl;
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
  if (!pos.ok) { showResult(false, 'लोकेशन नहीं मिली', 'Location not available', [pos.error]); return; }
  // Fake-GPS signal from the phone (BRD R10); the server decides what to do with it.
  const integrity = window.TSGNative.mockLocationCheck ? await window.TSGNative.mockLocationCheck() : { ok: false };
  const selfieSmall = await shrinkDataUrl(selfie.dataUrl, 960, 0.8); // rule 9: weak networks
  // Already low-res (a preview sample, not a full capture) — only shrunk further if it
  // somehow came in larger than expected, to keep the liveness check cheap on data.
  const livenessFrameSmall = selfie.livenessFrameDataUrl ? await shrinkDataUrl(selfie.livenessFrameDataUrl, 640, 0.7) : null;

  const payload = { type, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, selfieDataUrl: selfieSmall,
    livenessFrameDataUrl: livenessFrameSmall,
    integrity: integrity.ok ? { mock: !!integrity.mock, legacyMockSetting: !!integrity.legacyMockSetting, fixesChecked: integrity.fixesChecked } : null };
  try {
    const result = await window.Api.punch(payload);
    punchDoneResult(type, result.ts, openIn);
  } catch (e) {
    // No network (BRD screen 7): keep it on the phone and send within 12 hours.
    if (e.status === 0 && typeof queueOfflinePunch === 'function') return queueOfflinePunch(payload, w);
    punchBlockedResult(e);
  }
}

// ---- Offline punch (BRD R19, §11 screen 7: "Allowed only inside the site. Send within
// 12 hours with the original time.") The punch is kept on the phone with Android's
// tamper-proof elapsed clock (not the wall clock); the server works out the real time
// and runs every normal check when it arrives. The inside-site check here is only so the
// worker isn't told "saved" for a punch the server will refuse.
const OFFLINE_KEY = 'tsg_offline_punches';
function offlineQueue() { try { return JSON.parse(localStorage.getItem(OFFLINE_KEY) || '[]'); } catch (e) { return []; } }
function setOfflineQueue(q) { try { localStorage.setItem(OFFLINE_KEY, JSON.stringify(q)); } catch (e) { /* storage full */ } }

async function queueOfflinePunch(payload, w) {
  const loc = w && w.location;
  if (!loc || haversineMeters(payload.lat, payload.lng, loc.lat, loc.lng) > loc.radius) {
    return showResult(false, 'नेटवर्क नहीं है', 'No network', [bi('बिना नेटवर्क पंच सिर्फ़ साइट के अंदर होता है', 'Offline punch is allowed only inside the site')]);
  }
  const clock = window.TSGNative.deviceClock ? await window.TSGNative.deviceClock() : { ok: false };
  if (!clock.ok) return showResult(false, 'नेटवर्क नहीं है', 'No network', [bi('नेटवर्क आने पर फिर पंच करें', 'Punch again when the network is back')]);
  const q = offlineQueue();
  q.push({ clientId: 'off_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8), workerId: w.id, payload,
    capturedElapsedMs: clock.elapsedMs, capturedBootCount: clock.bootCount, capturedAt: Date.now() });
  setOfflineQueue(q);
  showResult('queued', 'फ़ोन में सेव हुआ', 'Saved on phone', [
    `${bi('समय', 'Time')}: <b>${fmtTime(Date.now())}</b>`,
    bi('नेटवर्क आते ही अपने-आप भेज दिया जाएगा (12 घंटे के अंदर)', 'Sent automatically when the network is back (within 12 hours)'),
  ]);
}

// Upload queued punches; runs on app start, when the network returns, and every minute
// while anything is waiting. A refusal by the server (4xx) is final and shown once.
let offlineSyncing = false;
async function syncOfflinePunches() {
  if (offlineSyncing) return;
  const s = getSession();
  if (!s || s.role !== 'worker' || s.assisted) return;
  const q = offlineQueue().filter(i => i.workerId === s.workerId);
  if (!q.length) return;
  offlineSyncing = true;
  try {
    for (const item of q) {
      const clock = await window.TSGNative.deviceClock();
      if (!clock.ok) break;
      try {
        await window.Api.offlinePunch({ ...item.payload, clientId: item.clientId, capturedElapsedMs: item.capturedElapsedMs,
          capturedBootCount: item.capturedBootCount, nowElapsedMs: clock.elapsedMs, nowBootCount: clock.bootCount });
        toast(`${bi('पंच भेज दिया', 'Offline punch sent')} (${fmtTime(item.capturedAt)})`, 'success');
      } catch (e) {
        if (e.status === 0) break; // still offline — try again later
        toast(`${item.payload.type === 'in' ? 'Punch-in' : 'Punch-out'} ${fmtTime(item.capturedAt)} not accepted: ${e.message}`, 'error');
      }
      setOfflineQueue(offlineQueue().filter(i => i.clientId !== item.clientId));
    }
  } finally { offlineSyncing = false; }
  if (location.hash === '#/w/home') renderWorkerHome();
}
window.addEventListener('online', syncOfflinePunches);
setInterval(() => { if (offlineQueue().length) syncOfflinePunches(); }, 60000);

// ---- Full-screen result, read aloud (BRD §7 rule 7, R11, §11 screens 3/5/6) ----
function showResult(ok, titleHi, titleEn, lines, onClose) {
  stopVoice();
  const el = document.createElement('div');
  el.className = 'result-screen ' + (ok === 'queued' ? 'queued' : ok ? 'ok' : 'bad');
  el.innerHTML = `
    <div class="result-mark">${ok === 'queued' ? '⏳' : ok ? '✓' : '✕'}</div>
    <div class="result-title">${bi(esc(titleHi), esc(titleEn))}</div>
    ${(lines || []).filter(Boolean).map(l => `<div class="result-line">${l}</div>`).join('')}
    <button class="btn secondary result-close">${bi('ठीक है', 'OK')}</button>`;
  document.body.appendChild(el);
  const close = () => { el.remove(); stopVoice(); if (onClose) onClose(); else renderWorkerHome(); };
  el.querySelector('.result-close').onclick = close;
  speak(`${titleHi}. ${(lines || []).map(l => String(l).replace(/<[^>]+>/g, '')).join('. ')}`, `${titleEn}. ${(lines || []).map(l => String(l).replace(/<[^>]+>/g, '')).join('. ')}`, true);
  return el;
}
function punchDoneResult(type, ts, openIn) {
  if (type === 'in') {
    showResult(true, 'पंच इन हो गया', 'Punched in', [`${bi('समय', 'Time')}: <b>${fmtTime(ts)}</b>`]);
  } else {
    const hours = openIn ? Math.round((ts - openIn.ts) / 360000) / 10 : null;
    showResult(true, 'पंच आउट हो गया', 'Punched out', [
      `${bi('समय', 'Time')}: <b>${fmtTime(ts)}</b>`,
      hours != null ? `${bi('काम के घंटे', 'Hours worked')}: <b>${hours}</b>` : '',
    ]);
  }
}
const BLOCK_REASON = {
  outside_geofence: ['आप साइट से बाहर हैं', 'You are outside the site'],
  low_accuracy: ['GPS कमज़ोर है — खुली जगह में जाएँ', 'Weak GPS — move to an open area'],
  device_mismatch: ['यह आपका रजिस्टर्ड फ़ोन नहीं है', 'This is not your registered phone'],
  face_mismatch: ['चेहरा मेल नहीं खाया', "Face didn't match"],
  spoof_suspected: ['असली सेल्फ़ी लें, फोटो की फोटो नहीं', 'Take a live selfie, not a photo of a photo'],
  fake_gps: ['नकली लोकेशन ऐप बंद करें', 'Turn off the fake-location app'],
};
function punchBlockedResult(e) {
  const d = e.data || {};
  const [hi, en] = BLOCK_REASON[d.reason] || ['पंच नहीं हुआ', 'Punch not saved'];
  const detail = d.distanceM != null ? `${d.distanceM} m · GPS ±${Math.round(d.accuracy || 0)} m` : '';
  showResult(false, hi, en, [esc(e.message), detail, d.reason ? bi('साइट HR को सूचना दी गई', 'Site HR / Security informed') : '']);
}

function renderWorkerAttendance() {
  if (!requireWorker()) return;
  loadWorkerAttendance();
}

// ---- My days (BRD §11 screen 9, R12): monthly calendar — green present, red absent,
// yellow missed punch, grey off day. Tap a day for its in/out times. Worker cannot edit
// (screen 10): the missed-punch button calls Site HR.
async function loadWorkerAttendance() {
  renderShell(`<div class="card">${spinnerRow('Loading…')}</div>`);
  try {
    const [me, punches, myRegs] = await Promise.all([window.Api.getMe(), window.Api.myPunches(), window.Api.myRegularisations()]);
    window._myWorker = me;
    window._calData = { me, punches, myRegs };
    if (!window._calMonth) window._calMonth = todayStr(Date.now()).slice(0, 7);
    renderWorkerCalendar();
  } catch (e) {
    if (e.status === 401) return sessionEnded(e.message);
    renderShell(`<div class="card">${errorState(e.message)}</div>`);
  }
}
function dayInfo(dayStr) {
  const { me, punches, myRegs } = window._calData;
  const today = todayStr(Date.now());
  const st = attendanceStatusForDay(punches, dayStr);
  const reg = myRegs.find(r => r.date === dayStr);
  const weeklyOff = me.location && me.location.weekly_off != null ? me.location.weekly_off : null;
  const dow = new Date(dayStr + 'T12:00:00Z').getUTCDay();
  const startDay = todayStr(me.created_at || 0);
  let kind;
  if (dayStr > today) kind = 'future';
  else if (st.status === 'present' || st.status === 'half_day') kind = 'present';
  else if (reg && reg.status === 'approved') kind = 'present';
  else if (st.status === 'missed_punch_out') kind = dayStr === today ? 'present' : 'missed';
  else if (weeklyOff === dow) kind = 'off';
  else if (dayStr < startDay || dayStr === today) kind = 'future'; // before joining / today not over yet
  else kind = 'absent';
  return { kind, st, reg };
}
function renderWorkerCalendar() {
  const month = window._calMonth;
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay(); // 0 = Sunday
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push('<div class="cal-cell empty"></div>');
  const counts = { present: 0, absent: 0, missed: 0, off: 0 };
  for (let d = 1; d <= daysInMonth; d++) {
    const dayStr = `${month}-${String(d).padStart(2, '0')}`;
    const { kind } = dayInfo(dayStr);
    if (counts[kind] != null) counts[kind]++;
    cells.push(`<button class="cal-cell ${kind}" onclick="showCalDay('${dayStr}')">${d}</button>`);
  }
  const shift = (delta) => { const dt = new Date(Date.UTC(y, m - 1 + delta, 1)); return dt.toISOString().slice(0, 7); };
  const monthName = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  speak(`${counts.present} दिन हाज़िर, ${counts.absent} दिन ग़ैरहाज़िर`, `${counts.present} days present, ${counts.absent} days absent`);
  renderShell(`
    <div class="card">
      <h3>${bi('मेरे दिन', 'My days')}</h3>
      <div class="cal-head">
        <button class="btn secondary small" onclick="window._calMonth='${shift(-1)}';renderWorkerCalendar()">‹</button>
        <b>${monthName}</b>
        <button class="btn secondary small" ${month >= todayStr(Date.now()).slice(0, 7) ? 'disabled' : ''} onclick="window._calMonth='${shift(1)}';renderWorkerCalendar()">›</button>
      </div>
      <div class="cal-grid">${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(x => `<div class="cal-dow">${x}</div>`).join('')}${cells.join('')}</div>
      <div class="cal-legend">
        <span><i class="present"></i>${bi('हाज़िर', 'Present')} ${counts.present}</span>
        <span><i class="absent"></i>${bi('ग़ैरहाज़िर', 'Absent')} ${counts.absent}</span>
        <span><i class="missed"></i>${bi('पंच छूटा', 'Missed punch')} ${counts.missed}</span>
        <span><i class="off"></i>${bi('छुट्टी', 'Off day')} ${counts.off}</span>
      </div>
      <div id="calDay"></div>
      <p class="muted small" style="margin-top:10px">${t('missedPunchHint')}</p>
      <button class="btn warn block" onclick="callSiteHr()">📞 ${t('callSiteHr')}</button>
    </div>
  `);
}
function showCalDay(dayStr) {
  const { kind, st, reg } = dayInfo(dayStr);
  const label = { present: ['हाज़िर', 'Present'], absent: ['ग़ैरहाज़िर', 'Absent'], missed: ['पंच आउट छूटा', 'Missed punch-out'], off: ['छुट्टी', 'Off day'], future: ['—', '—'] }[kind];
  document.getElementById('calDay').innerHTML = `
    <div class="worker-summary">
      <b>${dayStr}</b> · ${bi(label[0], label[1])}
      <div class="small">In ${fmtTime(st.inTime)} · Out ${fmtTime(st.outTime)}${st.hours ? ` · ${st.hours} h` : ''}</div>
      ${reg ? `<div class="small muted">Missed-punch request: ${esc(reg.status)}</div>` : ''}
    </div>`;
}
function callSiteHr() {
  const w = window._myWorker;
  // BRD §11 screen 10: the button calls the Site HR at the worker's site; the vendor's
  // number is only a fallback when no Site HR phone is set up yet.
  const phone = (w && w.siteHr && w.siteHr.phone) || (w && w.vendor && w.vendor.phone);
  if (!phone) { toast('No Site HR phone number set up yet — ask your supervisor', 'error'); return; }
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
        <label class="consent-row" style="margin-top:14px"><input type="checkbox" ${voiceOn() ? 'checked' : ''} onchange="setVoice(this.checked)" /><span>🔊 ${bi('आवाज़ में पढ़कर सुनाएँ', 'Read screens aloud')}</span></label>
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
      <button class="btn danger block" onclick="doLogout()">${t('yesLogout')}</button>
      <button class="btn secondary block" onclick="history.back()">${t('noStay')}</button>
    </div>
  `);
}

// ---------------- HR: login ----------------

function startHrLogin() {
  clearSessionData();
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
async function hrRequestOtp(resend) {
  const email = resend ? loginState.email : document.getElementById('hrEmail').value.trim();
  const name = resend ? loginState.name : document.getElementById('hrName').value.trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { toast('Enter a valid email', 'error'); return; }
  try {
    const result = await window.Api.hrOtpRequest(email);
    loginState = { step: 'otp', email, name };
    renderShell(`
      <div class="card center-card">
        <h3>${t('enterOtp')}</h3>
        <p class="muted small">${result.devOtp ? `${t('otpHint')}: ${result.devOtp}` : `OTP sent to ${esc(email)}`}</p>
        <input id="hrOtp" class="input" maxlength="6" inputmode="numeric" autocomplete="one-time-code" />
        ${resendOtpButton("hrRequestOtp(true)", result.resendInSeconds)}
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

// Role dashboards (renderHrDashboard, renderLocationHeadDashboard, renderFinanceDashboard
// and the per-role screens behind them) live in dashboards.js.

async function loadHrContext() {
  const [workers, locations, vendors, punches, regularisations] = await Promise.all([
    fetchIfAllowed('workers.read', () => window.Api.listWorkers()), window.Api.listLocations(), window.Api.listVendors(),
    fetchIfAllowed('punches.read', () => window.Api.listPunches()), fetchIfAllowed('regularisations.read', () => window.Api.listRegularisations()),
  ]);
  return { workers, locations, vendors, punches, regularisations };
}
// ---- Reports (R16, BRD §16): Excel downloads filtered by date, brand, location, vendor, job ----
function renderHrReports() {
  const s = requireHr(); if (!s) return;
  withLoading(() => window.Api.reportFilters(), (opts) => {
    const today = todayStr(Date.now());
    const sel = (id, label, items) => `<label>${label}</label><select id="${id}" class="input"><option value="">All</option>${items.map(i => `<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('')}</select>`;
    renderShell(`
      <div class="card">
        <h3>Reports</h3>
        <p class="muted small">Excel files, limited to the workers you can see.</p>
        ${sel('rf_brand', 'Brand', opts.brands.map(b => ({ id: b, name: b })))}
        ${sel('rf_location', 'Location', opts.locations)}
        ${sel('rf_vendor', 'Vendor', opts.vendors)}
        ${sel('rf_job', 'Job', opts.jobs)}
      </div>
      <div class="card">
        <h3>Day-wise attendance</h3>
        <label>From</label><input id="rf_from" type="date" class="input" value="${today.slice(0, 8)}01" max="${today}" />
        <label>To</label><input id="rf_to" type="date" class="input" value="${today}" max="${today}" />
        <button class="btn primary block" onclick="downloadReport('attendance')">⬇ Attendance (Excel)</button>
      </div>
      <div class="card">
        <h3>Muster roll</h3>
        <label>Month</label><input id="rf_month" type="month" class="input" value="${today.slice(0, 7)}" max="${today.slice(0, 7)}" />
        <button class="btn primary block" onclick="downloadReport('muster')">⬇ Muster roll (Excel)</button>
        ${hasPerm('billing.read') ? `<button class="btn secondary block" onclick="downloadReport('vendor-bill')">⬇ Vendor bill check (Excel)</button>` : ''}
      </div>`);
  });
}
async function downloadReport(kind) {
  const q = new URLSearchParams();
  for (const [k, id] of [['brand', 'rf_brand'], ['locationId', 'rf_location'], ['vendorId', 'rf_vendor'], ['jobId', 'rf_job']]) if (fieldVal(id)) q.set(k, fieldVal(id));
  let path, name;
  if (kind === 'attendance') { q.set('from', fieldVal('rf_from')); q.set('to', fieldVal('rf_to')); path = '/api/reports/attendance.xlsx'; name = `attendance-${fieldVal('rf_from')}-to-${fieldVal('rf_to')}.xlsx`; }
  else { q.set('month', fieldVal('rf_month')); path = `/api/reports/${kind}.xlsx`; name = `${kind}-${fieldVal('rf_month')}.xlsx`; }
  try { await window.Api.downloadCsv(`${path}?${q}`, name); toast('Downloaded ' + name, 'success'); }
  catch (e) { toast(e.message, 'error'); }
}

function renderHrApprovals() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.listWorkers(), window.Api.listReportingManagers()]), ([all, managers]) => {
    window._knownManagers = managers;
    const pending = all.filter(w => w.status === 'pending' || w.status === 'sent_back');
    window._approvalWorkers = pending;
    renderShell(`
      <div class="card">
        <h3>${t('pendingApprovals')}</h3>
        <datalist id="mgrEmails">${managers.map(m => `<option value="${esc(m.email)}">${esc(m.name)}</option>`).join('')}</datalist>
        ${pending.length === 0 ? emptyState('All caught up — no registrations waiting for approval.', 'check') : pending.map(w => `
          <div class="approval-row" id="approvalRow_${w.id}">
            <a href="javascript:void(0)" onclick="viewWorker('${w.id}')">${w.photo_data_url ? `<img src="${w.photo_data_url}" class="thumb" />` : `<div class="thumb placeholder"></div>`}</a>
            <div class="approval-info">
              <b><a href="javascript:void(0)" onclick="viewWorker('${w.id}')" style="color:inherit">${esc(w.name)}</a></b> ${statusBadge(w.status)}<br/>
              <span class="muted small">${esc(w.mobile)} · ${esc(w.designation||'')}</span><br/>
              <span class="muted small">Aadhaar: ${w.aadhaar_verified ? '✅' : '⏳'} · PAN: ${w.pan_verified ? '✅' : '⏳'}</span>
              ${faceCheckLine(w)}
              ${panTamperLine(w)}
              ${w.registered_by ? `<br/><span class="muted small">Registered in person by ${esc(w.registered_by)}</span>` : ""}
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
// R06: result of the server's duplicate/blacklist face check at submit. Anything other
// than a clean "no match" is highlighted so HR compares the photos before approving.
function faceCheckLine(w) {
  if (!w.face_check_note) return '';
  const clean = /^face check: no match/.test(w.face_check_note);
  return `<br/><span class="small" style="color:${clean ? 'var(--ok, #16a34a)' : 'var(--warn, #b45309)'}">${clean ? '✅' : '⚠️'} ${esc(w.face_check_note)}</span>`;
}
// AI document-tamper flag from the PAN photo OCR call — heuristic, never auto-rejects on
// its own, just surfaced here so HR looks at the actual card before approving.
function panTamperLine(w) {
  if (!w.pan_tamper_note) return '';
  return `<br/><span class="small" style="color:var(--warn, #b45309)">⚠️ PAN photo: ${esc(w.pan_tamper_note)}</span>`;
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
  const pw = (window._approvalWorkers || []).find(x => x.id === id) || {};
  // BRD §12: approve only when the checks pass; a face check that isn't clean needs HR to
  // compare the photos and say so (the server enforces this).
  const faceNote = pw.face_check_status && pw.face_check_status !== 'clear'
    ? `<label>Face check: ${esc(pw.face_check_note || 'not run')}</label><input id="faceNote_${id}" class="input" placeholder="I compared the registration photo with the documents — note" />` : '';
  form.innerHTML = reportingManagerFields(id, {}) + faceNote + `
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
  const noteEl = document.getElementById('faceNote_' + id);
  try { await window.Api.approveWorker(id, { ...readManagerFields(id), faceReviewNote: noteEl ? noteEl.value.trim() : undefined }); toast('Approved', 'success'); renderHrApprovals(); }
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
// ---- Transfer / exit requests (proposal process 3) ----
// Managers / Site HR ask; the new site's Site HR accepts a transfer; Central HR completes.
function renderRequestCard(w, locations, vendors) {
  if (!hasPerm('requests.raise') || hasPerm('workers.manage') || w.status !== 'approved') return '';
  return `<div class="card">
    <h3>Request a change</h3>
    <p class="muted small">Central HR carries it out. A move to another site is first accepted by that site's HR.</p>
    <details><summary class="link-btn">Request transfer</summary>
      <label>${t('location')}</label><select id="rq_loc" class="input"><option value="">(same)</option>${locations.filter(l => l.id !== w.location_id).map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
      <label>${t('vendor')}</label><select id="rq_ven" class="input"><option value="">(same)</option>${vendors.filter(v => v.id !== w.vendor_id).map(v => `<option value="${v.id}">${esc(v.name)}</option>`).join('')}</select>
      <label>${t('reason')}</label><input id="rq_treason" class="input" />
      <button class="btn primary small" onclick="raiseRequest('${w.id}', 'transfer')">Send request</button>
    </details>
    <details><summary class="link-btn" style="color:var(--bad, #b91c1c)">Report exit (same day)</summary>
      <label>Last working day</label><input id="rq_date" type="date" class="input" value="${todayStr(Date.now())}" />
      <label>${t('reason')}</label><input id="rq_ereason" class="input" />
      <label class="consent-row"><input type="checkbox" id="rq_bl" /><span>Misconduct — suggest blacklisting</span></label>
      <button class="btn danger small" onclick="raiseRequest('${w.id}', 'exit')">Inform Central HR</button>
    </details>
  </div>`;
}
async function raiseRequest(workerId, type) {
  const body = type === 'transfer'
    ? { workerId, type, toLocationId: fieldVal('rq_loc') || undefined, toVendorId: fieldVal('rq_ven') || undefined, reason: fieldVal('rq_treason').trim() }
    : { workerId, type, exitDate: fieldVal('rq_date'), reason: fieldVal('rq_ereason').trim(), blacklist: document.getElementById('rq_bl').checked };
  try { await window.Api.raiseWorkerRequest(body); toast(type === 'exit' ? 'Central HR informed' : 'Transfer requested', 'success'); renderHrWorkerDetail(); }
  catch (e) { toast(e.message, 'error'); }
}
function renderHrRequests() {
  const s = requireHr(); if (!s) return;
  withLoading(() => window.Api.listWorkerRequests(), (list) => {
    const me = getSession();
    const canComplete = hasPerm('workers.manage');
    const label = { pending: ['badge-warn', 'Waiting for new site'], accepted: ['badge-warn', 'Waiting for Central HR'], done: ['badge-ok', 'Done'], rejected: ['badge-neutral', 'Rejected'] };
    renderShell(`
      <div class="card">
        <h3>Transfer & exit requests</h3>
        ${list.length === 0 ? emptyState('No transfer or exit requests yet.', 'doc') : list.map(r => `
          <div class="worker-summary">
            <b>${esc(r.worker_name)}</b> — ${r.type === 'transfer' ? `transfer ${esc(r.from_location || '')} → ${esc(r.to_location || r.from_location || '')}${r.to_vendor ? ` (vendor ${esc(r.to_vendor)})` : ''}` : `exit${r.exit_date ? ' on ' + esc(r.exit_date) : ''}${r.blacklist_suggested ? ' · blacklist suggested' : ''}`}
            <span class="badge ${label[r.status][0]}">${label[r.status][1]}</span>
            <div class="small muted">${esc(r.reason)} · by ${esc(r.raised_by)} · ${new Date(r.raised_at).toLocaleDateString()}${r.decision_note ? ` · ${esc(r.decision_note)}` : ''}</div>
            <div style="margin-top:6px">
              ${r.status === 'pending' && r.type === 'transfer' && (me.role === 'site_hr' || canComplete) ? `<button class="btn primary small" onclick="requestAction('${r.id}', 'accept')">Accept at new site</button>` : ''}
              ${canComplete && (r.status === 'accepted' || (r.type === 'exit' && r.status === 'pending')) ? `<button class="btn primary small" onclick="requestAction('${r.id}', 'complete')">${r.type === 'exit' ? 'Deactivate worker' : 'Update location'}</button>` : ''}
              ${(r.status === 'pending' || r.status === 'accepted') && (canComplete || me.role === 'site_hr') ? `<button class="btn secondary small" onclick="requestAction('${r.id}', 'reject')">Reject</button>` : ''}
            </div>
          </div>`).join('')}
      </div>`);
  });
}
async function requestAction(id, action) {
  let reason;
  if (action === 'reject') { reason = prompt('Reason for rejecting?'); if (!reason) return; }
  if (action === 'complete' && !confirm('Carry out this request now?')) return;
  try { await window.Api.workerRequestAction(id, action, reason ? { reason } : undefined); toast('Done', 'success'); renderHrRequests(); }
  catch (e) { toast(e.message, 'error'); }
}

// ---- Worker history (BRD §13: "Day-wise in and out time. Selfie and map open on tap.") ----
function renderDayHistory(w, punches) {
  const days = {};
  for (const p of punches) { const d = todayStr(p.ts); (days[d] = days[d] || []).push(p); }
  const keys = Object.keys(days).sort().reverse().slice(0, 31);
  if (!keys.length) return '';
  return `<div class="card">
    <h3>Day-wise history</h3>
    <table class="tbl">
      <thead><tr><th>${t('date')}</th><th>In</th><th>Out</th><th>Hrs</th><th>${t('status')}</th></tr></thead>
      <tbody>${keys.map(d => {
        const st = attendanceStatusForDay(days[d], d);
        const blocked = days[d].filter(p => p.result === 'blocked').length;
        return `<tr onclick="showPunchDay('${d}')" style="cursor:pointer">
          <td>${d}</td><td>${fmtTime(st.inTime)}</td><td>${fmtTime(st.outTime)}</td><td>${st.hours || '-'}</td>
          <td>${statusBadge(st.status)}${blocked ? ` <span class="badge badge-bad">${blocked} blocked</span>` : ''}${days[d].some(p => p.offline) ? ' <span class="badge badge-neutral">offline</span>' : ''}</td></tr>
          <tr><td colspan="5" id="pday_${d}" style="padding:0"></td></tr>`;
      }).join('')}</tbody>
    </table>
    <p class="muted small">Tap a day to see the selfies and where each punch was made.</p>
  </div>`;
}
function showPunchDay(d) {
  const cell = document.getElementById('pday_' + d);
  if (cell.innerHTML) { cell.innerHTML = ''; return; }
  const w = window._histWorker;
  const ps = (window._histPunches || []).filter(p => todayStr(p.ts) === d).sort((a, b) => a.ts - b.ts);
  cell.innerHTML = `<div style="padding:8px">
    <div class="day-detail">${ps.map(p => `<div class="compare-item">
      ${p.selfie_data_url ? `<img src="${p.selfie_data_url}" />` : `<div class="compare-placeholder">${icon('camera')}</div>`}
      <span class="small">${p.type.toUpperCase()} ${fmtTime(p.ts)} ${p.result === 'blocked' ? '⛔ ' + esc(p.reason) : '✅'} ${p.distance_m != null ? p.distance_m + ' m' : ''}</span></div>`).join('')}</div>
    <div id="pmap_${d}" class="day-map"></div></div>`;
  const loc = w && w.location;
  const pts = ps.filter(p => p.lat != null);
  if (!window.L || (!loc && !pts.length)) return;
  const center = loc ? [loc.lat, loc.lng] : [pts[0].lat, pts[0].lng];
  const map = L.map('pmap_' + d, { zoomControl: false, attributionControl: false }).setView(center, 17);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  if (loc) L.circle([loc.lat, loc.lng], { radius: loc.radius, color: '#1e40af', fillOpacity: 0.1 }).addTo(map);
  pts.forEach(p => L.circleMarker([p.lat, p.lng], { radius: 7, color: p.result === 'ok' ? '#16a34a' : '#b91c1c', fillOpacity: 0.9 }).addTo(map).bindPopup(`${p.type} ${fmtTime(p.ts)}`));
  if (pts.length) map.fitBounds(L.latLngBounds([...(loc ? [[loc.lat, loc.lng]] : []), ...pts.map(p => [p.lat, p.lng])]).pad(0.4));
  setTimeout(() => map.invalidateSize(), 100);
}

// ---- R14: transfer / exit / blacklist, and R03 phone change ----
// Every action needs a reason; the server records it in the worker's history.
function renderManageWorkerCard(w, locations, vendors) {
  if (w.status === 'exited') {
    return `<div class="card"><h3>Manage worker</h3><p class="muted">Exited on ${esc(w.exit_date || '?')} — ${esc(w.exit_reason || '')}${w.blacklisted ? ' · <b>Blacklisted</b>' : ''}</p></div>`;
  }
  const approved = w.status === 'approved';
  return `
    <div class="card">
      <h3>Manage worker</h3>
      ${approved ? `
      <details><summary class="link-btn">Transfer to another location / vendor</summary>
        <label>${t('location')}</label>
        <select id="tr_location" class="input">${locations.map(l => `<option value="${l.id}" ${l.id === w.location_id ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select>
        <label>${t('vendor')}</label>
        <select id="tr_vendor" class="input">${vendors.map(v => `<option value="${v.id}" ${v.id === w.vendor_id ? 'selected' : ''}>${esc(v.name)}</option>`).join('')}</select>
        <label>${t('reason')}</label><input id="tr_reason" class="input" />
        <button class="btn primary small" onclick="hrTransfer('${w.id}')">Transfer</button>
      </details>` : ''}
      ${w.device_id ? `
      <details><summary class="link-btn">Approve phone change</summary>
        <p class="muted small">Clears the registered phone. The worker's next punch registers their new phone.</p>
        <label>${t('reason')}</label><input id="dev_reason" class="input" placeholder="e.g. phone lost, new phone" />
        <button class="btn warn small" onclick="hrResetDevice('${w.id}')">Clear registered phone</button>
      </details>` : ''}
      <details><summary class="link-btn" style="color:var(--bad, #b91c1c)">Exit worker</summary>
        <label>Exit date</label><input id="ex_date" type="date" class="input" value="${todayStr(Date.now())}" />
        <label>${t('reason')}</label><input id="ex_reason" class="input" />
        <label class="consent-row"><input type="checkbox" id="ex_blacklist" /><span>Blacklist (misconduct) — this Aadhaar, PAN and face can never register again, through any vendor</span></label>
        <button class="btn danger small" onclick="hrExit('${w.id}')">Exit worker</button>
      </details>
    </div>`;
}
const fieldVal = id => (document.getElementById(id) || {}).value || '';
async function hrTransfer(id) {
  try {
    await window.Api.transferWorker(id, { locationId: fieldVal('tr_location'), vendorId: fieldVal('tr_vendor'), reason: fieldVal('tr_reason').trim() });
    toast('Transferred', 'success'); renderHrWorkerDetail();
  } catch (e) { toast(e.message, 'error'); }
}
async function hrResetDevice(id) {
  try { await window.Api.resetWorkerDevice(id, fieldVal('dev_reason').trim()); toast('Phone cleared', 'success'); renderHrWorkerDetail(); }
  catch (e) { toast(e.message, 'error'); }
}
async function hrExit(id) {
  const blacklist = document.getElementById('ex_blacklist').checked;
  if (!confirm(blacklist ? 'Exit AND blacklist this worker? They can never register again.' : 'Exit this worker? They will not be able to punch.')) return;
  try {
    await window.Api.exitWorker(id, { exitDate: fieldVal('ex_date'), reason: fieldVal('ex_reason').trim(), blacklist });
    toast('Worker exited', 'success'); renderHrWorkerDetail();
  } catch (e) { toast(e.message, 'error'); }
}

// ---- Workers directory: every worker in the caller's scope, searchable, any status ----
function renderHrWorkers() {
  const s = requireHr(); if (!s) return;
  withLoading(() => window.Api.listWorkers(), (all) => {
    window._allWorkers = all;
    renderShell(`
      <div class="card">
        <h3>Workers</h3>
        <input id="wk_search" class="input" placeholder="Search name or mobile" oninput="filterWorkerList()" />
        <div class="filter-row">
          <select id="wk_status" class="input" onchange="filterWorkerList()">
            ${['', 'approved', 'pending', 'sent_back', 'draft', 'exited', 'rejected'].map(st => `<option value="${st}">${st ? st.replace('_', ' ') : 'All statuses'}</option>`).join('')}
          </select>
          <select id="wk_vendor" class="input" onchange="filterWorkerList()">
            <option value="">All vendors</option>
            ${[...new Set((window._allWorkers || []).map(w => w.vendor_name).filter(Boolean))].sort().map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('')}
          </select>
        </div>
        <div id="wk_count" class="muted small" style="margin:-6px 0 8px"></div>
        <div id="wk_list"></div>
      </div>`);
    filterWorkerList();
  });
}
function filterWorkerList() {
  const q = fieldVal('wk_search').trim().toLowerCase();
  const st = fieldVal('wk_status'), ven = fieldVal('wk_vendor');
  const rows = (window._allWorkers || []).filter(w => (!st || w.status === st) && (!ven || w.vendor_name === ven) && (!q || (w.name || '').toLowerCase().includes(q) || (w.mobile || '').includes(q)));
  const countEl = document.getElementById('wk_count');
  if (countEl) countEl.textContent = `${rows.length} worker${rows.length === 1 ? '' : 's'}${ven ? ` from ${ven}` : ''}`;
  document.getElementById('wk_list').innerHTML = rows.length === 0 ? emptyState('No workers match these filters.', 'user') : rows.map(w => `
    <div class="approval-row">
      <a href="javascript:void(0)" onclick="viewWorker('${w.id}')">${thumbHtml(w.photo_data_url)}</a>
      <div class="approval-info">
        <b><a href="javascript:void(0)" onclick="viewWorker('${w.id}')" style="color:inherit">${esc(w.name || w.mobile)}</a></b> ${statusBadge(w.status)} ${w.blacklisted ? '<span class="badge badge-bad">Blacklisted</span>' : ''}<br/>
        <span class="muted small">${w.name ? esc(w.mobile) + (w.designation ? ' · ' + esc(w.designation) : '') : 'Registration not completed'}</span>
        ${w.vendor_name || w.location_name ? `<br/><span class="small"><span class="icon-inline">${icon('building')}</span>${esc(w.vendor_name || 'No vendor')}${w.location_name ? ` <span class="muted">· ${esc(w.location_name)}</span>` : ''}</span>` : ''}
      </div>
    </div>`).join('');
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
async function checkAbsenteeismRisk(id) {
  const el = document.getElementById('absRiskResult');
  if (!el) return;
  el.innerHTML = spinnerRow('Reading attendance pattern…');
  try {
    const r = await window.Api.absenteeismRisk(id);
    const color = r.level === 'high' ? 'var(--bad, #b91c1c)' : r.level === 'medium' ? 'var(--warn, #b45309)' : 'var(--accent, #19a974)';
    el.innerHTML = `<div class="gps-status" style="border-color:${color}">
      <b style="color:${color};text-transform:uppercase">${esc(r.level)} risk</b> — present ${r.presentDays}/${r.totalDays} days<br/>
      <span class="small">${esc(r.reason)}</span>
    </div>`;
  } catch (e) { el.innerHTML = errorState(e.message); }
}

function renderHrWorkerDetail() {
  const s = requireHr(); if (!s) return;
  const id = window._viewWorkerId;
  if (!id) { location.hash = '#/hr/workers'; render(); return; }
  withLoading(
    () => Promise.all([
      window.Api.getWorkerById(id), window.Api.listPunches({ workerId: id }), window.Api.workerHistory(id),
      (hasPerm('workers.manage') || hasPerm('requests.raise')) ? Promise.all([window.Api.listLocations(), window.Api.listVendors()]) : Promise.resolve([[], []]),
    ]),
    ([w, punches, history, [locations, vendors]]) => {
      window._histWorker = w; window._histPunches = punches;
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
          <div style="margin-top:10px">${statusBadge(w.status)} ${w.aadhaar_verified ? '<span class="badge badge-ok">Aadhaar ✓</span>' : '<span class="badge badge-warn">Aadhaar pending</span>'} ${w.pan_verified ? '<span class="badge badge-ok">PAN ✓</span>' : '<span class="badge badge-warn">PAN pending</span>'} ${w.blacklisted ? '<span class="badge badge-bad">Blacklisted</span>' : ''}${faceCheckLine(w)}${panTamperLine(w)}</div>
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
        ${hasPerm('workers.manage') ? renderManageWorkerCard(w, locations, vendors) : ''}
        ${renderRequestCard(w, locations, vendors)}
        <div class="card">
          <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('sparkle')}</span>AI attendance risk</h3>
          <p class="muted small">Reads this worker's last 30 days for a trend or pattern — not a prediction, just a pattern read. Runs only when you ask, not automatically.</p>
          <div id="absRiskResult"></div>
          <button class="btn secondary small" onclick="checkAbsenteeismRisk('${w.id}')">Check now</button>
        </div>
        <div class="card">
          <h3>History</h3>
          ${history.length === 0 ? `<p class="muted small">No transfers, exits or other changes yet.</p>` : `
          <table class="tbl">
            <thead><tr><th>${t('date')}</th><th>Change</th><th>${t('reason')}</th><th>By</th></tr></thead>
            <tbody>${history.map(e => `<tr><td class="small">${new Date(e.ts).toLocaleString()}</td><td class="wrap">${esc(e.detail)}</td><td class="wrap">${esc(e.reason || '')}</td><td class="small">${esc(e.by_user || '')}</td></tr>`).join('')}</tbody>
          </table>`}
        </div>
        ${renderDayHistory(w, punches)}
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
                ${p.result === 'blocked' ? `<span class="badge badge-bad">${esc(reasonLabel(p.reason))}</span>` : ''}
                <span class="muted small">${new Date(p.ts).toLocaleString()}</span>
                ${p.distance_m != null ? `<span class="muted small"> · ${p.distance_m}m</span>` : ''}
              </div>
              ${aiNoteHtml(p.face_match_note)}
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

const REG_CATEGORY_LABELS = { medical: 'Medical', personal: 'Personal', official_travel: 'Official travel', technical_device: 'Device/network', forgot_punch: 'Forgot to punch', other: 'Other' };
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
          ${sorted.length === 0 ? emptyState('No regularisation requests yet.', 'doc') : sorted.map(r => `
            <div class="approval-row">
              <div class="approval-info">
                <b><a href="javascript:void(0)" onclick="viewWorker('${r.worker_id}')" style="color:inherit">${esc(nameById[r.worker_id]||r.worker_id)}</a></b>
                <span class="muted small"> · ${r.date}</span> ${statusBadge(r.status)}
                <div style="margin-top:4px">${esc(r.reason)}${r.reason_category ? ` <span class="badge badge-neutral">${esc(REG_CATEGORY_LABELS[r.reason_category] || r.reason_category)}</span>` : ''}</div>
                ${r.ai_triage_note ? `<div class="muted small" style="margin-top:4px">🧠 ${esc(r.ai_triage_note)}</div>` : ''}
                <div class="muted small" style="margin-top:4px">Raised by ${esc(r.maker)}${r.checker ? ` · ${r.status} by ${esc(r.checker)}` : ''}</div>
              </div>
              ${r.status === 'pending' && hasPerm('regularisations.decide') ? `<div class="approval-actions">
                <button class="btn primary small" onclick="hrDecideReg('${r.id}','approved')">${t('approve')}</button>
                <button class="btn danger small" onclick="hrDecideReg('${r.id}','rejected')">${t('reject')}</button>
              </div>` : ''}
            </div>`).join('')}
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
    () => Promise.all([window.Api.listPunches({ result: 'blocked' }), window.Api.listPunches({ minRisk: 20 })]),
    ([blocked, risky]) => {
      // worker_name comes joined in from the server, so Security (no worker-list
      // access) still sees whose attempt it was; only roles that can open a worker
      // record get the name as a link.
      const canView = hasPerm('workers.read');
      const sorted = [...blocked].sort((a, b) => b.ts - a.ts);
      const riskyOnly = risky.filter(p => p.result === 'ok').sort((a, b) => b.risk_score - a.risk_score);
      const nameLink = (p) => canView ? `<a href="javascript:void(0)" onclick="viewWorker('${p.worker_id}')" style="color:inherit">${esc(p.worker_name||p.worker_id)}</a>` : esc(p.worker_name||p.worker_id);
      renderShell(`
        <div class="card">
          <h3>${t('hrExceptions')}</h3>
          ${sorted.length === 0 ? emptyState('No blocked punches — every attempt passed its checks.', 'shield') : sorted.map(p => `
            <div class="approval-row">
              ${thumbHtml(p.selfie_data_url)}
              <div class="approval-info">
                <b>${nameLink(p)}</b> — ${p.type.toUpperCase()} <span class="badge badge-bad">${esc(reasonLabel(p.reason))}</span><br/>
                <span class="muted small">${new Date(p.ts).toLocaleString()} · GPS ±${p.accuracy != null ? Math.round(p.accuracy) : '?'}m · ${p.distance_m!=null?p.distance_m+'m from site':''}</span>
                ${aiNoteHtml(p.face_match_note)}
              </div>
            </div>
          `).join('')}
        </div>
        <div class="card">
          <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('sparkle')}</span>AI risk triage</h3>
          <p class="muted small">Punches that were allowed — every check passed — but borderline on something. Worth a glance, not a block.</p>
          ${riskyOnly.length === 0 ? emptyState('Nothing flagged', 'shield') : riskyOnly.map(p => `
            <div class="approval-row">
              ${thumbHtml(p.selfie_data_url)}
              <div class="approval-info">
                <b>${nameLink(p)}</b> — ${p.type.toUpperCase()} <span class="badge ${p.risk_score >= 50 ? 'badge-bad' : 'badge-warn'}">risk ${p.risk_score}</span><br/>
                <span class="muted small">${new Date(p.ts).toLocaleString()} · ${esc(p.risk_reasons || '')}</span>
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
    () => Promise.all([window.Api.listVendors(), window.Api.listLocations(), window.Api.listJobs()]),
    ([vendors, locations, jobs]) => {
      window._hrVendors = vendors; window._hrLocations = locations;
      renderShell(`
        <div class="card">
          <h3>Vendors</h3>
          <table class="tbl">
            <thead><tr><th>${t('name')}</th><th>GSTIN</th><th>Contact</th><th>Contract</th><th></th></tr></thead>
            <tbody>${vendors.map(v => `<tr>
              <td>${esc(v.name)}${v.status === 'inactive' ? ' <span class="badge badge-neutral">Inactive</span>' : ''}</td>
              <td>${esc(v.gstin||'')}</td>
              <td>${esc(v.contact_person||'')}${v.phone ? `<br/><span class="muted small">${esc(v.phone)}</span>` : ''}${vendorKycBadge(v)}</td>
              <td>${contractCell(v)}</td>
              <td><button class="btn secondary small" onclick="startEditVendor('${v.id}')">Edit</button></td>
            </tr>`).join('')}</tbody>
          </table>
          ${editingVendor ? renderVendorForm() : `<button class="btn primary small" onclick="startEditVendor(null)">${t('addVendor')}</button>`}
        </div>
        <div class="card">
          <h3>Jobs</h3>
          <p class="muted small">The choices a worker sees at registration (BRD screen 8). Retired jobs stay on existing workers.</p>
          <table class="tbl">${jobs.map(j => `<tr><td>${esc(j.icon || '')}</td><td>${esc(j.name)}<br/><span class="muted small">${esc(j.name_hi || '')}</span></td>
            <td>${j.active ? '' : '<span class="badge badge-neutral">Retired</span>'}</td>
            <td><button class="btn secondary small" onclick="toggleJob('${j.id}', ${j.active ? 0 : 1})">${j.active ? 'Retire' : 'Restore'}</button></td></tr>`).join('')}</table>
          <details><summary class="link-btn">Add job</summary>
            <label>Name (English)</label><input id="nj_name" class="input" />
            <label>Name (Hindi)</label><input id="nj_hi" class="input" />
            <label>Icon (emoji)</label><input id="nj_icon" class="input" maxlength="4" />
            <button class="btn primary small" onclick="addJob()">${t('save')}</button>
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
      <label>Weekly off (shown grey on workers' calendars)</label>
      <select id="el_off" class="input"><option value="">None</option>${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((d, i) => `<option value="${i}" ${l.weekly_off === i ? 'selected' : ''}>${d}</option>`).join('')}</select>
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
      weeklyOff: document.getElementById('el_off').value === '' ? null : Number(document.getElementById('el_off').value),
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
// ---- Jobs master (BRD §10 screen 8) ----
async function addJob() {
  const name = fieldVal('nj_name').trim();
  if (!name) { toast('Name required', 'error'); return; }
  try { await window.Api.createJob({ name, nameHi: fieldVal('nj_hi').trim(), icon: fieldVal('nj_icon').trim() }); toast('Job added', 'success'); renderHrMasters(); }
  catch (e) { toast(e.message, 'error'); }
}
async function toggleJob(id, active) {
  try { await window.Api.updateJob(id, { active: !!active }); renderHrMasters(); } catch (e) { toast(e.message, 'error'); }
}

// ---- Vendors (R01: name, GSTIN, contact, contract dates) ----
function contractCell(v) {
  if (!v.contract_start && !v.contract_end) return '<span class="muted small">not set</span>';
  const today = todayStr(Date.now());
  const soon = todayStr(Date.now() + 30 * 86400000);
  let badge = '';
  if (v.contract_end && v.contract_end < today) badge = '<span class="badge badge-bad">Expired</span>';
  else if (v.contract_start && v.contract_start > today) badge = '<span class="badge badge-neutral">Not started</span>';
  else if (v.contract_end && v.contract_end <= soon) badge = '<span class="badge badge-warn">Ends soon</span>';
  return `<span class="small">${esc(v.contract_start || '?')} → ${esc(v.contract_end || '?')}</span> ${badge}`;
}
let editingVendor = null; // null = closed; {} = new; {...row} = editing
function startEditVendor(id) {
  editingVendor = id ? { ...(window._hrVendors || []).find(v => v.id === id) } : {};
  vendorKyc = {};
  renderHrMasters();
}
function renderVendorForm() {
  const v = editingVendor;
  return `
    <div class="worker-summary">
      <h3>${v.id ? 'Edit: ' + esc(v.name) : t('addVendor')}</h3>
      <label>${t('name')}</label><input id="nv_name" class="input" value="${esc(v.name || '')}" />
      <label>GSTIN</label><input id="nv_gstin" class="input" maxlength="15" style="text-transform:uppercase" value="${esc(v.gstin || '')}" />
      <label>PAN</label><input id="nv_pan" class="input" maxlength="10" style="text-transform:uppercase" value="${esc(v.pan || '')}" />
      <label>Contact person</label><input id="nv_contact" class="input" value="${esc(v.contact_person || '')}" />
      <label>Contact phone</label><input id="nv_phone" class="input" maxlength="10" inputmode="numeric" value="${esc(v.phone || '')}" />
      <label>Contract start</label><input id="nv_cstart" type="date" class="input" value="${esc(v.contract_start || '')}" />
      <label>Contract end</label><input id="nv_cend" type="date" class="input" value="${esc(v.contract_end || '')}" />
      ${v.id ? `<label>${t('status')}</label><select id="nv_status" class="input">
        <option value="active" ${v.status !== 'inactive' ? 'selected' : ''}>Active</option>
        <option value="inactive" ${v.status === 'inactive' ? 'selected' : ''}>Inactive (no new registrations)</option></select>` : ''}
      ${renderVendorContactKyc(v)}
      <div class="wizard-actions">
        <button class="btn secondary" onclick="startEditVendorCancel()">${t('cancel')}</button>
        <button class="btn primary" onclick="saveVendor()">${t('save')}</button>
      </div>
    </div>`;
}
// Contact person's Aadhaar/PAN — Aadhaar is an individual document, so this verifies
// the vendor's authorized contact, not the company (the company itself is identified
// by GSTIN/PAN above). Same OCR/QR-scan pattern as worker KYC (regPanPhoto/regScanAadhaar),
// but captured by HR here instead of self-serve by the person.
function renderVendorContactKyc(v) {
  return `
    <h4 style="margin-top:16px">Contact person KYC (${esc(v.contact_person || 'authorized contact')})</h4>
    <p class="muted small">Aadhaar + PAN of the vendor's contact person — not the company (Aadhaar only exists for individuals).</p>
    <div class="kyc-status ${v.contact_aadhaar_qr_at ? 'ok' : ''}">${v.contact_aadhaar_qr_at ? `✅ Aadhaar scanned — ${esc(v.contact_aadhaar_masked || '')}${v.contact_aadhaar_name ? ` · ${esc(v.contact_aadhaar_name)}` : ''}` : '⏳ Aadhaar not scanned yet'}</div>
    ${vendorKyc.qrHelp ? `<div class="gps-status warn" style="margin-top:8px">The live scanner couldn't read it (the Aadhaar QR is very dense). Use the photo button — that one works.</div>` : ''}
    <button class="btn secondary block" onclick="vendorPhotoAadhaarQr()">📷 ${v.contact_aadhaar_qr_at ? 'Take the photo again' : 'Take a photo of the Aadhaar QR'}</button>
    <button class="link-btn small" onclick="vendorScanAadhaar()">Try the live scanner instead</button>

    <div class="kyc-status ${v.contact_pan_verified ? 'ok' : ''}" style="margin-top:12px">${v.contact_pan_verified ? '✅ PAN verified' : (v.contact_pan_number ? '⏳ PAN read, not yet verified' : '⏳ PAN not read yet')}</div>
    ${v.contact_pan_photo_data_url ? `<img src="${esc(v.contact_pan_photo_data_url)}" class="selfie-preview" style="border-radius:8px;max-height:140px" />` : ''}
    ${v.contact_pan_number ? `<div class="kyc-status">PAN read from photo: <b>${esc(v.contact_pan_number)}</b>${v.contact_pan_name ? ` · ${esc(v.contact_pan_name)}` : ''}</div>` : ''}
    ${v.contact_pan_tamper_note ? `<div class="gps-status bad">⚠️ Possible tampering: ${esc(v.contact_pan_tamper_note)}</div>` : ''}
    <button class="btn secondary block" onclick="vendorPanPhoto()">📷 ${v.contact_pan_photo_data_url ? 'Retake PAN photo' : 'Take photo of PAN card'}</button>
    ${v.contact_pan_number && !v.contact_pan_verified ? `<button class="btn primary block" onclick="vendorVerifyPan()">Verify this PAN</button>` : ''}`;
}
function vendorKycBadge(v) {
  if (v.contact_pan_tamper_note) return `<br/><span class="small" style="color:var(--warn, #b45309)">⚠️ PAN tamper flag</span>`;
  const aadhaarOk = !!v.contact_aadhaar_qr_at, panOk = !!v.contact_pan_verified;
  if (aadhaarOk && panOk) return `<br/><span class="small" style="color:var(--accent, #19a974)">✅ Contact KYC done</span>`;
  if (aadhaarOk || v.contact_pan_number) return `<br/><span class="small muted">⏳ Contact KYC partial</span>`;
  return '';
}
let vendorKyc = {};
async function vendorPanPhoto() {
  const photo = await window.TSGNative.takeDocumentPhoto();
  if (!photo.ok) { toast('Camera failed: ' + photo.error, 'error'); return; }
  toast('Reading PAN card…', 'info');
  try {
    const r = await window.Api.vendorPanPhoto(await shrinkDataUrl(photo.dataUrl, 1600, 0.85));
    Object.assign(editingVendor, {
      contact_pan_photo_data_url: photo.dataUrl, contact_pan_number: r.panNumber, contact_pan_name: r.nameOnCard,
      contact_pan_tamper_note: r.tamperNote || null, contact_pan_verified: 0,
    });
    renderHrMasters();
  } catch (e) { toast(e.message, 'error'); }
}
async function vendorVerifyPan() {
  try {
    // vendorId lets the server persist the verified flag straight to the row (only it
    // can — see readVendor in masters.js); for a brand-new vendor not saved yet, there's
    // no row to persist to, so this only reflects locally until saved and re-verified.
    const r = await window.Api.vendorPanVerify(editingVendor.contact_pan_number, editingVendor.contact_aadhaar_name, editingVendor.id);
    editingVendor.contact_pan_verified = r.verified ? 1 : 0;
    if (r.fullName) editingVendor.contact_pan_name = r.fullName;
    toast(r.warning || 'PAN verified', r.warning ? 'error' : 'success');
    renderHrMasters();
  } catch (e) { toast(e.message, 'error'); }
}
async function vendorScanAadhaar() {
  const scan = await window.TSGNative.scanQrCode();
  if (!scan.ok) {
    vendorKyc.qrHelp = true;
    if (!scan.cancelled) toast(scan.error, 'error');
    renderHrMasters();
    return;
  }
  try { vendorAadhaarQrAccepted(await window.Api.vendorAadhaarQr(scan.text)); } catch (e) { toast(e.message, 'error'); }
}
async function vendorPhotoAadhaarQr() {
  const r = await window.TSGNative.scanQrFromPhoto();
  if (r.cancelled) return;
  toast('Reading the QR…', 'info');
  try {
    if (r.ok) return vendorAadhaarQrAccepted(await window.Api.vendorAadhaarQr(r.text));
    if (r.dataUrl) return vendorAadhaarQrAccepted(await window.Api.vendorAadhaarQrImage(r.dataUrl));
    toast(r.error || 'Could not take the photo', 'error');
  } catch (e) { toast(e.message, 'error'); }
}
function vendorAadhaarQrAccepted(result) {
  vendorKyc.qrHelp = false;
  Object.assign(editingVendor, {
    contact_aadhaar_masked: result.maskedNumber, contact_aadhaar_key: result.aadhaarKey, contact_aadhaar_name: result.name,
    contact_aadhaar_qr_format: result.format, contact_aadhaar_qr_signature: result.signature, contact_aadhaar_qr_at: Date.now(),
  });
  toast(result.warning || `Aadhaar scanned (${result.maskedNumber})`, result.warning ? 'error' : 'success');
  renderHrMasters();
}
function startEditVendorCancel() { editingVendor = null; renderHrMasters(); }
async function saveVendor() {
  const val = id => { const el = document.getElementById(id); return el ? el.value.trim() : undefined; };
  const body = {
    name: val('nv_name'), gstin: val('nv_gstin'), pan: val('nv_pan'), contactPerson: val('nv_contact'), phone: val('nv_phone'),
    contractStart: val('nv_cstart'), contractEnd: val('nv_cend'), status: val('nv_status'),
    contactPanPhotoDataUrl: editingVendor.contact_pan_photo_data_url, contactPanNumber: editingVendor.contact_pan_number,
    contactPanName: editingVendor.contact_pan_name, contactPanTamperNote: editingVendor.contact_pan_tamper_note,
    // contact_pan_verified is deliberately NOT sent — the server never accepts it from
    // the client (see readVendor in masters.js); it can only be set via a real
    // /vendor-kyc/pan-verify call, which persists it server-side directly.
    contactAadhaarMasked: editingVendor.contact_aadhaar_masked, contactAadhaarKey: editingVendor.contact_aadhaar_key,
    contactAadhaarName: editingVendor.contact_aadhaar_name, contactAadhaarQrFormat: editingVendor.contact_aadhaar_qr_format,
    contactAadhaarQrSignature: editingVendor.contact_aadhaar_qr_signature, contactAadhaarQrAt: editingVendor.contact_aadhaar_qr_at,
  };
  if (!body.name) { toast('Name required', 'error'); return; }
  try {
    if (editingVendor.id) await window.Api.updateVendor(editingVendor.id, body);
    else await window.Api.createVendor(body);
    toast('Vendor saved', 'success');
    editingVendor = null;
    renderHrMasters();
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

// ---------------- Gate check (proposal: "No HR approval, no entry") ----------------
// Security looks a person up at the gate: big green ALLOWED / red NOT ALLOWED with the
// registered photo to compare against the face in front of them.
function renderHrGate() {
  const s = requireHr(); if (!s) return;
  renderShell(`
    <div class="card">
      <h3>Gate check</h3>
      <p class="muted small">No HR approval, no entry. Search by mobile number or name, then compare the photo with the person.</p>
      <input id="gate_q" class="input" placeholder="Mobile or name" onkeydown="if(event.key==='Enter')gateSearch()" />
      <button class="btn primary block" onclick="gateSearch()">Check</button>
      <div id="gate_results"></div>
    </div>`);
}
async function gateSearch() {
  const el = document.getElementById('gate_results');
  el.innerHTML = spinnerRow('Checking…');
  try {
    const rows = await window.Api.gateCheck(fieldVal('gate_q').trim());
    el.innerHTML = rows.length === 0 ? `<div class="gps-status bad" style="font-size:18px">❌ Not registered — no entry</div>` : rows.map(r => `
      <div class="worker-summary" style="border-left:6px solid ${r.entryAllowed ? 'var(--ok, #16a34a)' : 'var(--bad, #b91c1c)'}">
        <div class="profile-header">
          ${r.photo ? `<img src="${r.photo}" class="avatar" style="width:72px;height:72px" />` : `<div class="avatar">?</div>`}
          <div class="profile-text">
            <h3>${esc(r.name || '—')}</h3>
            <div class="muted small">…${esc(r.mobileLast4)} · ${esc(r.vendor || '')} · ${esc(r.location || '')} · ${esc(r.designation || '')}</div>
          </div>
        </div>
        <div style="font-size:20px;font-weight:700;margin-top:8px;color:${r.entryAllowed ? 'var(--ok, #16a34a)' : 'var(--bad, #b91c1c)'}">
          ${r.entryAllowed ? '✅ ENTRY ALLOWED' : `❌ NO ENTRY — ${r.blacklisted ? 'blacklisted' : r.status === 'exited' ? 'exited' : 'not approved by HR'}`}
        </div>
      </div>`).join('');
  } catch (e) { el.innerHTML = ''; toast(e.message, 'error'); }
}

// ---------------- Gate tablet / kiosk (R20: face punch for workers without phones) ----------------
// Paired once with a code from HR. Worker types the last 4 digits of their mobile, taps
// their own photo, looks at the camera. The server checks the face positively matches.
function renderKioskPair() {
  renderShell(`
    <div class="card center-card">
      <h3>🖥️ Gate tablet setup</h3>
      <p class="muted small">Enter the 6-digit pairing code from HR (More → Gate tablets). This tablet then stays on this site's punch screen.</p>
      <input id="kp_code" class="input" maxlength="6" inputmode="numeric" />
      <button class="btn primary block" onclick="kioskPairNow()">Pair this tablet</button>
      <button class="link-btn small" onclick="location.hash='#/';render()">${t('back')}</button>
    </div>`);
}
async function kioskPairNow() {
  try {
    const r = await window.Api.kioskPair(fieldVal('kp_code').trim());
    setSessionData({ token: r.token, role: 'kiosk', kiosk: r.kiosk });
    location.hash = '#/kiosk'; render();
  } catch (e) { toast(e.message, 'error'); }
}
let kioskState = { digits: '' };
function renderKiosk() {
  const s = getSession();
  if (!s || s.role !== 'kiosk') { location.hash = '#/'; render(); return; }
  kioskState = { digits: '' };
  speak('अपने मोबाइल नंबर के आख़िरी चार अंक दबाएँ', 'Type the last 4 digits of your mobile number');
  renderKioskKeypad();
}
function renderKioskKeypad() {
  const s = getSession();
  const d = kioskState.digits;
  renderShell(`
    <div class="card center-card kiosk">
      <div class="muted">${esc(s.kiosk.name)} · ${esc(s.kiosk.location ? s.kiosk.location.name : '')}</div>
      <h3>${bi('मोबाइल नंबर के आख़िरी 4 अंक', 'Last 4 digits of your mobile')}</h3>
      <div class="kiosk-digits">${[0, 1, 2, 3].map(i => `<span>${d[i] || ''}</span>`).join('')}</div>
      <div class="kiosk-pad">${['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', '✓'].map(k => `<button class="btn ${k === '✓' ? 'success' : 'secondary'}" onclick="kioskKey('${k}')">${k}</button>`).join('')}</div>
    </div>`);
}
async function kioskKey(k) {
  if (k === '⌫') kioskState.digits = kioskState.digits.slice(0, -1);
  else if (k === '✓') { if (kioskState.digits.length === 4) return kioskFind(); }
  else if (kioskState.digits.length < 4) kioskState.digits += k;
  renderKioskKeypad();
  if (kioskState.digits.length === 4) kioskFind();
}
async function kioskFind() {
  try {
    const list = await window.Api.kioskCandidates(kioskState.digits);
    if (!list.length) { showResult(false, 'नंबर नहीं मिला', 'Not found', [bi('इस साइट पर इस नंबर का कोई कर्मचारी नहीं', 'No worker at this site with that number')], renderKiosk); return; }
    speak('अपनी फोटो पर टैप करें', 'Tap your photo');
    renderShell(`
      <div class="card center-card kiosk">
        <h3>${bi('अपनी फोटो पर टैप करें', 'Tap your photo')}</h3>
        <div class="tile-grid">${list.map(c => `
          <button class="tile" ${c.next === 'done' ? 'disabled' : ''} onclick="kioskPunch('${c.id}', '${c.next}')">
            ${c.photo ? `<img src="${c.photo}" class="avatar" style="width:90px;height:90px" />` : `<span class="tile-icon">🙂</span>`}
            <span class="tile-hi">${esc(c.firstName)}</span>
            <span class="tile-en">${c.next === 'in' ? 'Punch in' : c.next === 'out' ? 'Punch out' : 'Day complete'}</span>
          </button>`).join('')}</div>
        <button class="btn secondary block" onclick="renderKiosk()">${t('back')}</button>
      </div>`);
  } catch (e) { if (e.status === 401) { clearSessionData(); location.hash = '#/'; render(); } toast(e.message, 'error'); renderKiosk(); }
}
async function kioskPunch(workerId, next) {
  const selfie = await scanFaceForPunch();
  if (!selfie.ok) { if (!selfie.cancelled) toast(selfie.error, 'error'); return renderKiosk(); }
  renderShell(`<div class="card center-card">${spinnerRow(t('checkingLocation'))}</div>`);
  const pos = await window.TSGNative.getPosition();
  if (!pos.ok) return showResult(false, 'लोकेशन नहीं मिली', 'Location not available', [pos.error], renderKiosk);
  const integrity = window.TSGNative.mockLocationCheck ? await window.TSGNative.mockLocationCheck() : { ok: false };
  try {
    const r = await window.Api.kioskPunch({ workerId, lat: pos.lat, lng: pos.lng, accuracy: pos.accuracy, selfieDataUrl: await shrinkDataUrl(selfie.dataUrl, 960, 0.8),
      integrity: integrity.ok ? { mock: !!integrity.mock, legacyMockSetting: !!integrity.legacyMockSetting } : null });
    const el = showResult(true, r.type === 'in' ? 'पंच इन हो गया' : 'पंच आउट हो गया', r.type === 'in' ? 'Punched in' : 'Punched out', [esc(r.worker), `${bi('समय', 'Time')}: <b>${fmtTime(r.ts)}</b>`], renderKiosk);
    setTimeout(() => { if (el.isConnected) el.querySelector('.result-close').onclick(); }, 6000); // next person
  } catch (e) {
    const d = e.data || {};
    const [hi, en] = BLOCK_REASON[d.reason] || ['पंच नहीं हुआ', 'Punch not saved'];
    const el = showResult(false, hi, en, [esc(e.message)], renderKiosk);
    setTimeout(() => { if (el.isConnected) el.querySelector('.result-close').onclick(); }, 8000);
  }
}

// Admin: set up gate tablets (kiosks.manage).
function renderHrKiosks() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.listKiosks(), window.Api.listLocations()]), ([kiosks, locations]) => {
    renderShell(`
      <div class="card">
        <h3>Gate tablets</h3>
        <p class="muted small">A tablet at the gate lets workers without a phone punch with their face (R20). Pair it with the code shown here; the code works once, for 24 hours.</p>
        ${window._newKioskCode ? `<div class="gps-status ok">Pairing code for <b>${esc(window._newKioskCode.name)}</b>: <b style="font-size:24px;letter-spacing:4px">${window._newKioskCode.code}</b><br/><span class="small">On the tablet: open the app → Gate tablet (kiosk) → enter this code.</span></div>` : ''}
        <table class="tbl">${kiosks.map(k => `<tr><td>${esc(k.name)}<br/><span class="muted small">${esc(k.location_name || '')}</span></td>
          <td>${k.status === 'active' ? (k.paired_at ? '<span class="badge badge-ok">Paired</span>' : '<span class="badge badge-warn">Waiting for pairing</span>') : '<span class="badge badge-neutral">Retired</span>'}</td>
          <td><button class="btn secondary small" onclick="kioskNewCode('${k.id}', '${esc(k.name)}')">New code</button>
          ${k.status === 'active' ? `<button class="btn danger small" onclick="kioskRetire('${k.id}')">Retire</button>` : ''}</td></tr>`).join('')}</table>
        <details><summary class="link-btn">Add gate tablet</summary>
          <label>Name</label><input id="nk_name" class="input" placeholder="e.g. Main gate" />
          <label>${t('location')}</label><select id="nk_loc" class="input">${locations.map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select>
          <button class="btn primary small" onclick="kioskCreate()">Create and get pairing code</button>
        </details>
      </div>`);
  });
}
async function kioskCreate() {
  try { const r = await window.Api.createKiosk({ name: fieldVal('nk_name').trim(), locationId: fieldVal('nk_loc') }); window._newKioskCode = { name: r.name, code: r.pairingCode }; renderHrKiosks(); }
  catch (e) { toast(e.message, 'error'); }
}
async function kioskNewCode(id, name) {
  if (!confirm('A new code replaces the current tablet — the old one stops working. Continue?')) return;
  try { const r = await window.Api.kioskNewCode(id); window._newKioskCode = { name, code: r.pairingCode }; renderHrKiosks(); } catch (e) { toast(e.message, 'error'); }
}
async function kioskRetire(id) {
  if (!confirm('Retire this gate tablet? It stops working immediately.')) return;
  try { await window.Api.setKioskStatus(id, 'retired'); renderHrKiosks(); } catch (e) { toast(e.message, 'error'); }
}

// ---------------- Site HR: register a worker on HR's phone (BRD design rule 8) ----------------
// The worker's own OTP (sent to their mobile) unlocks a short-lived "assisted" worker
// session; this phone then runs the normal registration wizard for them. HR's own
// session is set aside and restored when the registration is submitted or HR exits.
const ASSIST_BACKUP_KEY = 'tsg_assist_hr_session';
function isAssisted() { const s = getSession(); return !!(s && s.assisted); }

function renderHrAssist() {
  const s = requireHr(); if (!s) return;
  renderShell(`
    <div class="card center-card">
      <h3>Register a worker</h3>
      <p class="muted small">The worker must be with you. An OTP goes to <b>the worker's</b> mobile — they read it out to you. Then fill the registration with them, including a live photo of their face.</p>
      <label>${t('mobileNumber')} (worker's)</label>
      <input id="as_mobile" class="input" maxlength="10" inputmode="numeric" placeholder="98xxxxxxxx" />
      <button class="btn primary block" onclick="assistRequestOtp()">${t('sendOtp')}</button>
      <div id="as_otp"></div>
    </div>`);
}
async function assistRequestOtp(channel) {
  const mobile = fieldVal('as_mobile').trim();
  if (!/^\d{10}$/.test(mobile)) { toast(t('invalidMobile'), 'error'); return; }
  try {
    const r = await window.Api.assistOtpRequest(mobile, channel);
    window._assistMobile = mobile;
    document.getElementById('as_otp').innerHTML = `
      ${otpSentLine(r, mobile, "assistRequestOtp('sms')")}
      <label>OTP from the worker's phone</label>
      <input id="as_code" class="input" maxlength="6" inputmode="numeric" />
      <button class="btn primary block" onclick="assistVerifyOtp()">${t('verify')}</button>`;
  } catch (e) { toast(e.message, 'error'); }
}
async function assistVerifyOtp() {
  try {
    const r = await window.Api.assistOtpVerify(window._assistMobile, fieldVal('as_code').trim());
    const hr = getSession();
    localStorage.setItem(ASSIST_BACKUP_KEY, JSON.stringify(hr));
    setSessionData({ token: r.token, role: 'worker', mobile: r.worker.mobile, workerId: r.worker.id, assisted: true, assistedBy: hr.name });
    regState = { step: 1 };
    location.hash = '#/w/register'; render();
  } catch (e) { toast(e.message, 'error'); }
}
async function endAssistedSession() {
  try { await window.Api.logout(); } catch (e) { /* ended or offline — the server idles it out */ }
  let hr = null;
  try { hr = JSON.parse(localStorage.getItem(ASSIST_BACKUP_KEY) || 'null'); } catch (e) { /* corrupt */ }
  localStorage.removeItem(ASSIST_BACKUP_KEY);
  regState = { step: 1 };
  if (hr) { setSessionData(hr); location.hash = '#/hr/assist'; } else { clearSessionData(); location.hash = '#/'; }
  render();
}

// ---------------- R16: vendor bill check + month-end lock ----------------
// System days (computed by the server from punches + approved corrections) against what
// each vendor invoiced; any gap is highlighted. Finance enters invoice days once Central
// HR has locked the month.
function lastMonthStr() { const [y, m] = todayStr(Date.now()).split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; }
const BILL_STATUS = {
  overbilled: ['badge-bad', 'Overbilled'], underbilled: ['badge-warn', 'Underbilled'],
  match: ['badge-ok', 'Matches'], no_invoice: ['badge-neutral', 'No invoice yet'],
};
function renderHrBilling() {
  const s = requireHr(); if (!s) return;
  const month = window._billMonth || lastMonthStr();
  withLoading(() => window.Api.vendorBill(month), (data) => {
    const canEdit = hasPerm('billing.write') && data.locked;
    renderShell(`
      <div class="card">
        <h3>Vendor bill check</h3>
        <p class="muted small">Vendors are paid only on system days. Gap = invoice days − system days.</p>
        <input type="month" class="input" value="${month}" max="${todayStr(Date.now()).slice(0, 7)}" onchange="window._billMonth=this.value;renderHrBilling()" />
        <div class="gps-status ${data.locked ? 'ok' : 'warn'}" style="margin:8px 0">
          ${data.locked ? `🔒 Attendance locked by ${esc(data.lock.locked_by)} on ${new Date(data.lock.locked_at).toLocaleDateString()}` : '🔓 Attendance not locked yet — Central HR locks the month, then invoices are entered'}
          ${hasPerm('attendance.lock') ? (data.locked
            ? `<button class="btn secondary small" style="margin-top:6px" onclick="billUnlock('${month}')">Unlock</button>`
            : `<button class="btn primary small" style="margin-top:6px" onclick="billLock('${month}')">Lock ${month}</button>`) : ''}
        </div>
        ${data.rows.length === 0 ? emptyState(`No attendance recorded for ${month} — nothing to bill yet.`, 'ledger') : `
        <table class="tbl">
          <thead><tr><th>${t('vendor')}</th><th>Workers</th><th>System days</th><th>Invoice days</th><th>Gap</th><th></th></tr></thead>
          <tbody>${data.rows.map(r => `<tr>
            <td><a href="javascript:void(0)" onclick="billDetail('${r.vendorId}','${esc(r.vendorName)}')">${esc(r.vendorName)}</a></td>
            <td>${r.workers}</td>
            <td><b>${r.systemDays}</b></td>
            <td>${canEdit
              ? `<input id="inv_${r.vendorId}" class="input" type="number" step="0.5" min="0" style="width:80px;margin:0" value="${r.invoiceDays ?? ''}" />
                 <button class="btn secondary small" onclick="billSaveInvoice('${r.vendorId}','${month}')">${t('save')}</button>`
              : (r.invoiceDays ?? '—')}</td>
            <td>${r.gap == null ? '' : `<b style="color:${r.gap > 0 ? 'var(--bad, #b91c1c)' : r.gap < 0 ? 'var(--warn, #b45309)' : 'inherit'}">${r.gap > 0 ? '+' : ''}${r.gap}</b>`}</td>
            <td><span class="badge ${BILL_STATUS[r.status][0]}">${BILL_STATUS[r.status][1]}</span></td>
          </tr>`).join('')}</tbody>
        </table>
        <button class="btn secondary small" style="margin-top:8px" onclick="billDownload('${month}')">Download (Excel CSV)</button>`}
        <div id="billDetail"></div>
      </div>
    `);
  });
}
async function billLock(month) {
  if (!confirm(`Lock attendance for ${month}? No more corrections can be made for this month.`)) return;
  try { await window.Api.lockMonth(month); toast('Month locked', 'success'); renderHrBilling(); } catch (e) { toast(e.message, 'error'); }
}
async function billUnlock(month) {
  const reason = prompt('Reason for unlocking ' + month + '?'); if (!reason) return;
  try { await window.Api.unlockMonth(month, reason); toast('Month unlocked', 'success'); renderHrBilling(); } catch (e) { toast(e.message, 'error'); }
}
async function billSaveInvoice(vendorId, month) {
  const v = document.getElementById('inv_' + vendorId).value;
  if (v === '') { toast('Enter the invoice days', 'error'); return; }
  try { await window.Api.saveVendorInvoice({ vendorId, month, invoiceDays: Number(v) }); toast('Invoice days saved', 'success'); renderHrBilling(); }
  catch (e) { toast(e.message, 'error'); }
}
async function billDetail(vendorId, vendorName) {
  const month = window._billMonth || lastMonthStr();
  const el = document.getElementById('billDetail');
  el.innerHTML = spinnerRow('Loading…');
  try {
    const d = await window.Api.vendorBillWorkers(vendorId, month);
    el.innerHTML = `<h3 style="margin-top:16px">${esc(vendorName)} — day-wise</h3>
      <table class="tbl"><thead><tr><th>${t('worker')}</th><th>Days</th><th>Dates</th></tr></thead>
      <tbody>${d.rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.days}</td><td class="small wrap">${esc(r.dates)}</td></tr>`).join('')}</tbody></table>`;
    labelTables(el);
  } catch (e) { el.innerHTML = errorState(e.message); }
}
async function billDownload(month) {
  try { await window.Api.downloadCsv('/api/reports/vendor-bill?format=csv&month=' + month, `vendor-bill-check-${month}.csv`); }
  catch (e) { toast(e.message, 'error'); }
}

// ---------------- R15: automatic emails (Central HR sets them once) ----------------
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// ---- AI assistant — ask attendance questions in plain language (see
// src/services/aiAssistant.js: answers are always grounded in real, scoped data, the
// model never writes SQL or invents a number). ----
let hrAskHistory = [];
let hrAskBusy = false;
const HR_ASK_EXAMPLES = ['Aaj kitne workers present hain?', 'How many blocked punches this week?', 'Vinay ki attendance kaisi hai?', 'Which location has the most absences this month?'];

function renderHrAsk() {
  const s = requireHr(); if (!s) return;
  renderShell(`
    <div class="card">
      <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('sparkle')}</span>Ask AI</h3>
      <p class="muted small">Attendance ke baare mein kuch bhi poocho — Hindi, English, dono. Answer hamesha real data se aata hai.</p>
      ${hrAskHistory.length === 0 ? `<div class="filter-row" style="display:flex;flex-wrap:wrap;gap:8px">${HR_ASK_EXAMPLES.map(q => `<button class="btn secondary small" onclick="hrAskQuick('${esc(q).replace(/'/g, "\\'")}')">${esc(q)}</button>`).join('')}</div>` : ''}
    </div>
    ${hrAskHistory.map((h, i) => `
      <div class="card">
        <p style="font-weight:700">${esc(h.question)}</p>
        ${h.error ? `<p class="muted small" style="color:var(--bad)">${esc(h.error)}</p>` : h.answer ? `<p>${esc(h.answer)}</p>` : `<div class="spinner-row"><div class="spinner"></div><span>Soch raha hoon…</span></div>`}
      </div>`).reverse().join('')}
    <div class="card" style="position:sticky;bottom:calc(76px + env(safe-area-inset-bottom, 0px))">
      <div class="filter-row" style="display:flex;gap:8px">
        <input id="hrAskInput" class="input" style="margin:0;flex:1" placeholder="Apna sawal yahan likho…" ${hrAskBusy ? 'disabled' : ''} onkeydown="if(event.key==='Enter')hrAskSubmit()" />
        <button class="btn primary" ${hrAskBusy ? 'disabled' : ''} onclick="hrAskSubmit()">Ask</button>
      </div>
    </div>`);
  const inp = document.getElementById('hrAskInput');
  if (inp) inp.focus();
}
function hrAskQuick(q) {
  document.getElementById('hrAskInput').value = q;
  hrAskSubmit();
}
async function hrAskSubmit() {
  const inp = document.getElementById('hrAskInput');
  const question = (inp.value || '').trim();
  if (!question || hrAskBusy) return;
  hrAskBusy = true;
  const priorTurns = hrAskHistory.filter(h => h.answer).slice(-3);
  const entry = { question };
  hrAskHistory.push(entry);
  renderHrAsk();
  try {
    const r = await window.Api.askAssistant(question, priorTurns);
    entry.answer = r.answer;
  } catch (e) {
    entry.error = e.message;
  }
  hrAskBusy = false;
  renderHrAsk();
}

function renderHrEmails() {
  const s = requireHr(); if (!s) return;
  withLoading(() => window.Api.emailReports(), (data) => {
    window._emailReports = data.reports;
    renderShell(`
      <div class="card">
        <h3>Automatic emails</h3>
        <p class="muted small">Each email includes an Excel file. Times are IST.</p>
        ${!data.delivery.email ? `<div class="gps-status warn">Email sending isn't set up yet (no SMTP in the server's .env) — reports are built and logged but not delivered.</div>` : ''}
        ${!data.delivery.whatsapp ? `<p class="muted small">WhatsApp copy of the manager's email: not set up (WATI).</p>` : ''}
      </div>
      ${data.reports.map(r => `
        <div class="card">
          <h3>${esc(r.title)} ${r.enabled ? '<span class="badge badge-ok">On</span>' : '<span class="badge badge-neutral">Off</span>'}</h3>
          <p class="muted small">${esc(r.shows)} · To: ${esc(r.to)}</p>
          <div class="filter-row">
            <div><label>Time</label><input id="et_${r.key}" type="time" class="input" value="${r.time}" /></div>
            ${r.schedule === 'weekly' ? `<div><label>Day</label><select id="ew_${r.key}" class="input">${WEEKDAYS.map((d, i) => `<option value="${i}" ${r.weekday === i ? 'selected' : ''}>${d}</option>`).join('')}</select></div>`
              : `<div><label>When</label><div class="input" style="background:none;border:none">${r.schedule === 'monthly' ? '1st of the month' : 'Every day'}</div></div>`}
          </div>
          <label>Extra receivers (comma-separated emails)</label>
          <input id="ex_${r.key}" class="input" value="${esc(r.extraRecipients.join(', '))}" />
          <label class="consent-row"><input type="checkbox" id="en_${r.key}" ${r.enabled ? 'checked' : ''} /><span>Send automatically</span></label>
          <div class="wizard-actions">
            <button class="btn secondary small" onclick="sendEmailNow('${r.key}')">Send now</button>
            <button class="btn primary small" onclick="saveEmailSetting('${r.key}')">${t('save')}</button>
          </div>
        </div>`).join('')}
      <div class="card">
        <h3>Recent sends</h3>
        ${data.runs.length === 0 ? `<p class="muted small">Nothing sent yet.</p>` : `<table class="tbl"><tbody>${data.runs.slice(0, 15).map(x => `<tr><td class="small">${new Date(x.ran_at).toLocaleString()}</td><td>${esc((data.reports.find(r => r.key === x.report) || {}).title || x.report)}</td><td class="small">${esc(x.trigger)}</td><td class="small">${esc(x.note || '')}</td></tr>`).join('')}</tbody></table>`}
      </div>`);
  });
}
async function saveEmailSetting(key) {
  const wd = document.getElementById('ew_' + key);
  const body = {
    time: fieldVal('et_' + key), enabled: document.getElementById('en_' + key).checked,
    extraRecipients: fieldVal('ex_' + key).split(',').map(x => x.trim()).filter(Boolean),
    ...(wd ? { weekday: Number(wd.value) } : {}),
  };
  try { await window.Api.updateEmailReport(key, body); toast('Saved', 'success'); renderHrEmails(); } catch (e) { toast(e.message, 'error'); }
}
async function sendEmailNow(key) {
  try { const r = await window.Api.sendEmailReportNow(key); toast(r.note, r.sent === r.messages ? 'success' : 'info'); renderHrEmails(); }
  catch (e) { toast(e.message, 'error'); }
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
        <div class="card"><h3>Database backups</h3><p class="muted small">Taken automatically every night (BRD: backed up daily).</p><div id="backupList">${spinnerRow('Loading…')}</div>
          <button class="btn secondary small" onclick="backupNow()">Back up now</button></div>
      `);
      window._adminUsers = users;
      loadBackups();
      syncUserScopeFields();
    }
  );
}
async function loadBackups() {
  const el = document.getElementById('backupList'); if (!el) return;
  try {
    const r = await window.Api.listBackups();
    el.innerHTML = r.backups.length ? `<p class="small">Last: <b>${new Date(r.backups[0].at).toLocaleString()}</b> (${Math.round(r.backups[0].bytes / 1024)} KB) · ${r.backups.length} kept in <code>${esc(r.dir)}</code></p>` : '<p class="small">No backup yet.</p>';
  } catch (e) { el.innerHTML = esc(e.message); }
}
async function backupNow() {
  try { const r = await window.Api.backupNow(); toast('Backup saved: ' + r.file, 'success'); loadBackups(); } catch (e) { toast(e.message, 'error'); }
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
      <label>Mobile (Site HR: workers' missed-punch button calls this)</label><input id="au_phone" class="input" maxlength="10" inputmode="numeric" value="${esc(u.phone || '')}" />
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
  const body = { name: val('au_name'), role: val('au_role'), locationId: val('au_location') || null, vendorId: val('au_vendor') || null, phone: val('au_phone') || null };
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
        ${rows.length === 0 ? emptyState(t('noData'), 'ledger') : rows.map(a => `
          <div class="log-row">
            <div class="log-meta"><span class="badge badge-neutral">${esc(String(a.action).replace(/_/g, ' '))}</span><span class="muted small">${new Date(a.ts).toLocaleString()} · ${esc(a.user)}</span></div>
            ${a.detail ? `<div class="log-detail">${esc(a.detail)}</div>` : ''}
          </div>`).join('')}
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
      <button class="btn danger block" onclick="doLogout()">${t('yesLogout')}</button>
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
  // Assisted registration only ever shows the registration wizard (never punching).
  if (s && s.assisted && hash !== '#/w/register') { location.hash = hash = '#/w/register'; }
  // A paired gate tablet only ever shows the kiosk screen (R20).
  if (s && s.role === 'kiosk' && hash !== '#/kiosk') { location.hash = hash = '#/kiosk'; }
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
    '#/hr/location-dashboard': renderLocationHeadDashboard,
    '#/hr/finance-dashboard': renderFinanceDashboard,
    '#/hr/approvals': renderHrApprovals,
    '#/hr/attendance': renderHrAttendance,
    '#/hr/regularisations': renderHrRegularisations,
    '#/hr/exceptions': renderHrExceptions,
    '#/hr/masters': renderHrMasters,
    '#/hr/audit': renderHrAudit,
    '#/hr/more': renderHrMore,
    '#/hr/timeguard': renderHrTimeGuard,
    '#/hr/ask': renderHrAsk,
    '#/hr/account': renderHrAccount,
    '#/hr/worker': renderHrWorkerDetail,
    '#/hr/users': renderHrUsers,
    '#/hr/workers': renderHrWorkers,
    '#/hr/billing': renderHrBilling,
    '#/hr/reports': renderHrReports,
    '#/hr/emails': renderHrEmails,
    '#/hr/kiosks': renderHrKiosks,
    '#/hr/requests': renderHrRequests,
    '#/kiosk': renderKiosk,
    '#/hr/assist': renderHrAssist,
    '#/hr/gate': renderHrGate,
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

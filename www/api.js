// Talks to the real tsg-workforce-backend over HTTP. Replaces the old localStorage-only
// data layer — worker and HR devices now see the same server-held data, and every
// security check (geofence, accuracy, one-punch-per-day, device binding) is enforced
// server-side, not just in this client.

const API_BASE_KEY = 'tsg_api_base';
const SESSION_KEY = 'tsg_session';
const DEVICE_ID_KEY = 'tsg_device_id';

// The cloud backend is the default, so a freshly installed app works without anyone
// typing a URL. Server settings can still override it (e.g. a laptop on the same
// Wi-Fi during development) — that override is what's stored in localStorage.
const DEFAULT_API_BASE = 'https://tsg-workforce-backend-production.up.railway.app';
function getApiBase() {
  return (localStorage.getItem(API_BASE_KEY) || DEFAULT_API_BASE).replace(/\/$/, '');
}
function setApiBase(url) {
  localStorage.setItem(API_BASE_KEY, (url || '').trim().replace(/\/$/, ''));
}
function getDeviceId() {
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = 'dev_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch (e) { return null; }
}
function setSessionData(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSessionData() { localStorage.removeItem(SESSION_KEY); }

class ApiError extends Error {
  constructor(message, status, data) { super(message); this.status = status; this.data = data; }
}

async function apiFetch(path, opts = {}) {
  const base = getApiBase();
  if (!base) throw new ApiError('No server configured yet — set the API server address first.', 0);
  const session = getSession();
  // X-Device-Id lets the server check a gate tablet is the device it was paired on (R20).
  const headers = { 'Content-Type': 'application/json', 'X-Device-Id': getDeviceId(), ...(opts.headers || {}) };
  if (session && session.token) headers.Authorization = 'Bearer ' + session.token;

  let res;
  try {
    res = await fetch(base + path, { ...opts, headers, body: opts.body ? JSON.stringify(opts.body) : undefined });
  } catch (e) {
    throw new ApiError('Could not reach the server. Check the API address and that your phone and the server are on the same network.', 0);
  }
  let body = null;
  try { body = await res.json(); } catch (e) { /* no body */ }
  if (!res.ok) {
    if (res.status === 401) clearSessionData();
    throw new ApiError((body && body.error) || `Server error (${res.status})`, res.status, body);
  }
  return body;
}

const Api = {
  // ---- Connectivity ----
  async checkHealth() {
    const base = getApiBase();
    if (!base) return { ok: false, error: 'No server configured' };
    try {
      const res = await fetch(base + '/health');
      if (!res.ok) return { ok: false, error: `Server responded ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: 'Could not reach server' };
    }
  },

  // ---- Auth ----
  workerOtpRequest: (mobile, channel) => apiFetch('/api/auth/worker/otp/request', { method: 'POST', body: { mobile, channel } }),
  workerOtpVerify: (mobile, otp) => apiFetch('/api/auth/worker/otp/verify', { method: 'POST', body: { mobile, otp } }),
  hrOtpRequest: (email) => apiFetch('/api/auth/hr/otp/request', { method: 'POST', body: { email } }),
  // devRole only matters on a dev server, for an email logging in for the first time.
  hrOtpVerify: (email, otp, name, devRole) => apiFetch('/api/auth/hr/otp/verify', { method: 'POST', body: { email, otp, name, devRole } }),
  getAdminMe: () => apiFetch('/api/auth/me'),
  logout: () => apiFetch('/api/auth/logout', { method: 'POST' }),
  // Site HR assisted registration: OTP goes to the worker's mobile.
  assistOtpRequest: (mobile, channel) => apiFetch('/api/assisted/otp/request', { method: 'POST', body: { mobile, channel } }),
  assistOtpVerify: (mobile, otp) => apiFetch('/api/assisted/otp/verify', { method: 'POST', body: { mobile, otp } }),

  // ---- Worker profile ----
  getMe: () => apiFetch('/api/workers/me'),
  updateMe: (fields) => apiFetch('/api/workers/me', { method: 'PUT', body: fields }),
  submitMe: () => apiFetch('/api/workers/me/submit', { method: 'POST' }),
  registrationOptions: () => apiFetch('/api/registration-options'),
  giveConsent: (version, language) => apiFetch('/api/workers/me/consent', { method: 'POST', body: { version, language, deviceId: getDeviceId() } }),
  siteFromGps: (lat, lng, accuracy) => apiFetch('/api/workers/me/site-from-gps', { method: 'POST', body: { lat, lng, accuracy } }),

  // ---- HR: workers ----
  listWorkers: (status) => apiFetch('/api/workers' + (status ? `?status=${encodeURIComponent(status)}` : '')),
  getWorkerById: (id) => apiFetch('/api/workers/' + id),
  absenteeismRisk: (id) => apiFetch('/api/workers/' + id + '/absenteeism-risk'),
  approveWorker: (id, manager) => apiFetch(`/api/workers/${id}/approve`, { method: 'POST', body: manager }),
  transferWorker: (id, body) => apiFetch(`/api/workers/${id}/transfer`, { method: 'POST', body }),
  exitWorker: (id, body) => apiFetch(`/api/workers/${id}/exit`, { method: 'POST', body }),
  resetWorkerDevice: (id, reason) => apiFetch(`/api/workers/${id}/reset-device`, { method: 'POST', body: { reason } }),
  workerHistory: (id) => apiFetch(`/api/workers/${id}/history`),
  gateCheck: (q) => apiFetch('/api/workers/gate-check?q=' + encodeURIComponent(q)),
  setReportingManager:(id, manager) => apiFetch(`/api/workers/${id}/reporting-manager`, { method: 'PUT', body: manager }),
  listReportingManagers: () => apiFetch('/api/workers/meta/reporting-managers'),
  sendBackWorker: (id, reason) => apiFetch(`/api/workers/${id}/send-back`, { method: 'POST', body: { reason } }),
  rejectWorker: (id) => apiFetch(`/api/workers/${id}/reject`, { method: 'POST' }),

  // ---- KYC ----
  digilockerInit: (redirectUrl) => apiFetch('/api/kyc/digilocker/init', { method: 'POST', body: { redirectUrl } }),
  digilockerComplete: (id) => apiFetch(`/api/kyc/digilocker/${id}/complete`),
  panVerify: (pan) => apiFetch('/api/kyc/pan/verify', { method: 'POST', body: { pan } }),
  aadhaarQr: (qrText) => apiFetch('/api/kyc/aadhaar-qr', { method: 'POST', body: { qrText } }),
  aadhaarQrImage: (photoDataUrl) => apiFetch('/api/kyc/aadhaar-qr-image', { method: 'POST', body: { photoDataUrl } }),
  panPhoto: (photoDataUrl) => apiFetch('/api/kyc/pan/photo', { method: 'POST', body: { photoDataUrl } }),
  skipKycDev: () => apiFetch('/api/kyc/skip-dev', { method: 'POST' }),
  // The face-lock loop (scanFaceForPunch) runs for both a worker's phone and the gate
  // tablet; each has its own authed route for the same check.
  detectFace: (frameDataUrl) => apiFetch((getSession() || {}).role === 'kiosk' ? '/api/kiosk/face-detect' : '/api/kyc/face-detect', { method: 'POST', body: { frameDataUrl } }),

  // ---- Punches ----
  punch: (data) => apiFetch('/api/punches', { method: 'POST', body: { ...data, deviceId: getDeviceId() } }),
  offlinePunch: (data) => apiFetch('/api/punches/offline', { method: 'POST', body: { ...data, deviceId: getDeviceId() } }),
  myPunches: () => apiFetch('/api/punches/me'),
  listPunches: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch('/api/punches' + (q ? '?' + q : ''));
  },

  // ---- Masters ----
  listVendors: () => apiFetch('/api/vendors'),
  createVendor: (v) => apiFetch('/api/vendors', { method: 'POST', body: v }),
  updateVendor: (id, v) => apiFetch(`/api/vendors/${id}`, { method: 'PUT', body: v }),
  listJobs: () => apiFetch('/api/jobs'),
  createJob: (j) => apiFetch('/api/jobs', { method: 'POST', body: j }),
  updateJob: (id, j) => apiFetch('/api/jobs/' + id, { method: 'PUT', body: j }),
  listLocations: () => apiFetch('/api/locations'),
  createLocation: (l) => apiFetch('/api/locations', { method: 'POST', body: l }),
  updateLocation: (id, l) => apiFetch(`/api/locations/${id}`, { method: 'PUT', body: l }),

  // ---- Vendor contact-person KYC (Aadhaar/PAN of the authorized contact, captured
  // by HR while adding/editing a vendor — stateless, same pattern as worker KYC) ----
  vendorPanPhoto: (photoDataUrl) => apiFetch('/api/vendor-kyc/pan-photo', { method: 'POST', body: { photoDataUrl } }),
  vendorAadhaarQr: (qrText) => apiFetch('/api/vendor-kyc/aadhaar-qr', { method: 'POST', body: { qrText } }),
  vendorAadhaarQrImage: (photoDataUrl) => apiFetch('/api/vendor-kyc/aadhaar-qr-image', { method: 'POST', body: { photoDataUrl } }),
  vendorPanVerify: (pan, aadhaarName, vendorId) => apiFetch('/api/vendor-kyc/pan-verify', { method: 'POST', body: { pan, aadhaarName, vendorId } }),

  // ---- Regularisations ----
  myRegularisations: () => apiFetch('/api/regularisations/mine'),
  raiseRegularisation: (workerId, date, reason) => apiFetch('/api/regularisations', { method: 'POST', body: { workerId, date, reason } }),
  listRegularisations: (status) => apiFetch('/api/regularisations' + (status ? `?status=${encodeURIComponent(status)}` : '')),
  decideRegularisation: (id, decision) => apiFetch(`/api/regularisations/${id}/decide`, { method: 'POST', body: { decision } }),

  // ---- Audit ----
  listAudit: () => apiFetch('/api/audit'),

  dashboard: (f) => apiFetch('/api/reports/dashboard?' + new URLSearchParams(Object.entries(f || {}).filter(([, v]) => v))),
  reportFilters: () => apiFetch('/api/reports/filters'),
  // ---- Reports: vendor bill check (R16) + month lock ----
  vendorBill: (month) => apiFetch('/api/reports/vendor-bill?month=' + encodeURIComponent(month)),
  vendorBillWorkers: (vendorId, month) => apiFetch(`/api/reports/vendor-bill/${vendorId}/workers?month=${encodeURIComponent(month)}`),
  saveVendorInvoice: (body) => apiFetch('/api/reports/vendor-invoices', { method: 'PUT', body }),
  lockMonth: (month) => apiFetch('/api/reports/attendance-lock', { method: 'POST', body: { month } }),
  unlockMonth: (month, reason) => apiFetch('/api/reports/attendance-lock/' + month, { method: 'DELETE', body: { reason } }),
  // CSV reports: fetched with the session token (a plain link can't send it) and handed
  // to the browser as a file download.
  async downloadCsv(path, filename) {
    const session = getSession();
    const res = await fetch(getApiBase() + path, { headers: session ? { Authorization: 'Bearer ' + session.token } : {} });
    if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  },

  emailReports: () => apiFetch('/api/email-reports'),
  updateEmailReport: (key, body) => apiFetch('/api/email-reports/' + key, { method: 'PUT', body }),
  sendEmailReportNow: (key) => apiFetch('/api/email-reports/' + key + '/send-now', { method: 'POST' }),

  listBackups: () => apiFetch('/api/system/backups'),
  backupNow: () => apiFetch('/api/system/backups', { method: 'POST' }),
  listWorkerRequests: () => apiFetch('/api/worker-requests'),
  raiseWorkerRequest: (b) => apiFetch('/api/worker-requests', { method: 'POST', body: b }),
  workerRequestAction: (id, action, body) => apiFetch(`/api/worker-requests/${id}/${action}`, { method: 'POST', body }),
  // ---- Gate tablet (R20) ----
  listKiosks: () => apiFetch('/api/kiosks'),
  createKiosk: (k) => apiFetch('/api/kiosks', { method: 'POST', body: k }),
  kioskNewCode: (id) => apiFetch('/api/kiosks/' + id + '/new-code', { method: 'POST' }),
  setKioskStatus: (id, status) => apiFetch('/api/kiosks/' + id, { method: 'PUT', body: { status } }),
  kioskPair: (code) => apiFetch('/api/kiosk/pair', { method: 'POST', body: { code, deviceId: getDeviceId() } }),
  kioskMe: () => apiFetch('/api/kiosk/me'),
  kioskCandidates: (last4) => apiFetch('/api/kiosk/candidates?last4=' + last4),
  kioskPunch: (data) => apiFetch('/api/kiosk/punch', { method: 'POST', body: data }),

  // ---- AI assistant ----
  askAssistant: (question, history) => apiFetch('/api/assistant/ask', { method: 'POST', body: { question, history } }),

  // ---- Admin users (System Admin) ----
  listAdminRoles: () => apiFetch('/api/admin-users/roles'),
  listAdminUsers: () => apiFetch('/api/admin-users'),
  createAdminUser: (u) => apiFetch('/api/admin-users', { method: 'POST', body: u }),
  updateAdminUser: (id, u) => apiFetch('/api/admin-users/' + id, { method: 'PUT', body: u }),
};

window.Api = Api;
window.ApiSession = { getApiBase, setApiBase, getSession, setSessionData, clearSessionData, getDeviceId };

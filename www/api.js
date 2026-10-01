// Talks to the real tsg-workforce-backend over HTTP. Replaces the old localStorage-only
// data layer — worker and HR devices now see the same server-held data, and every
// security check (geofence, accuracy, one-punch-per-day, device binding) is enforced
// server-side, not just in this client.

const API_BASE_KEY = 'tsg_api_base';
const SESSION_KEY = 'tsg_session';
const DEVICE_ID_KEY = 'tsg_device_id';

function getApiBase() {
  return (localStorage.getItem(API_BASE_KEY) || '').replace(/\/$/, '');
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
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
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
  workerOtpRequest: (mobile) => apiFetch('/api/auth/worker/otp/request', { method: 'POST', body: { mobile } }),
  workerOtpVerify: (mobile, otp) => apiFetch('/api/auth/worker/otp/verify', { method: 'POST', body: { mobile, otp } }),
  hrOtpRequest: (email) => apiFetch('/api/auth/hr/otp/request', { method: 'POST', body: { email } }),
  // devRole only matters on a dev server, for an email logging in for the first time.
  hrOtpVerify: (email, otp, name, devRole) => apiFetch('/api/auth/hr/otp/verify', { method: 'POST', body: { email, otp, name, devRole } }),
  getAdminMe: () => apiFetch('/api/auth/me'),

  // ---- Worker profile ----
  getMe: () => apiFetch('/api/workers/me'),
  updateMe: (fields) => apiFetch('/api/workers/me', { method: 'PUT', body: fields }),
  submitMe: () => apiFetch('/api/workers/me/submit', { method: 'POST' }),

  // ---- HR: workers ----
  listWorkers: (status) => apiFetch('/api/workers' + (status ? `?status=${encodeURIComponent(status)}` : '')),
  getWorkerById: (id) => apiFetch('/api/workers/' + id),
  approveWorker: (id, manager) => apiFetch(`/api/workers/${id}/approve`, { method: 'POST', body: manager }),
  setReportingManager: (id, manager) => apiFetch(`/api/workers/${id}/reporting-manager`, { method: 'PUT', body: manager }),
  listReportingManagers: () => apiFetch('/api/workers/meta/reporting-managers'),
  sendBackWorker: (id, reason) => apiFetch(`/api/workers/${id}/send-back`, { method: 'POST', body: { reason } }),
  rejectWorker: (id) => apiFetch(`/api/workers/${id}/reject`, { method: 'POST' }),

  // ---- KYC ----
  digilockerInit: (redirectUrl) => apiFetch('/api/kyc/digilocker/init', { method: 'POST', body: { redirectUrl } }),
  digilockerComplete: (id) => apiFetch(`/api/kyc/digilocker/${id}/complete`),
  panVerify: (pan) => apiFetch('/api/kyc/pan/verify', { method: 'POST', body: { pan } }),
  aadhaarQr: (qrText) => apiFetch('/api/kyc/aadhaar-qr', { method: 'POST', body: { qrText } }),
  panPhoto: (photoDataUrl) => apiFetch('/api/kyc/pan/photo', { method: 'POST', body: { photoDataUrl } }),
  skipKycDev: () => apiFetch('/api/kyc/skip-dev', { method: 'POST' }),
  detectFace: (frameDataUrl) => apiFetch('/api/kyc/face-detect', { method: 'POST', body: { frameDataUrl } }),

  // ---- Punches ----
  punch: (data) => apiFetch('/api/punches', { method: 'POST', body: { ...data, deviceId: getDeviceId() } }),
  myPunches: () => apiFetch('/api/punches/me'),
  listPunches: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return apiFetch('/api/punches' + (q ? '?' + q : ''));
  },

  // ---- Masters ----
  listVendors: () => apiFetch('/api/vendors'),
  createVendor: (v) => apiFetch('/api/vendors', { method: 'POST', body: v }),
  updateVendor: (id, v) => apiFetch(`/api/vendors/${id}`, { method: 'PUT', body: v }),
  listLocations: () => apiFetch('/api/locations'),
  createLocation: (l) => apiFetch('/api/locations', { method: 'POST', body: l }),
  updateLocation: (id, l) => apiFetch(`/api/locations/${id}`, { method: 'PUT', body: l }),

  // ---- Regularisations ----
  myRegularisations: () => apiFetch('/api/regularisations/mine'),
  raiseRegularisation: (workerId, date, reason) => apiFetch('/api/regularisations', { method: 'POST', body: { workerId, date, reason } }),
  listRegularisations: (status) => apiFetch('/api/regularisations' + (status ? `?status=${encodeURIComponent(status)}` : '')),
  decideRegularisation: (id, decision) => apiFetch(`/api/regularisations/${id}/decide`, { method: 'POST', body: { decision } }),

  // ---- Audit ----
  listAudit: () => apiFetch('/api/audit'),

  // ---- Admin users (System Admin) ----
  listAdminRoles: () => apiFetch('/api/admin-users/roles'),
  listAdminUsers: () => apiFetch('/api/admin-users'),
  createAdminUser: (u) => apiFetch('/api/admin-users', { method: 'POST', body: u }),
  updateAdminUser: (id, u) => apiFetch('/api/admin-users/' + id, { method: 'PUT', body: u }),
};

window.Api = Api;
window.ApiSession = { getApiBase, setApiBase, getSession, setSessionData, clearSessionData, getDeviceId };

// Pure helpers for working with punch data fetched from the backend. No storage,
// no state — everything here takes plain arrays/values and returns plain values.

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function todayStr(ts) { return new Date(ts).toISOString().slice(0, 10); }

// `punches` here is a worker's own punch list (as returned by GET /api/punches/me or
// GET /api/punches?workerId=...), using the backend's snake_case field names.
function punchesForDay(punches, dayStr) {
  return punches
    .filter(p => p.result === 'ok' && todayStr(p.ts) === dayStr)
    .sort((a, b) => a.ts - b.ts);
}

function lastOpenPunchIn(punches) {
  const day = todayStr(Date.now());
  const todays = punchesForDay(punches, day);
  const ins = todays.filter(p => p.type === 'in');
  const outs = todays.filter(p => p.type === 'out');
  return ins.length > outs.length ? ins[ins.length - 1] : null;
}

function attendanceStatusForDay(punches, dayStr) {
  const day = punchesForDay(punches, dayStr);
  const inP = day.find(p => p.type === 'in');
  const outP = [...day].reverse().find(p => p.type === 'out');
  if (!inP) return { status: 'absent', inTime: null, outTime: null, hours: 0 };
  if (!outP) return { status: 'missed_punch_out', inTime: inP.ts, outTime: null, hours: 0 };
  const hours = (outP.ts - inP.ts) / 3600000;
  return { status: hours < 4 ? 'half_day' : 'present', inTime: inP.ts, outTime: outP.ts, hours: Math.round(hours * 10) / 10 };
}

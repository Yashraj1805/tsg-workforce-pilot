// Role dashboards. Every admin role gets its own home screen — the same server data
// (already scoped per role by rbac.js) composed around what that role actually does
// first thing in the morning, instead of one generic stat grid for everyone.
//
// Kit (shared pieces): dashHero (today's attendance ring + headline), dashTiles
// (two big "act on this" tiles), dashRow (compact secondary numbers), dashPeople
// (per-worker status list), dashActions (one-tap shortcuts). Each role's render
// function below picks what it needs. Loaded after app.js (index.html) and uses its
// globals: requireHr, withLoading, renderShell, esc, t, icon, hasPerm, fmtTime,
// todayStr, attendanceStatusForDay, emptyState, lastMonthStr, reasonLabel,
// computeTimeGuardFlags, computeSmartInsights, barChart, loadHrContext.

const DASH_GREETING = () => { const h = new Date().getHours(); return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
const DASH_DATE = () => new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });

// ---- kit ----
function dashHero({ title, subtitle, pct, big, bigLabel, tone }) {
  const r = 34, c = 2 * Math.PI * r, p = Math.max(0, Math.min(100, pct ?? 0));
  const ring = pct == null ? '' : `
    <div class="dash-ring" role="img" aria-label="${p}% present">
      <svg viewBox="0 0 80 80"><circle class="dash-ring-track" cx="40" cy="40" r="${r}"/><circle class="dash-ring-fill" cx="40" cy="40" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}"/></svg>
      <div class="dash-ring-text"><b>${p}%</b><span>present</span></div>
    </div>`;
  const stat = big != null ? `<div class="dash-hero-big"><b>${big}</b><span>${bigLabel}</span></div>` : '';
  return `
    <div class="dash-hero ${tone || ''}">
      <div class="dash-hero-text">
        <div class="dash-hero-greet">${DASH_GREETING()}, ${esc((getSession().name || '').split(' ')[0] || '')}</div>
        <h2>${title}</h2>
        <div class="dash-hero-sub">${subtitle || DASH_DATE()}</div>
      </div>
      ${ring}${stat}
    </div>`;
}
function dashTiles(tiles) {
  return `<div class="dash-tiles">${tiles.map(x => `
    <div class="dash-tile ${x.tone || ''} ${x.href ? 'tap' : ''}" ${x.href ? `onclick="location.hash='${x.href}';render()"` : ''}>
      <span class="dash-tile-icon">${icon(x.icon)}</span>
      <div class="dash-tile-num">${x.value}</div>
      <div class="dash-tile-label">${x.label}</div>
      ${x.href ? `<span class="dash-tile-go">›</span>` : ''}
    </div>`).join('')}</div>`;
}
function dashRow(items) {
  return `<div class="dash-row">${items.map(x => `<div class="dash-chip ${x.href ? 'tap' : ''}" ${x.href ? `onclick="location.hash='${x.href}';render()"` : ''}><b>${x.value}</b><span>${x.label}</span></div>`).join('')}</div>`;
}
function dashActions(actions) {
  const a = actions.filter(Boolean);
  if (!a.length) return '';
  return `<div class="dash-actions">${a.map(x => `<button class="dash-action" onclick="${x.onclick}"><span class="dash-action-icon">${icon(x.icon)}</span>${x.label}</button>`).join('')}</div>`;
}
// Per-worker today status. rows: [{ w, st }] from dashPeopleRows().
function dashPeople(rows, { title, emptyText, limit = 6, showAll } = {}) {
  const order = { absent: 0, missed_punch_out: 1, half_day: 2, present: 3 };
  const sorted = [...rows].sort((a, b) => (order[a.st.status] ?? 9) - (order[b.st.status] ?? 9) || (a.w.name || '').localeCompare(b.w.name || ''));
  const shown = sorted.slice(0, limit);
  const dot = { present: 'ok', half_day: 'warn', missed_punch_out: 'warn', absent: 'bad' };
  const line = (st) => st.status === 'absent' ? 'Not punched in' : st.status === 'missed_punch_out' ? `In ${st.inTime} · no punch-out` : `In ${st.inTime}${st.outTime ? ` · Out ${st.outTime}` : ''}`;
  return `
    <div class="card">
      <h3>${title}</h3>
      ${rows.length === 0 ? emptyState(emptyText || 'No workers in your scope yet.', 'user') : shown.map(({ w, st }) => `
        <div class="dash-person" onclick="viewWorker('${w.id}')">
          ${w.photo_data_url ? `<img src="${esc(w.photo_data_url)}" class="thumb" />` : `<div class="thumb placeholder">${icon('user')}</div>`}
          <div class="dash-person-text"><b>${esc(w.name || w.mobile)}</b><span class="muted small">${esc(w.designation || w.location_name || '')}</span></div>
          <span class="dash-dot ${dot[st.status] || ''}"></span><span class="dash-person-status small">${line(st)}</span>
        </div>`).join('')}
      ${rows.length > limit && showAll ? `<a href="${showAll}" class="link-btn small" style="display:inline-block;margin-top:8px">All ${rows.length} workers →</a>` : ''}
    </div>`;
}
async function dashPeopleRows() {
  const day = todayStr(Date.now());
  const [workers, punches] = await Promise.all([window.Api.listWorkers('approved'), window.Api.listPunches({ date: day })]);
  return workers.map(w => ({ w, st: attendanceStatusForDay(punches.filter(p => p.worker_id === w.id), day) }));
}
function dashAttention(blocked, risky) {
  const items = [
    ...[...blocked].sort((a, b) => b.ts - a.ts).slice(0, 4).map(p => ({ p, badge: `<span class="badge badge-bad">${esc(reasonLabel(p.reason))}</span>` })),
    ...risky.filter(p => p.result === 'ok').sort((a, b) => b.risk_score - a.risk_score).slice(0, 3).map(p => ({ p, badge: `<span class="badge badge-warn">risk ${p.risk_score}</span>` })),
  ];
  return `
    <div class="card">
      <h3>Needs attention</h3>
      ${items.length === 0 ? emptyState('Nothing flagged today — all punches clean.', 'shield') : items.map(({ p, badge }) => `
        <div class="dash-person" onclick="viewWorker('${p.worker_id}')">
          ${thumbHtml(p.selfie_data_url)}
          <div class="dash-person-text"><b>${esc(p.worker_name || p.worker_id)}</b><span class="muted small">${p.type.toUpperCase()} · ${new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
          ${badge}
        </div>`).join('')}
      <a href="#/hr/exceptions" class="link-btn small" style="display:inline-block;margin-top:8px">All exceptions →</a>
    </div>`;
}
const pctOf = (d) => d.active ? Math.round(100 * d.punchedIn / d.active) : 0;

// ---- Central HR: the whole company ----
function renderCentralHrDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.dashboard({}), loadHrContext(), window.Api.listPunches({ result: 'blocked' }), window.Api.listPunches({ minRisk: 20 }), fetchIfAllowed('requests.view', () => window.Api.listWorkerRequests())]),
    ([d, ctx, blocked, risky, requests]) => {
      const flags = computeTimeGuardFlags(ctx);
      const insights = computeSmartInsights({ ...ctx, flags });
      const pendingRegs = ctx.regularisations.filter(r => r.status === 'pending').length;
      const pendingReqs = requests.filter(r => r.status === 'accepted' || (r.status === 'pending' && r.type === 'exit')).length;
      const todayBlocked = blocked.filter(p => todayStr(p.ts) === todayStr(Date.now())).length;
      renderShell(`
        ${dashHero({ title: 'All sites today', pct: pctOf(d) })}
        ${dashTiles([
          { icon: 'warn', value: d.notPunched, label: 'Not punched in', tone: d.notPunched ? 'warn' : 'ok', href: '#/hr/attendance' },
          { icon: 'check', value: d.pendingApprovals, label: 'Waiting for approval', tone: d.pendingApprovals ? 'primary' : '', href: '#/hr/approvals' },
        ])}
        ${dashRow([
          { value: d.active, label: 'Active' }, { value: d.punchedIn, label: 'In' }, { value: d.punchedOut, label: 'Out' },
          { value: todayBlocked, label: 'Blocked', href: '#/hr/exceptions' },
          { value: pendingRegs, label: 'Regularise', href: '#/hr/regularisations' }, { value: pendingReqs, label: 'Requests', href: '#/hr/requests' },
        ])}
        <div class="card">
          <h3>By location</h3>
          ${d.byLocation.length === 0 ? emptyState('No locations yet.', 'building') : d.byLocation.map(l => {
            const p = l.active ? Math.round(100 * l.punchedIn / l.active) : 0;
            return `<div class="dash-loc"><div class="dash-loc-head"><b>${esc(l.location)}</b><span class="muted small">${l.punchedIn}/${l.active} in · ${l.punchedOut} out</span></div>
              <div class="bar-track"><div class="bar-fill ${p < 50 ? 'bad' : p < 80 ? 'warn' : ''}" style="width:${p}%"></div></div></div>`;
          }).join('')}
        </div>
        ${dashAttention(blocked, risky)}
        <div class="card insight-card">
          <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('sparkle')}</span>${t('smartInsights')}</h3>
          <ul class="insight-list">${insights.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          <a href="#/hr/timeguard" class="link-btn small" style="display:inline-block;margin-top:8px">${t('viewTimeGuard')} (${flags.length}) →</a>
        </div>
      `);
    });
}

// ---- Site HR: one site, and the two things they do all day (register, regularise) ----
function renderSiteHrDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.dashboard({}), dashPeopleRows(), window.Api.listPunches({ result: 'blocked' }), window.Api.listPunches({ minRisk: 20 }), fetchIfAllowed('regularisations.read', () => window.Api.listRegularisations())]),
    ([d, people, blocked, risky, regs]) => {
      const site = d.byLocation[0] ? d.byLocation[0].location : 'My site';
      const pendingRegs = regs.filter(r => r.status === 'pending').length;
      const notIn = people.filter(r => r.st.status === 'absent');
      renderShell(`
        ${dashHero({ title: esc(site), pct: pctOf(d) })}
        ${dashActions([
          hasPerm('workers.register_assisted') && { icon: 'user', label: 'Register worker', onclick: "location.hash='#/hr/assist';render()" },
          { icon: 'calendar', label: 'Attendance register', onclick: "location.hash='#/hr/attendance';render()" },
          { icon: 'shield', label: 'Gate check', onclick: "location.hash='#/hr/gate';render()" },
        ])}
        ${dashTiles([
          { icon: 'warn', value: notIn.length, label: 'Not punched in yet', tone: notIn.length ? 'warn' : 'ok', href: '#/hr/attendance' },
          { icon: 'doc', value: pendingRegs, label: 'Regularisations pending', tone: pendingRegs ? 'primary' : '', href: '#/hr/regularisations' },
        ])}
        ${dashRow([{ value: d.active, label: 'Active' }, { value: d.punchedIn, label: 'In' }, { value: d.punchedOut, label: 'Out' }, { value: d.blocked, label: 'Blocked', href: '#/hr/exceptions' }])}
        ${dashPeople(notIn, { title: 'Not punched in yet', emptyText: 'Everyone has punched in.', showAll: '#/hr/attendance' })}
        ${dashAttention(blocked, risky)}
      `);
    });
}

// ---- Reporting Manager: my team, by name ----
function renderManagerDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.dashboard({}), dashPeopleRows()]), ([d, people]) => {
    const missedOut = people.filter(r => r.st.status === 'missed_punch_out').length;
    renderShell(`
      ${dashHero({ title: 'My team today', pct: pctOf(d) })}
      ${dashTiles([
        { icon: 'warn', value: d.notPunched, label: 'Not punched in', tone: d.notPunched ? 'warn' : 'ok' },
        { icon: 'calendar', value: missedOut, label: 'Missed punch-out', tone: missedOut ? 'warn' : '' },
      ])}
      ${dashRow([{ value: d.active, label: 'In my team' }, { value: d.punchedIn, label: 'In' }, { value: d.punchedOut, label: 'Out' }])}
      ${dashPeople(people, { title: 'Everyone', limit: 50 })}
      ${dashActions([{ icon: 'doc', label: 'Transfer / exit request', onclick: "location.hash='#/hr/requests';render()" }, { icon: 'doc', label: 'Excel report', onclick: "location.hash='#/hr/reports';render()" }])}
    `);
  });
}

// ---- Vendor Coordinator: my workers + what I'll be paid for ----
function renderVendorDashboard() {
  const s = requireHr(); if (!s) return;
  const month = lastMonthStr();
  withLoading(() => Promise.all([window.Api.dashboard({}), dashPeopleRows(), fetchIfAllowed('billing.read', () => window.Api.vendorBill(month))]), ([d, people, bill]) => {
    const mine = bill && bill.rows ? bill.rows[0] : null;
    renderShell(`
      ${dashHero({ title: 'My workers today', pct: pctOf(d) })}
      ${dashTiles([
        { icon: 'warn', value: d.notPunched, label: 'Not punched in', tone: d.notPunched ? 'warn' : 'ok' },
        { icon: 'ledger', value: mine ? mine.systemDays : '—', label: `System days · ${month}`, tone: 'primary', href: '#/hr/billing' },
      ])}
      ${dashRow([{ value: d.active, label: 'Active' }, { value: d.punchedIn, label: 'In' }, { value: d.punchedOut, label: 'Out' }, { value: d.blocked, label: 'Blocked', href: '#/hr/exceptions' }])}
      ${mine ? `<div class="card"><h3>Bill status · ${month}</h3>
        <div class="dash-kv"><span>Workers</span><b>${mine.workers}</b></div>
        <div class="dash-kv"><span>System days (payable)</span><b>${mine.systemDays}</b></div>
        <div class="dash-kv"><span>Invoice days</span><b>${mine.invoiceDays ?? '—'}</b></div>
        ${mine.gap != null && mine.gap !== 0 ? `<div class="gps-status ${mine.gap > 0 ? 'bad' : 'warn'}">Gap ${mine.gap > 0 ? '+' : ''}${mine.gap} days vs system</div>` : ''}
        <p class="muted small">${bill.locked ? 'Month locked — figures are final.' : 'Month not locked yet — figures can still change.'}</p>
        <a href="#/hr/billing" class="link-btn small">Open bill check →</a></div>` : ''}
      ${dashPeople(people, { title: 'My workers', limit: 50 })}
    `);
  });
}

// ---- Location Head: one site, read-only, what needs a look ----
function renderLocationHeadDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.dashboard({}), dashPeopleRows(), window.Api.listPunches({ result: 'blocked' }), window.Api.listPunches({ minRisk: 20 }), fetchIfAllowed('regularisations.read', () => window.Api.listRegularisations()), fetchIfAllowed('requests.view', () => window.Api.listWorkerRequests())]),
    ([d, people, blocked, risky, regs, requests]) => {
      const site = d.byLocation[0] ? d.byLocation[0].location : 'My location';
      const pendingRegs = regs.filter(r => r.status === 'pending').length;
      const pendingReqs = requests.filter(r => r.status === 'pending' || r.status === 'accepted').length;
      renderShell(`
        ${dashHero({ title: esc(site), pct: pctOf(d) })}
        ${dashTiles([
          { icon: 'warn', value: d.notPunched, label: 'Not punched in', tone: d.notPunched ? 'warn' : 'ok', href: '#/hr/attendance' },
          { icon: 'shield', value: d.blocked, label: 'Blocked today', tone: d.blocked ? 'bad' : '', href: '#/hr/exceptions' },
        ])}
        ${dashRow([{ value: d.active, label: 'Active' }, { value: d.punchedIn, label: 'In' }, { value: d.punchedOut, label: 'Out' }, { value: pendingRegs, label: 'Regularise', href: '#/hr/regularisations' }, { value: pendingReqs, label: 'Requests', href: '#/hr/requests' }])}
        ${dashAttention(blocked, risky)}
        ${dashPeople(people.filter(r => r.st.status !== 'present'), { title: 'Not fully present', emptyText: 'Everyone is in and out on time.', showAll: '#/hr/attendance' })}
      `);
    });
}

// ---- MIS / Finance: this month's money view ----
function renderFinanceDashboard() {
  const s = requireHr(); if (!s) return;
  const month = window._financeDashMonth || lastMonthStr();
  withLoading(() => Promise.all([window.Api.vendorBill(month), window.Api.dashboard({})]), ([bill, d]) => {
    const missing = bill.rows.filter(r => r.invoiceDays == null).length;
    const gaps = bill.rows.filter(r => r.gap != null && r.gap !== 0).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const totalDays = bill.rows.reduce((a, r) => a + (r.systemDays || 0), 0);
    renderShell(`
      ${dashHero({ title: 'Finance overview', subtitle: `<input type="month" class="input dash-month" value="${month}" max="${todayStr(Date.now()).slice(0, 7)}" onchange="window._financeDashMonth=this.value;renderFinanceDashboard()" />`, big: Math.round(totalDays * 10) / 10, bigLabel: 'payable days' })}
      ${dashTiles([
        { icon: 'ledger', value: missing, label: 'Invoices not entered', tone: missing ? 'warn' : 'ok', href: '#/hr/billing' },
        { icon: 'warn', value: gaps.length, label: 'Vendors with a gap', tone: gaps.length ? 'bad' : 'ok', href: '#/hr/billing' },
      ])}
      ${dashRow([{ value: bill.rows.length, label: 'Vendors' }, { value: d.active, label: 'Active workers' }, { value: bill.locked ? '🔒' : '🔓', label: bill.locked ? 'Locked' : 'Not locked' }])}
      <div class="card">
        <h3>Vendor gaps</h3>
        ${gaps.length === 0 ? emptyState('No gaps — every entered invoice matches system days.', 'ledger') : gaps.map(r => `
          <div class="dash-kv"><span>${esc(r.vendorName)}<br/><span class="muted small">${r.systemDays} system · ${r.invoiceDays ?? '—'} invoiced</span></span><b style="color:${r.gap > 0 ? 'var(--bad)' : 'var(--warn)'}">${r.gap > 0 ? '+' : ''}${r.gap}</b></div>`).join('')}
        <a href="#/hr/billing" class="link-btn small" style="display:inline-block;margin-top:8px">Open vendor bill check →</a>
      </div>
    `);
  });
}

// '#/hr/dashboard' for the roles without a dedicated hash. Security never gets here
// (its home is Gate check); System Admin has no worker data to put on a dashboard.
function renderHrDashboard() {
  const role = (getSession() || {}).role;
  return ({ central_hr: renderCentralHrDashboard, site_hr: renderSiteHrDashboard, reporting_manager: renderManagerDashboard, vendor_coordinator: renderVendorDashboard }[role] || renderCentralHrDashboard)();
}
function dashLabel() {
  return { site_hr: 'My site', reporting_manager: 'My team', vendor_coordinator: 'My workers' }[(getSession() || {}).role] || t('hrDashboard');
}

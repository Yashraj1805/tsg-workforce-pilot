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
// Grouped rows (byLocation / byVendor from the dashboard API) as name + progress bar.
function dashBreakdown(title, rows, key, emptyText, emptyIcon, moreHref) {
  const sorted = [...rows].sort((a, b) => b.active - a.active);
  return `
    <div class="card">
      <h3>${title}</h3>
      ${sorted.length === 0 ? emptyState(emptyText, emptyIcon) : sorted.map(r => {
        const p = r.active ? Math.round(100 * r.punchedIn / r.active) : 0;
        return `<div class="dash-loc"><div class="dash-loc-head"><b>${esc(r[key])}</b><span class="muted small">${r.punchedIn}/${r.active} in · ${r.punchedOut} out</span></div>
          <div class="bar-track"><div class="bar-fill ${p < 50 ? 'bad' : p < 80 ? 'warn' : ''}" style="width:${p}%"></div></div></div>`;
      }).join('')}
      ${moreHref && sorted.length ? `<a href="${moreHref}" class="link-btn small" style="display:inline-block;margin-top:8px">See workers by vendor →</a>` : ''}
    </div>`;
}

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
        ${dashBreakdown('By location', d.byLocation, 'location', 'No locations yet.', 'building')}
        ${dashBreakdown('By vendor / agency', d.byVendor || [], 'vendor', 'No vendors yet.', 'building', '#/hr/workers')}
        ${dashAttention(blocked, risky)}
        <div class="card insight-card">
          <h3><span class="icon-inline" style="width:20px;height:20px;margin-right:6px">${icon('sparkle')}</span>${t('smartInsights')}</h3>
          <ul class="insight-list">${insights.lines.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
          <a href="#/hr/timeguard" class="link-btn small" style="display:inline-block;margin-top:8px">${t('viewTimeGuard')} (${flags.length}) →</a>
        </div>
      `);
    });
}

// ---- Site HR (BRD: registers workers in person, raises missed-punch requests,
// gate check; cannot approve). Their day is a task list, so the home is one. ----
function renderSiteHrDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.dashboard({}), dashPeopleRows(), window.Api.listWorkers(), fetchIfAllowed('regularisations.read', () => window.Api.listRegularisations()), fetchIfAllowed('requests.view', () => window.Api.listWorkerRequests())]),
    ([d, people, allWorkers, regs, requests]) => {
      const site = d.byLocation[0] ? d.byLocation[0].location : 'My site';
      const notIn = people.filter(r => r.st.status === 'absent');
      const missedOut = people.filter(r => r.st.status === 'missed_punch_out');
      const unfinished = allWorkers.filter(w => w.status === 'draft' || w.status === 'sent_back');
      const awaitingCentral = allWorkers.filter(w => w.status === 'pending');
      const regsPending = regs.filter(r => r.status === 'pending');
      const transfersIn = requests.filter(r => r.type === 'transfer' && r.status === 'pending');
      const tasks = [
        dashTask(missedOut.length, 'calendar', 'Punched in, not out', 'Raise a missed-punch request before day end', '#/hr/attendance', 'warn'),
        dashTask(unfinished.length, 'user', 'Registrations not finished', 'Drafts and sent-back — call the worker in', '#/hr/workers', 'warn'),
        dashTask(regsPending.length, 'doc', 'Regularisations with Central HR', 'Raised, not yet decided', '#/hr/regularisations', ''),
        dashTask(transfersIn.length, 'inbox', 'Transfers to accept at this site', 'Worker moving here from another site', '#/hr/requests', 'primary'),
        dashTask(awaitingCentral.length, 'check', 'Sent to Central HR for approval', 'Nothing to do — waiting', '#/hr/approvals', ''),
      ].join('');
      renderShell(`
        ${dashHero({ title: esc(site), pct: pctOf(d) })}
        ${dashActions([
          hasPerm('workers.register_assisted') && { icon: 'user', label: 'Register worker', onclick: "location.hash='#/hr/assist';render()" },
          { icon: 'shield', label: 'Gate check', onclick: "location.hash='#/hr/gate';render()" },
          { icon: 'calendar', label: 'Attendance', onclick: "location.hash='#/hr/attendance';render()" },
        ])}
        ${dashRow([{ value: d.active, label: 'On site' }, { value: d.punchedIn, label: 'In' }, { value: d.punchedOut, label: 'Out' }, { value: notIn.length, label: 'Not yet in', href: '#/hr/attendance' }, { value: d.blocked, label: 'Blocked', href: '#/hr/exceptions' }])}
        <div class="card">
          <h3>To do today</h3>
          ${tasks || emptyState('Nothing waiting on you — all caught up.', 'check')}
        </div>
        ${dashPeople(notIn, { title: 'Not punched in yet', emptyText: 'Everyone on site has punched in.', showAll: '#/hr/attendance' })}
      `);
    });
}
function dashTask(n, iconName, label, sub, href, tone) {
  return n ? `
    <div class="dash-task ${tone || ''}" onclick="location.hash='${href}';render()">
      <span class="dash-task-icon">${icon(iconName)}</span>
      <div class="dash-task-text"><b>${label}</b><span class="muted small">${sub}</span></div>
      <span class="dash-task-count">${n}</span>
    </div>` : '';
}

// ---- Reporting Manager (BRD: sees own team; raises transfer/exit; gets the 10:30
// "my team today" email). The home IS that email, live, by name. ----
function renderManagerDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.dashboard({}), dashPeopleRows(), fetchIfAllowed('requests.view', () => window.Api.listWorkerRequests())]), ([d, people, requests]) => {
    const present = people.filter(r => r.st.status === 'present' || r.st.status === 'half_day');
    const stillIn = people.filter(r => r.st.status === 'missed_punch_out');
    const absent = people.filter(r => r.st.status === 'absent');
    const myReqs = requests.filter(r => r.status === 'pending' || r.status === 'accepted');
    const list = (title, rows, tone, empty) => `
      <div class="card">
        <div class="dash-loc-head"><h3 style="margin:0">${title}</h3><span class="badge ${tone}">${rows.length}</span></div>
        ${rows.length === 0 ? `<p class="muted small" style="margin:8px 0 0">${empty}</p>` : rows.map(({ w, st }) => `
          <div class="dash-person" onclick="viewWorker('${w.id}')">
            ${w.photo_data_url ? `<img src="${esc(w.photo_data_url)}" class="thumb" />` : `<div class="thumb placeholder">${icon('user')}</div>`}
            <div class="dash-person-text"><b>${esc(w.name || w.mobile)}</b><span class="muted small">${esc(w.designation || '')}${w.vendor_name ? ' · ' + esc(w.vendor_name) : ''}</span></div>
            <span class="dash-person-status small">${st.inTime ? 'In ' + st.inTime : ''}${st.outTime ? ' · Out ' + st.outTime : ''}</span>
          </div>`).join('')}
      </div>`;
    renderShell(`
      ${dashHero({ title: 'My team today', pct: pctOf(d), subtitle: `${present.length} present · ${absent.length} not in · ${stillIn.length} still in` })}
      ${list('Not punched in', absent, absent.length ? 'badge-bad' : 'badge-ok', 'Everyone has reported.')}
      ${list('Still on site (no punch-out)', stillIn, stillIn.length ? 'badge-warn' : 'badge-ok', 'Nobody is still inside.')}
      ${list('Present', present, 'badge-ok', 'Nobody has punched in yet.')}
      ${dashActions([
        { icon: 'doc', label: 'Request transfer / exit', onclick: "location.hash='#/hr/requests';render()" },
        { icon: 'calendar', label: 'Past days', onclick: "location.hash='#/hr/attendance';render()" },
        { icon: 'doc', label: 'Excel', onclick: "location.hash='#/hr/reports';render()" },
      ])}
      ${myReqs.length ? `<div class="card"><h3>My open requests</h3>${myReqs.map(r => `<div class="dash-kv"><span>${esc(r.worker_name)} — ${r.type}</span><span class="badge badge-warn">${r.status === 'accepted' ? 'with Central HR' : 'pending'}</span></div>`).join('')}</div>` : ''}
    `);
  });
}

// ---- Vendor Coordinator (BRD: sees own vendor's workers and own bill; cannot change
// anything). A supplier portal: what am I owed, and are my people turning up. ----
function renderVendorDashboard() {
  const s = requireHr(); if (!s) return;
  const month = lastMonthStr();
  withLoading(() => Promise.all([window.Api.dashboard({}), dashPeopleRows(), fetchIfAllowed('billing.read', () => window.Api.vendorBill(month)), window.Api.listWorkers()]), ([d, people, bill, allWorkers]) => {
    const mine = bill && bill.rows ? bill.rows[0] : null;
    const pendingReg = allWorkers.filter(w => w.status === 'pending' || w.status === 'draft' || w.status === 'sent_back').length;
    const absent = people.filter(r => r.st.status === 'absent');
    renderShell(`
      ${dashHero({ title: 'My workers', pct: pctOf(d), subtitle: `${d.active} deployed · ${absent.length} not in today` })}
      <div class="card">
        <div class="dash-loc-head"><h3 style="margin:0">Payable · ${month}</h3>${bill ? `<span class="badge ${bill.locked ? 'badge-ok' : 'badge-warn'}">${bill.locked ? 'Final' : 'Provisional'}</span>` : ''}</div>
        <div class="dash-bill-big"><b>${mine ? mine.systemDays : 0}</b><span>system days${mine ? ` across ${mine.workers} worker${mine.workers === 1 ? '' : 's'}` : ''}</span></div>
        ${mine && mine.invoiceDays != null ? `<div class="dash-kv"><span>Your invoice</span><b>${mine.invoiceDays} days</b></div>
          <div class="dash-kv"><span>Difference</span><b style="color:${mine.gap > 0 ? 'var(--bad)' : mine.gap < 0 ? 'var(--warn)' : 'var(--accent-dark)'}">${mine.gap > 0 ? '+' : ''}${mine.gap}${mine.gap === 0 ? ' · matches' : ' days'}</b></div>` : `<p class="muted small">${bill && bill.locked ? 'Finance has not entered your invoice yet.' : 'Month not locked — days can still change until Central HR locks it.'}</p>`}
        <a href="#/hr/billing" class="link-btn small">Day-wise breakup →</a>
      </div>
      ${dashRow([{ value: d.punchedIn, label: 'In today' }, { value: absent.length, label: 'Not in', href: '#/hr/attendance' }, { value: d.blocked, label: 'Blocked', href: '#/hr/exceptions' }, { value: pendingReg, label: 'Registering' }])}
      ${dashPeople(absent, { title: 'Not in today', emptyText: 'All your workers have punched in.', showAll: '#/hr/attendance' })}
      ${dashPeople(people.filter(r => r.st.status !== 'absent'), { title: 'On site', limit: 50 })}
    `);
  });
}

// ---- Location Head (BRD: own location, read-only, gate check). Oversight, not
// operations: is the site running, and is anything wrong. ----
function renderLocationHeadDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.dashboard({}), window.Api.listPunches({ result: 'blocked' }), window.Api.listPunches({ minRisk: 20 }), fetchIfAllowed('regularisations.read', () => window.Api.listRegularisations()), fetchIfAllowed('requests.view', () => window.Api.listWorkerRequests())]),
    ([d, blocked, risky, regs, requests]) => {
      const site = d.byLocation[0] ? d.byLocation[0].location : 'My location';
      const today = todayStr(Date.now());
      const todayBlocked = blocked.filter(p => todayStr(p.ts) === today).length;
      const pendingRegs = regs.filter(r => r.status === 'pending').length;
      const pendingReqs = requests.filter(r => r.status === 'pending' || r.status === 'accepted').length;
      const healthy = d.notPunched === 0 && todayBlocked === 0;
      renderShell(`
        ${dashHero({ title: esc(site), pct: pctOf(d), tone: healthy ? 'ok' : '' })}
        ${dashTiles([
          { icon: 'warn', value: d.notPunched, label: 'Not on site yet', tone: d.notPunched ? 'warn' : 'ok', href: '#/hr/attendance' },
          { icon: 'shield', value: todayBlocked, label: 'Blocked attempts today', tone: todayBlocked ? 'bad' : 'ok', href: '#/hr/exceptions' },
        ])}
        ${dashBreakdown('Vendors on this site', d.byVendor || [], 'vendor', 'No vendors deployed here yet.', 'building')}
        ${dashAttention(blocked, risky)}
        ${dashRow([{ value: d.active, label: 'Strength' }, { value: d.punchedIn, label: 'In' }, { value: d.punchedOut, label: 'Out' }, { value: pendingRegs, label: 'Corrections pending', href: '#/hr/regularisations' }, { value: pendingReqs, label: 'Moves pending', href: '#/hr/requests' }])}
        ${dashActions([{ icon: 'shield', label: 'Gate check', onclick: "location.hash='#/hr/gate';render()" }, { icon: 'calendar', label: 'Register', onclick: "location.hash='#/hr/attendance';render()" }, { icon: 'doc', label: 'Excel', onclick: "location.hash='#/hr/reports';render()" }])}
      `);
    });
}

// ---- MIS / Finance (BRD R16: enters invoice days after Central HR locks the month;
// vendors are paid on system days only). Home is the month-end checklist. ----
function renderFinanceDashboard() {
  const s = requireHr(); if (!s) return;
  const month = window._financeDashMonth || lastMonthStr();
  withLoading(() => Promise.all([window.Api.vendorBill(month), window.Api.dashboard({})]), ([bill, d]) => {
    const rows = bill.rows || [];
    const entered = rows.filter(r => r.invoiceDays != null), missing = rows.filter(r => r.invoiceDays == null);
    const gaps = rows.filter(r => r.gap != null && r.gap !== 0).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
    const totalDays = Math.round(rows.reduce((a, r) => a + (r.systemDays || 0), 0) * 10) / 10;
    const over = Math.round(gaps.filter(r => r.gap > 0).reduce((a, r) => a + r.gap, 0) * 10) / 10;
    const step = (done, label, sub) => `<div class="dash-step ${done ? 'done' : ''}"><span class="dash-step-mark">${done ? '✓' : ''}</span><div><b>${label}</b><span class="muted small">${sub}</span></div></div>`;
    renderShell(`
      ${dashHero({ title: 'Month-end', subtitle: `<input type="month" class="input dash-month" value="${month}" max="${todayStr(Date.now()).slice(0, 7)}" onchange="window._financeDashMonth=this.value;renderFinanceDashboard()" />`, big: totalDays, bigLabel: 'payable days' })}
      <div class="card">
        <h3>Checklist · ${month}</h3>
        ${step(bill.locked, 'Attendance locked by Central HR', bill.locked ? `Locked ${bill.lock && bill.lock.locked_at ? new Date(bill.lock.locked_at).toLocaleDateString() : ''}` : 'Waiting — invoices can be entered only after this')}
        ${step(rows.length > 0 && missing.length === 0, `Invoice days entered · ${entered.length}/${rows.length} vendors`, missing.length ? missing.map(r => esc(r.vendorName)).join(', ') + ' pending' : rows.length ? 'All vendors entered' : 'No vendors with attendance this month')}
        ${step(rows.length > 0 && missing.length === 0 && gaps.length === 0, gaps.length ? `${gaps.length} vendor${gaps.length === 1 ? '' : 's'} with a gap` : 'Gaps resolved', gaps.length ? `Over-billed total: +${over} days — reconcile before payment` : 'Every entered invoice matches system days')}
      </div>
      ${dashTiles([
        { icon: 'ledger', value: missing.length, label: 'Invoices to enter', tone: missing.length ? 'warn' : 'ok', href: '#/hr/billing' },
        { icon: 'warn', value: gaps.length, label: 'Gaps to reconcile', tone: gaps.length ? 'bad' : 'ok', href: '#/hr/billing' },
      ])}
      ${gaps.length ? `<div class="card"><h3>Largest gaps</h3>${gaps.slice(0, 5).map(r => `
        <div class="dash-kv"><span>${esc(r.vendorName)}<br/><span class="muted small">${r.systemDays} system · ${r.invoiceDays} invoiced</span></span><b style="color:${r.gap > 0 ? 'var(--bad)' : 'var(--warn)'}">${r.gap > 0 ? '+' : ''}${r.gap}</b></div>`).join('')}
        <a href="#/hr/billing" class="link-btn small" style="display:inline-block;margin-top:8px">Open bill check →</a></div>` : ''}
      ${dashRow([{ value: rows.length, label: 'Vendors' }, { value: d.active, label: 'Active workers' }, { value: entered.length, label: 'Entered' }])}
      ${dashActions([{ icon: 'ledger', label: 'Vendor bill check', onclick: "location.hash='#/hr/billing';render()" }, { icon: 'doc', label: 'Muster roll', onclick: "location.hash='#/hr/reports';render()" }, { icon: 'sparkle', label: 'Ask AI', onclick: "location.hash='#/hr/ask';render()" }])}
    `);
  });
}

// ---- Security (BRD: gate check; sees blocked punches + audit only; no worker list).
// Home is the gate: search box first, then what was blocked today. ----
function renderSecurityDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => window.Api.listPunches({ result: 'blocked' }), (blocked) => {
    const today = todayStr(Date.now());
    const todays = blocked.filter(p => todayStr(p.ts) === today).sort((a, b) => b.ts - a.ts);
    renderShell(`
      ${dashHero({ title: 'Gate', subtitle: DASH_DATE(), big: todays.length, bigLabel: 'blocked today', tone: todays.length ? 'warn' : 'ok' })}
      <div class="card">
        <h3>Check a person at the gate</h3>
        <p class="muted small">No HR approval, no entry. Type the mobile number or name, then compare the photo with the person in front of you.</p>
        <input id="gate_q" class="input" placeholder="Mobile or name" onkeydown="if(event.key==='Enter')gateSearch()" />
        <button class="btn primary block big" onclick="gateSearch()">Check</button>
        <div id="gate_results"></div>
      </div>
      <div class="card">
        <h3>Blocked today</h3>
        ${todays.length === 0 ? emptyState('No blocked punch attempts today.', 'shield') : todays.map(p => `
          <div class="dash-person">
            ${thumbHtml(p.selfie_data_url)}
            <div class="dash-person-text"><b>${esc(p.worker_name || p.worker_id)}</b><span class="muted small">${p.type.toUpperCase()} · ${new Date(p.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
            <span class="badge badge-bad">${esc(reasonLabel(p.reason))}</span>
          </div>`).join('')}
        <a href="#/hr/exceptions" class="link-btn small" style="display:inline-block;margin-top:8px">All blocked attempts →</a>
      </div>
    `);
  });
}

// ---- System Admin (BRD: masters, users, gate tablets; no worker data). Home is the
// setup state of the system — what's configured, what isn't. ----
function renderAdminDashboard() {
  const s = requireHr(); if (!s) return;
  withLoading(() => Promise.all([window.Api.listVendors(), window.Api.listLocations(), window.Api.listAdminUsers(), fetchIfAllowed('kiosks.manage', () => window.Api.listKiosks())]), ([vendors, locations, users, kiosks]) => {
    const today = todayStr(Date.now());
    const activeVendors = vendors.filter(v => v.status !== 'inactive' && !(v.contract_end && v.contract_end < today));
    const expiring = vendors.filter(v => v.contract_end && v.contract_end >= today && (new Date(v.contract_end) - Date.now()) < 30 * 86400000);
    const noKyc = activeVendors.filter(v => !v.contact_aadhaar_qr_at && !v.contact_pan_number);
    const activeUsers = users.filter(u => u.status === 'active');
    const byRole = activeUsers.reduce((m, u) => { m[u.role] = (m[u.role] || 0) + 1; return m; }, {});
    const unscoped = activeUsers.filter(u => (['site_hr', 'location_head'].includes(u.role) && !u.location_id) || (u.role === 'vendor_coordinator' && !u.vendor_id));
    const pairedKiosks = kiosks.filter(k => k.status === 'active' && k.paired_at), unpaired = kiosks.filter(k => k.status === 'active' && !k.paired_at);
    const sitesWithKiosk = locations.filter(l => kiosks.some(k => k.location_id === l.id && k.status === 'active' && k.paired_at)).length;
    const issues = [
      dashTask(unscoped.length, 'warn', 'Users with no site/vendor assigned', 'They see nothing until assigned', '#/hr/users', 'bad'),
      dashTask(unpaired.length, 'camera', 'Gate tablets created but never paired', 'Pairing code may have expired', '#/hr/kiosks', 'warn'),
      dashTask(expiring.length, 'building', 'Vendor contracts ending within 30 days', 'Workers under them stop being able to register', '#/hr/masters', 'warn'),
      dashTask(noKyc.length, 'user', 'Active vendors with no contact KYC', 'Aadhaar/PAN of the authorised contact', '#/hr/masters', ''),
    ].join('');
    renderShell(`
      ${dashHero({ title: 'System setup', subtitle: `${locations.length} site${locations.length === 1 ? '' : 's'} · ${activeVendors.length} vendor${activeVendors.length === 1 ? '' : 's'} · ${activeUsers.length} user${activeUsers.length === 1 ? '' : 's'}`, big: pairedKiosks.length, bigLabel: 'tablets live' })}
      <div class="card">
        <h3>Needs setup</h3>
        ${issues || emptyState('Everything is configured.', 'check')}
      </div>
      ${dashTiles([
        { icon: 'building', value: locations.length, label: 'Sites', href: '#/hr/masters', tone: 'primary' },
        { icon: 'camera', value: `${sitesWithKiosk}/${locations.length}`, label: 'Sites with a live gate tablet', href: '#/hr/kiosks', tone: sitesWithKiosk < locations.length ? 'warn' : 'ok' },
      ])}
      <div class="card">
        <h3>Users by role</h3>
        ${Object.entries(ROLE_LABELS).map(([k, label]) => `<div class="dash-kv"><span>${label}</span><b>${byRole[k] || 0}</b></div>`).join('')}
        <a href="#/hr/users" class="link-btn small" style="display:inline-block;margin-top:8px">Manage users →</a>
      </div>
      ${dashActions([{ icon: 'user', label: 'Add user', onclick: "location.hash='#/hr/users';render()" }, { icon: 'building', label: 'Vendors & sites', onclick: "location.hash='#/hr/masters';render()" }, { icon: 'camera', label: 'Gate tablets', onclick: "location.hash='#/hr/kiosks';render()" }])}
    `);
  });
}

// '#/hr/dashboard' for the roles without a dedicated hash. Security never gets here
// (its home is Gate check); System Admin has no worker data to put on a dashboard.
function renderHrDashboard() {
  const role = (getSession() || {}).role;
  return ({ central_hr: renderCentralHrDashboard, site_hr: renderSiteHrDashboard, reporting_manager: renderManagerDashboard, vendor_coordinator: renderVendorDashboard, security: renderSecurityDashboard, system_admin: renderAdminDashboard }[role] || renderCentralHrDashboard)();
}
function dashLabel() {
  return { site_hr: 'My site', reporting_manager: 'My team', vendor_coordinator: 'My workers', security: 'Gate', system_admin: 'Setup' }[(getSession() || {}).role] || t('hrDashboard');
}

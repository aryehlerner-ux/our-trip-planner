/* ---------- Data layer ---------- */

const STORAGE_KEY = 'tripPlannerData_v1';

function defaultData() {
  return {
    meta: {
      tripStartDate: '', // ISO date string, set in Settings
      lastExportDate: null
    },
    stops: [] // { id, country, durationDays, notes }
  };
}

let data = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    // merge with defaults in case of missing fields (forward-compatible)
    return Object.assign(defaultData(), parsed);
  } catch (e) {
    console.error('Could not read saved data, starting fresh.', e);
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function uid() {
  return 's_' + Math.random().toString(36).slice(2, 10);
}

/* ---------- Date math ---------- */
// Every stop is a *duration*, not a fixed date. Dates are computed forward
// from the trip start date. Reordering, editing a duration, or inserting a
// new stop just re-runs this function — nothing has to be re-typed.

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function computeStopDates() {
  const start = data.meta.tripStartDate;
  let cursor = start;
  return data.stops.map((stop) => {
    const startDate = cursor;
    const endDate = start ? addDays(cursor, stop.durationDays) : '';
    if (start) cursor = endDate;
    return { ...stop, startDate, endDate };
  });
}

function daysUntil(iso) {
  if (!iso) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(iso + 'T00:00:00');
  return Math.round((target - today) / 86400000);
}

/* ---------- Toast ---------- */

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Navigation ---------- */

let currentView = 'dashboard';

function setView(view) {
  currentView = view;
  document.querySelectorAll('nav.bottom-nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  render();
}

/* ---------- Rendering ---------- */

function render() {
  const main = document.getElementById('main');
  if (currentView === 'dashboard') main.innerHTML = renderDashboard();
  else if (currentView === 'route') main.innerHTML = renderRoute();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  attachHandlers();
}

function renderDashboard() {
  const stops = computeStopDates();
  const start = data.meta.tripStartDate;
  const toDeparture = daysUntil(start);
  const totalDays = stops.reduce((sum, s) => sum + Number(s.durationDays || 0), 0);
  const plannedCountries = stops.length;

  const nextStops = stops.slice(0, 3);

  let chips = `
    <div class="stat-chip ${toDeparture !== null && toDeparture < 0 ? 'warn' : ''}">
      <div class="num">${toDeparture === null ? '—' : toDeparture}</div>
      <div class="label">Days to departure</div>
    </div>
    <div class="stat-chip">
      <div class="num">${plannedCountries}</div>
      <div class="label">Stops planned</div>
    </div>
    <div class="stat-chip">
      <div class="num">${totalDays}</div>
      <div class="label">Total days routed</div>
    </div>
  `;

  let nextHtml = '';
  if (!start) {
    nextHtml = `<div class="empty-state">Set your trip start date in Settings to see computed dates here.</div>`;
  } else if (nextStops.length === 0) {
    nextHtml = `<div class="empty-state">No stops yet.<br><button class="btn btn-primary" data-goto="route">Add your first stop</button></div>`;
  } else {
    nextHtml = nextStops
      .map(
        (s) => `
      <div class="card stop-card">
        <div class="stop-main">
          <div class="country">${escapeHtml(s.country)}</div>
          <div class="dates">${formatDate(s.startDate)} – ${formatDate(s.endDate)} · ${s.durationDays} days</div>
        </div>
      </div>`
      )
      .join('');
  }

  return `
    <div class="section-title">Trip health</div>
    <div class="stat-row">${chips}</div>
    <div class="section-title">Next up</div>
    ${nextHtml}
  `;
}

function renderRoute() {
  const stops = computeStopDates();
  const start = data.meta.tripStartDate;

  const list = stops.length
    ? stops
        .map(
          (s, i) => `
      <div class="card stop-card" data-id="${s.id}">
        <div class="reorder-btns">
          <button class="icon-btn" data-action="up" data-id="${s.id}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button>
          <button class="icon-btn" data-action="down" data-id="${s.id}" ${i === stops.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>
        </div>
        <div class="stop-main">
          <div class="country">${escapeHtml(s.country)}</div>
          <div class="dates">${start ? formatDate(s.startDate) + ' – ' + formatDate(s.endDate) + ' · ' : ''}${s.durationDays} days${s.notes ? ' · ' + escapeHtml(s.notes) : ''}</div>
        </div>
        <div class="actions">
          <button class="icon-btn" data-action="edit" data-id="${s.id}">✎</button>
          <button class="icon-btn" data-action="delete" data-id="${s.id}">✕</button>
        </div>
      </div>`
        )
        .join('')
    : `<div class="empty-state">No stops yet. Add your first one below — you'll set how many days you'll spend there, and dates fill in automatically.</div>`;

  return `
    <div class="section-title">Route</div>
    ${!start ? `<div class="card" style="background:#fff7e6;border-color:var(--amber)">Set your trip start date in <b>Settings</b> so dates can be calculated. You can still add stops without it.</div>` : ''}
    ${list}
    <button class="btn btn-primary btn-block" id="btn-add-stop" style="margin-top:10px">+ Add a stop</button>
    <div id="stop-form-slot"></div>
  `;
}

function renderStopForm(existing) {
  const isEdit = !!existing;
  const s = existing || { country: '', durationDays: 14, notes: '' };
  return `
    <form class="inline-form" id="stop-form">
      <label>Country / base</label>
      <input name="country" value="${escapeAttr(s.country)}" placeholder="e.g. Peru" required />
      <label>Length of stay (days)</label>
      <input name="durationDays" type="number" min="1" value="${s.durationDays}" required />
      <label>Notes (optional)</label>
      <input name="notes" value="${escapeAttr(s.notes || '')}" placeholder="e.g. Pesach base, self-catering apt" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add stop'}</button>
        <button type="button" class="btn btn-secondary" id="cancel-stop-form">Cancel</button>
      </div>
    </form>
  `;
}

function renderSettings() {
  return `
    <div class="section-title">Trip settings</div>
    <div class="settings-block">
      <h3>Trip start date</h3>
      <p class="hint">Used to calculate every stop's dates automatically from your route order and stay lengths.</p>
      <input type="date" id="trip-start-input" value="${data.meta.tripStartDate || ''}" />
    </div>

    <div class="section-title">Backup</div>
    <div class="settings-block">
      <h3>Export your data</h3>
      <p class="hint">Saves everything in this app to a file. Keep this safe, and share it with your spouse to keep both of you in sync — they can Import it on their phone.</p>
      <button class="btn btn-primary btn-block" id="btn-export">Export backup file</button>
      ${data.meta.lastExportDate ? `<p class="hint" style="margin-top:8px">Last exported: ${new Date(data.meta.lastExportDate).toLocaleString()}</p>` : ''}
    </div>
    <div class="settings-block">
      <h3>Import a backup file</h3>
      <p class="hint">This replaces everything currently in the app with what's in the file. Use this to load your spouse's updates, or restore a backup.</p>
      <input type="file" id="import-file" accept="application/json" />
    </div>
  `;
}

/* ---------- Handlers ---------- */

function attachHandlers() {
  document.querySelectorAll('[data-goto]').forEach((b) =>
    b.addEventListener('click', () => setView(b.dataset.goto))
  );

  if (currentView === 'route') {
    const addBtn = document.getElementById('btn-add-stop');
    if (addBtn) {
      addBtn.addEventListener('click', () => {
        document.getElementById('stop-form-slot').innerHTML = renderStopForm(null);
        wireStopForm(null);
      });
    }
    document.querySelectorAll('[data-action="up"]').forEach((b) =>
      b.addEventListener('click', () => moveStop(b.dataset.id, -1))
    );
    document.querySelectorAll('[data-action="down"]').forEach((b) =>
      b.addEventListener('click', () => moveStop(b.dataset.id, 1))
    );
    document.querySelectorAll('[data-action="delete"]').forEach((b) =>
      b.addEventListener('click', () => deleteStop(b.dataset.id))
    );
    document.querySelectorAll('[data-action="edit"]').forEach((b) =>
      b.addEventListener('click', () => {
        const stop = data.stops.find((s) => s.id === b.dataset.id);
        document.getElementById('stop-form-slot').innerHTML = renderStopForm(stop);
        wireStopForm(stop);
      })
    );
  }

  if (currentView === 'settings') {
    document.getElementById('trip-start-input').addEventListener('change', (e) => {
      data.meta.tripStartDate = e.target.value;
      saveData();
      toast('Trip start date updated.');
    });
    document.getElementById('btn-export').addEventListener('click', exportData);
    document.getElementById('import-file').addEventListener('change', importData);
  }
}

function wireStopForm(existing) {
  const form = document.getElementById('stop-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const country = fd.get('country').trim();
    const durationDays = Math.max(1, parseInt(fd.get('durationDays'), 10) || 1);
    const notes = (fd.get('notes') || '').trim();
    if (existing) {
      Object.assign(existing, { country, durationDays, notes });
      toast('Stop updated.');
    } else {
      data.stops.push({ id: uid(), country, durationDays, notes });
      toast('Stop added.');
    }
    saveData();
    render();
  });
  document.getElementById('cancel-stop-form').addEventListener('click', () => {
    document.getElementById('stop-form-slot').innerHTML = '';
  });
}

function moveStop(id, direction) {
  const idx = data.stops.findIndex((s) => s.id === id);
  const swapWith = idx + direction;
  if (swapWith < 0 || swapWith >= data.stops.length) return;
  [data.stops[idx], data.stops[swapWith]] = [data.stops[swapWith], data.stops[idx]];
  saveData();
  render();
}

function deleteStop(id) {
  if (!confirm('Remove this stop from your route?')) return;
  data.stops = data.stops.filter((s) => s.id !== id);
  saveData();
  render();
}

/* ---------- Export / Import ---------- */

function exportData() {
  data.meta.lastExportDate = new Date().toISOString();
  saveData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `trip-planner-backup-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  render();
  toast('Backup file downloaded.');
}

function importData(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || !Array.isArray(parsed.stops)) throw new Error('Not a recognized backup file.');
      if (!confirm('This will replace everything currently in the app with this file. Continue?')) return;
      data = Object.assign(defaultData(), parsed);
      saveData();
      toast('Backup imported.');
      render();
    } catch (err) {
      alert('Could not read that file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

/* ---------- Small utils ---------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function escapeAttr(str) {
  return escapeHtml(str);
}

/* ---------- Init ---------- */

document.querySelectorAll('nav.bottom-nav button').forEach((b) =>
  b.addEventListener('click', () => setView(b.dataset.view))
);

render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

/* ---------- Data layer ---------- */

const STORAGE_KEY = 'tripPlannerData_v1';

const DAY_TYPES = [
  { value: 'unset', label: 'Not set' },
  { value: 'travel', label: 'Travel day' },
  { value: 'work-base', label: 'Work-base day' },
  { value: 'light-local', label: 'Light local day' },
  { value: 'intensive-excursion', label: 'Intensive excursion day' },
  { value: 'rest-family', label: 'Rest & family day' },
  { value: 'shabbat-holiday', label: 'Shabbat / holiday day' },
  { value: 'buffer', label: 'Buffer day' }
];

const TRANSPORT_MODES = ['Flight', 'Train', 'Bus', 'Car rental', 'Taxi / rideshare', 'Private driver', 'Public transit', 'Ferry', 'Other'];
const TRANSPORT_KINDS = ['Arrival', 'Local', 'Departure'];

function defaultData() {
  return {
    meta: { tripStartDate: '', lastExportDate: null },
    stops: []
  };
}

function defaultStop() {
  return {
    id: '', country: '', durationDays: 14, notes: '',
    dayTypes: {},
    attractionBank: [],
    accommodations: [],
    transport: [],
    countryInfo: { currency: '', language: '', plug: '', emergency: '', visaNotes: '', notes: '' }
  };
}

let data = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    const merged = Object.assign(defaultData(), parsed);
    merged.stops = (merged.stops || []).map((s) => Object.assign(defaultStop(), s));
    return merged;
  } catch (e) {
    console.error('Could not read saved data, starting fresh.', e);
    return defaultData();
  }
}

function saveData() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

function uid(prefix) {
  return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 10);
}

/* ---------- Date math ---------- */

function addDays(isoDate, days) {
  const d = new Date(isoDate + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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

function stopById(id) {
  return data.stops.find((s) => s.id === id);
}

function stopWithDatesById(id) {
  return computeStopDates().find((s) => s.id === id);
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

/* ---------- Navigation state ---------- */

let currentView = 'dashboard'; // dashboard | route | stop | settings
let currentStopId = null;
let currentStopTab = 'days'; // days | attractions | stay | transport | info

function setView(view) {
  currentView = view;
  currentStopId = null;
  document.querySelectorAll('nav.bottom-nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.view === view)
  );
  render();
}

function openStop(id) {
  currentView = 'stop';
  currentStopId = id;
  currentStopTab = 'days';
  document.querySelectorAll('nav.bottom-nav button').forEach((b) => b.classList.remove('active'));
  render();
}

/* ---------- Rendering root ---------- */

function render() {
  const main = document.getElementById('main');
  if (currentView === 'dashboard') main.innerHTML = renderDashboard();
  else if (currentView === 'route') main.innerHTML = renderRoute();
  else if (currentView === 'stop') main.innerHTML = renderStopWorkspace();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  attachHandlers();
}

/* ---------- Dashboard ---------- */

function renderDashboard() {
  const stops = computeStopDates();
  const start = data.meta.tripStartDate;
  const toDeparture = daysUntil(start);
  const totalDays = stops.reduce((sum, s) => sum + Number(s.durationDays || 0), 0);

  let unscheduled = 0, missingAccom = 0;
  stops.forEach((s) => {
    unscheduled += (s.attractionBank || []).filter((a) => a.scheduledDay === null || a.scheduledDay === undefined).length;
    const nightsCovered = new Set();
    (s.accommodations || []).forEach((a) => {
      for (let i = a.startDayIndex; i < a.startDayIndex + a.nights; i++) nightsCovered.add(i);
    });
    if (nightsCovered.size < s.durationDays) missingAccom++;
  });

  const chips = `
    <div class="stat-chip ${toDeparture !== null && toDeparture < 0 ? 'warn' : ''}">
      <div class="num">${toDeparture === null ? '—' : toDeparture}</div>
      <div class="label">Days to departure</div>
    </div>
    <div class="stat-chip">
      <div class="num">${stops.length}</div>
      <div class="label">Stops planned</div>
    </div>
    <div class="stat-chip">
      <div class="num">${totalDays}</div>
      <div class="label">Total days routed</div>
    </div>
    <div class="stat-chip ${unscheduled ? 'warn' : ''}">
      <div class="num">${unscheduled}</div>
      <div class="label">Attractions to schedule</div>
    </div>
    <div class="stat-chip ${missingAccom ? 'danger' : ''}">
      <div class="num">${missingAccom}</div>
      <div class="label">Stops missing full stay coverage</div>
    </div>
  `;

  const nextStops = stops.slice(0, 3);
  const nextHtml = nextStops.length
    ? nextStops.map((s) => `
      <div class="card stop-card" data-open-stop="${s.id}">
        <div class="stop-main">
          <div class="country">${escapeHtml(s.country)}</div>
          <div class="dates">${formatDate(s.startDate)} – ${formatDate(s.endDate)} · ${s.durationDays} days</div>
        </div>
        <div class="chevron">›</div>
      </div>`).join('')
    : `<div class="empty-state">No stops yet.<br><button class="btn btn-primary" data-goto="route">Add your first stop</button></div>`;

  return `
    <div class="section-title">Trip health</div>
    <div class="stat-row">${chips}</div>
    <div class="section-title">Next up</div>
    ${nextHtml}
  `;
}

/* ---------- Route (country-level list) ---------- */

function renderRoute() {
  const stops = computeStopDates();
  const start = data.meta.tripStartDate;

  const list = stops.length
    ? stops.map((s, i) => `
      <div class="card stop-card" data-id="${s.id}">
        <div class="reorder-btns">
          <button class="icon-btn" data-action="up" data-id="${s.id}" ${i === 0 ? 'disabled style="opacity:.3"' : ''}>▲</button>
          <button class="icon-btn" data-action="down" data-id="${s.id}" ${i === stops.length - 1 ? 'disabled style="opacity:.3"' : ''}>▼</button>
        </div>
        <div class="stop-main" data-open-stop="${s.id}">
          <div class="country">${escapeHtml(s.country)}</div>
          <div class="dates">${start ? formatDate(s.startDate) + ' – ' + formatDate(s.endDate) + ' · ' : ''}${s.durationDays} days${s.notes ? ' · ' + escapeHtml(s.notes) : ''}</div>
        </div>
        <div class="actions">
          <button class="icon-btn" data-action="edit" data-id="${s.id}">✎</button>
          <button class="icon-btn" data-action="delete" data-id="${s.id}">✕</button>
        </div>
      </div>`).join('')
    : `<div class="empty-state">No stops yet. Add your first one below — tap a stop afterward to plan its days, attractions, accommodation, and transport.</div>`;

  return `
    <div class="section-title">Route</div>
    ${!start ? `<div class="card" style="background:#fff7e6;border-color:var(--amber)">Set your trip start date in <b>Settings</b> so dates can be calculated.</div>` : ''}
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

/* ---------- Stop workspace (day-to-day planning lives here) ---------- */

function renderStopWorkspace() {
  const stop = stopById(currentStopId);
  if (!stop) { setView('route'); return ''; }
  const withDates = stopWithDatesById(currentStopId);

  const tabs = [
    { key: 'days', label: 'Days' },
    { key: 'attractions', label: 'Attractions' },
    { key: 'stay', label: 'Stay' },
    { key: 'transport', label: 'Transport' },
    { key: 'info', label: 'Country info' }
  ];

  const tabBar = `
    <div class="stop-tabs">
      ${tabs.map((t) => `<button class="stop-tab ${currentStopTab === t.key ? 'active' : ''}" data-stop-tab="${t.key}">${t.label}</button>`).join('')}
    </div>
  `;

  let body = '';
  if (currentStopTab === 'days') body = renderDaysTab(stop, withDates);
  else if (currentStopTab === 'attractions') body = renderAttractionsTab(stop);
  else if (currentStopTab === 'stay') body = renderStayTab(stop, withDates);
  else if (currentStopTab === 'transport') body = renderTransportTab(stop);
  else if (currentStopTab === 'info') body = renderInfoTab(stop);

  return `
    <button class="btn-back" id="btn-back-to-route">‹ Route</button>
    <div class="stop-header">
      <div class="country">${escapeHtml(stop.country)}</div>
      <div class="dates">${withDates.startDate ? formatDate(withDates.startDate) + ' – ' + formatDate(withDates.endDate) : ''} · ${stop.durationDays} days</div>
      <a class="map-link" target="_blank" rel="noopener" href="${mapsSearchUrl(stop.country)}">View country on map ↗</a>
    </div>
    ${tabBar}
    ${body}
  `;
}

/* ----- Days tab ----- */

function renderDaysTab(stop, withDates) {
  const rows = [];
  for (let i = 0; i < stop.durationDays; i++) {
    const date = withDates.startDate ? addDays(withDates.startDate, i) : '';
    const dayType = stop.dayTypes[i] || 'unset';
    const scheduled = (stop.attractionBank || []).filter((a) => a.scheduledDay === i);
    const accom = (stop.accommodations || []).find((a) => i >= a.startDayIndex && i < a.startDayIndex + a.nights);

    rows.push(`
      <div class="card day-card">
        <div class="day-card-head">
          <div>
            <div class="day-num">Day ${i + 1}</div>
            <div class="dates">${date ? formatDate(date) : ''}</div>
          </div>
          <select class="day-type-select" data-day="${i}">
            ${DAY_TYPES.map((dt) => `<option value="${dt.value}" ${dt.value === dayType ? 'selected' : ''}>${dt.label}</option>`).join('')}
          </select>
        </div>
        <div class="day-accom">${accom ? '🛏 Sleeping: ' + escapeHtml(accom.name) : '<span class="hint-inline">No accommodation set for this night — add one in the Stay tab.</span>'}</div>
        <div class="day-activities">
          ${scheduled.length ? scheduled.map((a) => `
            <div class="activity-chip">
              <span>${escapeHtml(a.name)}</span>
              <button class="chip-x" data-action="unschedule" data-attr-id="${a.id}">✕</button>
            </div>`).join('') : '<span class="hint-inline">No activities scheduled yet.</span>'}
        </div>
        <button class="btn btn-secondary" data-action="add-activity-to-day" data-day="${i}">+ Add activity to this day</button>
        <div id="day-activity-picker-${i}"></div>
      </div>
    `);
  }
  return rows.join('');
}

function renderActivityPicker(stop, dayIndex) {
  const unscheduled = (stop.attractionBank || []).filter((a) => a.scheduledDay === null || a.scheduledDay === undefined);
  return `
    <div class="picker-box">
      ${unscheduled.length ? `
        <label>Pick from your attraction bank</label>
        <select id="picker-select-${dayIndex}">
          <option value="">— choose —</option>
          ${unscheduled.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
        <button class="btn btn-primary" data-action="schedule-picked" data-day="${dayIndex}">Add to this day</button>
      ` : `<p class="hint">Nothing unscheduled in your bank. Add one below, or visit the Attractions tab.</p>`}
      <label>Or quick-add a new activity directly to this day</label>
      <div class="form-row">
        <input type="text" id="picker-newname-${dayIndex}" placeholder="e.g. Sacred Valley day trip" />
        <button class="btn btn-secondary" data-action="quick-add-scheduled" data-day="${dayIndex}">Add</button>
      </div>
    </div>
  `;
}

/* ----- Attractions tab (attraction bank) ----- */

function renderAttractionsTab(stop) {
  const bank = stop.attractionBank || [];
  const rows = bank.length ? bank.map((a) => `
    <div class="card attr-card">
      <div class="attr-main">
        <div class="attr-name">${escapeHtml(a.name)}</div>
        ${a.notes ? `<div class="hint">${escapeHtml(a.notes)}</div>` : ''}
        <div class="attr-status">${a.scheduledDay !== null && a.scheduledDay !== undefined ? '📅 Scheduled — Day ' + (a.scheduledDay + 1) : '— Unscheduled'}</div>
      </div>
      <button class="icon-btn" data-action="delete-attraction" data-attr-id="${a.id}">✕</button>
    </div>
  `).join('') : `<div class="empty-state">No attractions yet. Add your own, or ask AI for suggestions below and import the list.</div>`;

  return `
    <button class="btn btn-primary btn-block" id="btn-add-attraction">+ Add attraction manually</button>
    <div id="attraction-form-slot"></div>

    <div class="section-title">AI research helper</div>
    <div class="card">
      <p class="hint">Build a ready-to-use prompt for this country, copy it into Claude (or any AI), then paste the suggestions back in below to add them all at once.</p>
      <button class="btn btn-secondary" id="btn-build-ai-prompt">Build AI prompt for ${escapeHtml(stop.country)}</button>
      <div id="ai-prompt-slot"></div>
    </div>
    <div class="card">
      <label>Paste AI suggestions here (one per line)</label>
      <textarea id="ai-import-text" rows="5" placeholder="Paste a list here, e.g.:&#10;Sacred Valley day trip&#10;Rainbow Mountain hike&#10;Cusco market and cooking class"></textarea>
      <button class="btn btn-primary" id="btn-import-ai-list" style="margin-top:8px">Import list as attractions</button>
    </div>

    <div class="section-title">Bank</div>
    ${rows}
  `;
}

function renderAttractionForm() {
  return `
    <form class="inline-form" id="attraction-form">
      <label>Attraction / activity name</label>
      <input name="name" required placeholder="e.g. Rainbow Mountain hike" />
      <label>Notes (optional)</label>
      <input name="notes" placeholder="booking needed, child-suitability, etc." />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Add to bank</button>
        <button type="button" class="btn btn-secondary" id="cancel-attraction-form">Cancel</button>
      </div>
    </form>
  `;
}

function buildAiPrompt(stop) {
  const withDates = stopWithDatesById(stop.id);
  return `I'm planning a family trip and need attraction/activity suggestions for ${stop.country}.
Context:
- Dates: ${withDates.startDate ? formatDate(withDates.startDate) + ' to ' + formatDate(withDates.endDate) : 'not yet set'} (${stop.durationDays} days)
- Travelers: two adults and one young child (about 3 years old)
- Style: slow travel, dramatic nature, authentic local culture, villages, markets, community-run tourism; avoid staged/touristy experiences, shopping, and nightlife
- Practical needs: road quality, child safety, nap disruption, and whether private transport helps should factor into suggestions
- We keep Shabbat (no Friday-Saturday travel) and would like Chabad/kosher notes if relevant

Please suggest a list of specific attractions/activities in ${stop.country} that fit this, each as one line with a short reason, so I can paste them into my planning app.`;
}

/* ----- Stay tab (accommodation) ----- */

function renderStayTab(stop, withDates) {
  const list = stop.accommodations || [];
  const rows = list.length ? list.map((a) => `
    <div class="card">
      <div class="attr-main">
        <div class="attr-name">${escapeHtml(a.name)}</div>
        <div class="hint">Day ${a.startDayIndex + 1}–${a.startDayIndex + a.nights} · ${a.nights} night${a.nights === 1 ? '' : 's'}${a.cost ? ' · ' + a.cost + ' ' + escapeHtml(a.currency || '') : ''}</div>
        ${a.address ? `<a class="map-link" target="_blank" rel="noopener" href="${mapsSearchUrl(a.address)}">${escapeHtml(a.address)} ↗</a>` : ''}
        ${a.confirmation ? `<div class="hint">Confirmation: ${escapeHtml(a.confirmation)}</div>` : ''}
        ${a.notes ? `<div class="hint">${escapeHtml(a.notes)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="delete-accom" data-accom-id="${a.id}">✕</button>
    </div>
  `).join('') : `<div class="empty-state">No accommodation entries yet — add where you'll sleep each night.</div>`;

  return `
    <button class="btn btn-primary btn-block" id="btn-add-accom">+ Add accommodation</button>
    <div id="accom-form-slot"></div>
    <div class="section-title">Where you're sleeping</div>
    ${rows}
  `;
}

function renderAccomForm(stop) {
  return `
    <form class="inline-form" id="accom-form">
      <label>Name</label>
      <input name="name" required placeholder="e.g. Casa Andina Cusco" />
      <label>Address (used for the map link)</label>
      <input name="address" placeholder="e.g. Calle San Agustín 400, Cusco" />
      <div class="form-row">
        <div>
          <label>Starting on day #</label>
          <input name="startDayIndex" type="number" min="1" max="${stop.durationDays}" value="1" required />
        </div>
        <div>
          <label>Number of nights</label>
          <input name="nights" type="number" min="1" value="3" required />
        </div>
      </div>
      <div class="form-row">
        <div>
          <label>Cost</label>
          <input name="cost" type="number" min="0" placeholder="0" />
        </div>
        <div>
          <label>Currency</label>
          <input name="currency" placeholder="USD" />
        </div>
      </div>
      <label>Confirmation code (optional)</label>
      <input name="confirmation" />
      <label>Notes (kitchen, Shabbat-practicality, etc.)</label>
      <input name="notes" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Add</button>
        <button type="button" class="btn btn-secondary" id="cancel-accom-form">Cancel</button>
      </div>
    </form>
  `;
}

/* ----- Transport tab ----- */

function renderTransportTab(stop) {
  const list = stop.transport || [];
  const rows = list.length ? list.map((t) => `
    <div class="card">
      <div class="attr-main">
        <div class="attr-name">${t.kind} · ${escapeHtml(t.mode)}</div>
        <div class="hint">${escapeHtml(t.detail || '')}${t.dayIndex !== null && t.dayIndex !== undefined && t.dayIndex !== '' ? ' · Day ' + (Number(t.dayIndex) + 1) : ''}${t.cost ? ' · ' + t.cost + ' ' + escapeHtml(t.currency || '') : ''}</div>
        ${t.confirmation ? `<div class="hint">Confirmation: ${escapeHtml(t.confirmation)}</div>` : ''}
        ${t.notes ? `<div class="hint">${escapeHtml(t.notes)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="delete-transport" data-transport-id="${t.id}">✕</button>
    </div>
  `).join('') : `<div class="empty-state">No transport entries yet — add flights, car rentals, transfers, or local transport notes.</div>`;

  return `
    <button class="btn btn-primary btn-block" id="btn-add-transport">+ Add transport</button>
    <div id="transport-form-slot"></div>
    <div class="section-title">Transport</div>
    ${rows}
  `;
}

function renderTransportForm(stop) {
  return `
    <form class="inline-form" id="transport-form">
      <label>Type</label>
      <select name="kind">${TRANSPORT_KINDS.map((k) => `<option value="${k}">${k}</option>`).join('')}</select>
      <label>Mode</label>
      <select name="mode">${TRANSPORT_MODES.map((m) => `<option value="${m}">${m}</option>`).join('')}</select>
      <label>Details</label>
      <input name="detail" placeholder="e.g. Avianca flight NYC → Lima" />
      <label>Day # (optional)</label>
      <input name="dayIndex" type="number" min="1" max="${stop.durationDays}" />
      <div class="form-row">
        <div>
          <label>Cost</label>
          <input name="cost" type="number" min="0" placeholder="0" />
        </div>
        <div>
          <label>Currency</label>
          <input name="currency" placeholder="USD" />
        </div>
      </div>
      <label>Confirmation code (optional)</label>
      <input name="confirmation" />
      <label>Notes</label>
      <input name="notes" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Add</button>
        <button type="button" class="btn btn-secondary" id="cancel-transport-form">Cancel</button>
      </div>
    </form>
  `;
}

/* ----- Country info tab ----- */

function renderInfoTab(stop) {
  const info = stop.countryInfo || {};
  return `
    <form class="inline-form" id="info-form">
      <p class="hint">Manual notes — enter this yourself from your own research, or paste in facts you've verified. Nothing here is looked up automatically.</p>
      <label>Currency</label>
      <input name="currency" value="${escapeAttr(info.currency || '')}" />
      <label>Language(s)</label>
      <input name="language" value="${escapeAttr(info.language || '')}" />
      <label>Plug type</label>
      <input name="plug" value="${escapeAttr(info.plug || '')}" />
      <label>Emergency number</label>
      <input name="emergency" value="${escapeAttr(info.emergency || '')}" />
      <label>Visa notes</label>
      <input name="visaNotes" value="${escapeAttr(info.visaNotes || '')}" />
      <label>General notes</label>
      <textarea name="notes" rows="4">${escapeHtml(info.notes || '')}</textarea>
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Save country info</button>
      </div>
    </form>
  `;
}

/* ---------- Settings ---------- */

function renderSettings() {
  return `
    <div class="section-title">Trip settings</div>
    <div class="settings-block">
      <h3>Trip start date</h3>
      <p class="hint">Used to calculate every stop's and every day's dates automatically.</p>
      <input type="date" id="trip-start-input" value="${data.meta.tripStartDate || ''}" />
    </div>
    <div class="section-title">Backup</div>
    <div class="settings-block">
      <h3>Export your data</h3>
      <p class="hint">Saves everything — route, days, attractions, accommodation, transport, country info — to a file. Share it with your spouse to keep both of you in sync.</p>
      <button class="btn btn-primary btn-block" id="btn-export">Export backup file</button>
      ${data.meta.lastExportDate ? `<p class="hint" style="margin-top:8px">Last exported: ${new Date(data.meta.lastExportDate).toLocaleString()}</p>` : ''}
    </div>
    <div class="settings-block">
      <h3>Import a backup file</h3>
      <p class="hint">This replaces everything currently in the app with what's in the file.</p>
      <input type="file" id="import-file" accept="application/json" />
    </div>
  `;
}

/* ---------- Maps helper ---------- */

function mapsSearchUrl(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}

/* ---------- Handlers ---------- */

function attachHandlers() {
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));
  document.querySelectorAll('[data-open-stop]').forEach((b) => b.addEventListener('click', () => openStop(b.dataset.openStop)));

  if (currentView === 'route') attachRouteHandlers();
  if (currentView === 'stop') attachStopHandlers();
  if (currentView === 'settings') attachSettingsHandlers();
}

function attachRouteHandlers() {
  const addBtn = document.getElementById('btn-add-stop');
  if (addBtn) addBtn.addEventListener('click', () => {
    document.getElementById('stop-form-slot').innerHTML = renderStopForm(null);
    wireStopForm(null);
  });
  document.querySelectorAll('[data-action="up"]').forEach((b) => b.addEventListener('click', () => moveStop(b.dataset.id, -1)));
  document.querySelectorAll('[data-action="down"]').forEach((b) => b.addEventListener('click', () => moveStop(b.dataset.id, 1)));
  document.querySelectorAll('[data-action="delete"]').forEach((b) => b.addEventListener('click', () => deleteStop(b.dataset.id)));
  document.querySelectorAll('[data-action="edit"]').forEach((b) => b.addEventListener('click', () => {
    const stop = stopById(b.dataset.id);
    document.getElementById('stop-form-slot').innerHTML = renderStopForm(stop);
    wireStopForm(stop);
  }));
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
      const s = Object.assign(defaultStop(), { id: uid('stop'), country, durationDays, notes });
      data.stops.push(s);
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
  if (!confirm('Remove this stop and everything planned inside it?')) return;
  data.stops = data.stops.filter((s) => s.id !== id);
  saveData();
  render();
}

/* ----- Stop workspace handlers ----- */

function attachStopHandlers() {
  document.getElementById('btn-back-to-route').addEventListener('click', () => setView('route'));
  document.querySelectorAll('[data-stop-tab]').forEach((b) => b.addEventListener('click', () => {
    currentStopTab = b.dataset.stopTab;
    render();
  }));

  const stop = stopById(currentStopId);
  if (!stop) return;

  if (currentStopTab === 'days') attachDaysHandlers(stop);
  else if (currentStopTab === 'attractions') attachAttractionsHandlers(stop);
  else if (currentStopTab === 'stay') attachStayHandlers(stop);
  else if (currentStopTab === 'transport') attachTransportHandlers(stop);
  else if (currentStopTab === 'info') attachInfoHandlers(stop);
}

function attachDaysHandlers(stop) {
  document.querySelectorAll('.day-type-select').forEach((sel) => sel.addEventListener('change', (e) => {
    stop.dayTypes[e.target.dataset.day] = e.target.value;
    saveData();
    toast('Day type saved.');
  }));
  document.querySelectorAll('[data-action="unschedule"]').forEach((b) => b.addEventListener('click', () => {
    const a = stop.attractionBank.find((x) => x.id === b.dataset.attrId);
    if (a) a.scheduledDay = null;
    saveData();
    render();
  }));
  document.querySelectorAll('[data-action="add-activity-to-day"]').forEach((b) => b.addEventListener('click', () => {
    const dayIndex = Number(b.dataset.day);
    const slot = document.getElementById('day-activity-picker-' + dayIndex);
    slot.innerHTML = renderActivityPicker(stop, dayIndex);
    wireActivityPicker(stop, dayIndex);
  }));
}

function wireActivityPicker(stop, dayIndex) {
  const scheduleBtn = document.querySelector(`[data-action="schedule-picked"][data-day="${dayIndex}"]`);
  if (scheduleBtn) scheduleBtn.addEventListener('click', () => {
    const select = document.getElementById('picker-select-' + dayIndex);
    const id = select.value;
    if (!id) return;
    const a = stop.attractionBank.find((x) => x.id === id);
    if (a) a.scheduledDay = dayIndex;
    saveData();
    render();
  });
  const quickAddBtn = document.querySelector(`[data-action="quick-add-scheduled"][data-day="${dayIndex}"]`);
  if (quickAddBtn) quickAddBtn.addEventListener('click', () => {
    const input = document.getElementById('picker-newname-' + dayIndex);
    const name = input.value.trim();
    if (!name) return;
    stop.attractionBank.push({ id: uid('attr'), name, notes: '', tags: [], source: 'manual', scheduledDay: dayIndex });
    saveData();
    render();
  });
}

function attachAttractionsHandlers(stop) {
  const addBtn = document.getElementById('btn-add-attraction');
  if (addBtn) addBtn.addEventListener('click', () => {
    document.getElementById('attraction-form-slot').innerHTML = renderAttractionForm();
    const form = document.getElementById('attraction-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      stop.attractionBank.push({
        id: uid('attr'), name: fd.get('name').trim(), notes: (fd.get('notes') || '').trim(),
        tags: [], source: 'manual', scheduledDay: null
      });
      saveData();
      render();
    });
    document.getElementById('cancel-attraction-form').addEventListener('click', () => {
      document.getElementById('attraction-form-slot').innerHTML = '';
    });
  });

  document.querySelectorAll('[data-action="delete-attraction"]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this attraction?')) return;
    stop.attractionBank = stop.attractionBank.filter((a) => a.id !== b.dataset.attrId);
    saveData();
    render();
  }));

  const promptBtn = document.getElementById('btn-build-ai-prompt');
  if (promptBtn) promptBtn.addEventListener('click', () => {
    const prompt = buildAiPrompt(stop);
    document.getElementById('ai-prompt-slot').innerHTML = `
      <textarea id="ai-prompt-text" rows="8" readonly>${escapeHtml(prompt)}</textarea>
      <button class="btn btn-primary" id="btn-copy-ai-prompt" style="margin-top:8px">Copy prompt</button>
    `;
    document.getElementById('btn-copy-ai-prompt').addEventListener('click', () => {
      const ta = document.getElementById('ai-prompt-text');
      ta.select();
      try {
        navigator.clipboard.writeText(ta.value);
        toast('Prompt copied — paste it into Claude or any AI.');
      } catch (e) {
        toast('Select the text above and copy it manually.');
      }
    });
  });

  const importBtn = document.getElementById('btn-import-ai-list');
  if (importBtn) importBtn.addEventListener('click', () => {
    const text = document.getElementById('ai-import-text').value;
    const lines = text.split('\n')
      .map((l) => l.replace(/^[\s\-•*\d.)]+/, '').trim())
      .filter((l) => l.length > 0);
    if (!lines.length) { toast('Nothing to import.'); return; }
    lines.forEach((name) => stop.attractionBank.push({ id: uid('attr'), name, notes: '', tags: [], source: 'ai-import', scheduledDay: null }));
    saveData();
    toast(`Imported ${lines.length} attraction${lines.length === 1 ? '' : 's'}.`);
    render();
  });
}

function attachStayHandlers(stop) {
  const addBtn = document.getElementById('btn-add-accom');
  if (addBtn) addBtn.addEventListener('click', () => {
    document.getElementById('accom-form-slot').innerHTML = renderAccomForm(stop);
    const form = document.getElementById('accom-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      stop.accommodations.push({
        id: uid('accom'),
        name: fd.get('name').trim(),
        address: (fd.get('address') || '').trim(),
        startDayIndex: Math.max(0, (parseInt(fd.get('startDayIndex'), 10) || 1) - 1),
        nights: Math.max(1, parseInt(fd.get('nights'), 10) || 1),
        cost: fd.get('cost') || '',
        currency: (fd.get('currency') || '').trim(),
        confirmation: (fd.get('confirmation') || '').trim(),
        notes: (fd.get('notes') || '').trim()
      });
      saveData();
      render();
    });
    document.getElementById('cancel-accom-form').addEventListener('click', () => {
      document.getElementById('accom-form-slot').innerHTML = '';
    });
  });
  document.querySelectorAll('[data-action="delete-accom"]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this accommodation entry?')) return;
    stop.accommodations = stop.accommodations.filter((a) => a.id !== b.dataset.accomId);
    saveData();
    render();
  }));
}

function attachTransportHandlers(stop) {
  const addBtn = document.getElementById('btn-add-transport');
  if (addBtn) addBtn.addEventListener('click', () => {
    document.getElementById('transport-form-slot').innerHTML = renderTransportForm(stop);
    const form = document.getElementById('transport-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const dayIndexRaw = fd.get('dayIndex');
      stop.transport.push({
        id: uid('transport'),
        kind: fd.get('kind'),
        mode: fd.get('mode'),
        detail: (fd.get('detail') || '').trim(),
        dayIndex: dayIndexRaw ? Math.max(0, parseInt(dayIndexRaw, 10) - 1) : null,
        cost: fd.get('cost') || '',
        currency: (fd.get('currency') || '').trim(),
        confirmation: (fd.get('confirmation') || '').trim(),
        notes: (fd.get('notes') || '').trim()
      });
      saveData();
      render();
    });
    document.getElementById('cancel-transport-form').addEventListener('click', () => {
      document.getElementById('transport-form-slot').innerHTML = '';
    });
  });
  document.querySelectorAll('[data-action="delete-transport"]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this transport entry?')) return;
    stop.transport = stop.transport.filter((t) => t.id !== b.dataset.transportId);
    saveData();
    render();
  }));
}

function attachInfoHandlers(stop) {
  const form = document.getElementById('info-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    stop.countryInfo = {
      currency: (fd.get('currency') || '').trim(),
      language: (fd.get('language') || '').trim(),
      plug: (fd.get('plug') || '').trim(),
      emergency: (fd.get('emergency') || '').trim(),
      visaNotes: (fd.get('visaNotes') || '').trim(),
      notes: (fd.get('notes') || '').trim()
    };
    saveData();
    toast('Country info saved.');
  });
}

function attachSettingsHandlers() {
  document.getElementById('trip-start-input').addEventListener('change', (e) => {
    data.meta.tripStartDate = e.target.value;
    saveData();
    toast('Trip start date updated.');
    render();
  });
  document.getElementById('btn-export').addEventListener('click', exportData);
  document.getElementById('import-file').addEventListener('change', importData);
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
      data = loadFromObject(parsed);
      saveData();
      toast('Backup imported.');
      render();
    } catch (err) {
      alert('Could not read that file: ' + err.message);
    }
  };
  reader.readAsText(file);
}

function loadFromObject(parsed) {
  const merged = Object.assign(defaultData(), parsed);
  merged.stops = (merged.stops || []).map((s) => Object.assign(defaultStop(), s));
  return merged;
}

/* ---------- Small utils ---------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ---------- Init ---------- */

document.querySelectorAll('nav.bottom-nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
render();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW registration failed', err));
  });
}

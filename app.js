/* ---------- Data layer ---------- */

const APP_VERSION = 'v6 · ' + '2026-07-27';
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
const GUIDED_OPTIONS = ['Not set', 'Guided tour recommended', 'Can visit independently', 'Either works'];
const BLOCK_TYPES = ['Work', 'Meal', 'Sleep / rest', 'Travel', 'Attraction / excursion', 'Free time', 'Other'];
const EXPENSE_CATEGORIES = [
  'Accommodation', 'Transportation', 'Flights', 'Food', 'Activities', 'Guides',
  'Insurance', 'Visas', 'Medical', 'Remote work', 'Child-related', 'Points & miles', 'Contingency', 'Other'
];

function defaultData() {
  return {
    meta: {
      tripStartDate: '',
      lastExportDate: null,
      totalBudgetUSD: null,
      fxRates: null // { base: 'USD', date: '...', rates: { PEN: 3.7, ... } }
    },
    stops: [],
    expenses: [] // { id, category, stopId, description, amountLocal, currency, amountUSD, fxRateUsed, fxDate, date, notes }
  };
}

function defaultAttraction() {
  return {
    id: '', name: '', description: '', location: '', guidedOrSelf: 'Not set',
    gettingThere: '', whatToBring: '', notes: '', tags: [], source: 'manual', scheduledDay: null,
    geoLat: null, geoLon: null
  };
}

function defaultStop() {
  return {
    id: '', country: '', durationDays: 14, notes: '',
    dayTypes: {},
    daySchedule: {}, // { [dayIndex]: [ { id, type, label, startTime, endTime, attractionId, notes } ] }
    attractionBank: [],
    accommodations: [],
    transport: [],
    countryInfo: { currency: '', language: '', plug: '', emergency: '', visaNotes: '', notes: '', lat: '', lon: '', timezone: '' }
  };
}

let data = loadData();

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return loadFromObject(parsed);
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

/* ---------- Shabbat / holiday calendar (offline, via bundled Hebcal) ---------- */
// Computes candle-lighting / havdalah times and Yom Tov (chag) flags for a stop's
// date range, using its manually-entered coordinates. Everything here runs fully
// offline once the app is loaded — no network call, no live lookup.

function hasLocation(stop) {
  const info = stop.countryInfo || {};
  return !!(info.lat && info.lon && info.timezone);
}

function computeShabbatChagMap(stop, withDates) {
  if (!withDates.startDate || !hasLocation(stop) || typeof Hebcal === 'undefined') return null;
  const info = stop.countryInfo;
  try {
    const loc = new Hebcal.Location(parseFloat(info.lat), parseFloat(info.lon), false, info.timezone, stop.country, '');
    const start = new Date(withDates.startDate + 'T00:00:00');
    const end = new Date(withDates.endDate + 'T00:00:00');
    const events = Hebcal.HebrewCalendar.calendar({ start, end, location: loc, candlelighting: true, il: false });
    const map = {};
    events.forEach((ev) => {
      const iso = isoFromGregDate(ev.getDate().greg());
      if (!map[iso]) map[iso] = { candleLighting: null, havdalah: null, isChag: false, chagName: null };
      const f = ev.getFlags();
      const desc = ev.render('en');
      if (/Candle lighting/.test(desc)) {
        const m = desc.match(/(\d{1,2}:\d{2})/);
        map[iso].candleLighting = m ? m[1] : null;
      }
      if (/Havdalah/.test(desc)) {
        const m = desc.match(/(\d{1,2}:\d{2})/);
        map[iso].havdalah = m ? m[1] : null;
      }
      if (f & Hebcal.flags.CHAG) {
        map[iso].isChag = true;
        map[iso].chagName = desc.replace(/^\S+ /, '');
      }
    });
    return map;
  } catch (e) {
    console.error('Shabbat/holiday calculation failed for this stop.', e);
    return null;
  }
}

function isoFromGregDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

// For a given day (0-indexed within the stop), return its Shabbat/chag status.
function getDayFlag(calMap, dateIso) {
  if (!dateIso) return { restricted: false };
  const dow = new Date(dateIso + 'T00:00:00').getDay(); // 0 Sun ... 5 Fri, 6 Sat
  const entry = calMap ? calMap[dateIso] : null;
  const isFriday = dow === 5;
  const isSaturday = dow === 6;
  const isChag = !!(entry && entry.isChag);
  return {
    restricted: isFriday || isSaturday || isChag,
    isFriday, isSaturday, isChag,
    candleLighting: entry ? entry.candleLighting : null,
    havdalah: entry ? entry.havdalah : null,
    chagName: entry ? entry.chagName : null
  };
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
  expandedDays = new Set();
  document.querySelectorAll('nav.bottom-nav button').forEach((b) => b.classList.remove('active'));
  render();
}

/* ---------- Live location lookup (free, no API key) ---------- */
// Uses OpenStreetMap's Nominatim search — free and keyless, but rate-limited,
// so this only runs when you tap "Find exact location," not automatically on
// every keystroke. Result is cached on the record so it's a one-time lookup.

async function geocodeLocation(query) {
  try {
    const resp = await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&q=' + encodeURIComponent(query));
    const json = await resp.json();
    if (json && json[0]) {
      return { lat: parseFloat(json[0].lat), lon: parseFloat(json[0].lon), displayName: json[0].display_name };
    }
  } catch (e) {
    console.error('Location lookup failed (offline?)', e);
  }
  return null;
}

function googleFlightsSearchUrl(detail) {
  return 'https://www.google.com/travel/flights?q=' + encodeURIComponent(detail || 'flights');
}
function webSearchUrl(query) {
  return 'https://www.google.com/search?q=' + encodeURIComponent(query);
}

/* ---------- Budget / currency ---------- */

function convertToUSD(amount, currency) {
  const amt = Number(amount);
  if (!amt) return 0;
  if (!currency || currency.toUpperCase() === 'USD') return amt;
  const rates = data.meta.fxRates && data.meta.fxRates.rates;
  const rate = rates ? rates[currency.toUpperCase()] : null;
  if (!rate) return null; // unknown currency, can't convert yet
  return amt / rate; // rates are USD -> currency, so invert
}

async function refreshFxRates(silent) {
  try {
    const resp = await fetch('https://open.er-api.com/v6/latest/USD');
    const json = await resp.json();
    if (json && json.result === 'success' && json.rates) {
      data.meta.fxRates = { base: 'USD', date: json.time_last_update_utc || new Date().toISOString(), rates: json.rates };
      saveData();
      if (!silent) toast('Exchange rates updated.');
      render();
    } else {
      if (!silent) toast('Could not refresh rates right now.');
    }
  } catch (e) {
    if (!silent) toast('No connection — using last saved rates.');
  }
}

/* ---------- Rendering root ---------- */

function render() {
  const main = document.getElementById('main');
  if (currentView === 'dashboard') main.innerHTML = renderDashboard();
  else if (currentView === 'route') main.innerHTML = renderRoute();
  else if (currentView === 'stop') main.innerHTML = renderStopWorkspace();
  else if (currentView === 'budget') main.innerHTML = renderBudget();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  attachHandlers();
}

/* ---------- Dashboard ---------- */

function renderDashboard() {
  const stops = computeStopDates();
  const start = data.meta.tripStartDate;
  const toDeparture = daysUntil(start);
  const totalDays = stops.reduce((sum, s) => sum + Number(s.durationDays || 0), 0);

  let unscheduled = 0, missingAccom = 0, calConflicts = 0, stopsNeedingLocation = 0;
  stops.forEach((s) => {
    unscheduled += (s.attractionBank || []).filter((a) => a.scheduledDay === null || a.scheduledDay === undefined).length;
    const nightsCovered = new Set();
    (s.accommodations || []).forEach((a) => {
      for (let i = a.startDayIndex; i < a.startDayIndex + a.nights; i++) nightsCovered.add(i);
    });
    if (nightsCovered.size < s.durationDays) missingAccom++;

    if (!hasLocation(s)) {
      stopsNeedingLocation++;
    } else {
      const calMap = computeShabbatChagMap(s, s);
      (s.transport || []).forEach((t) => {
        if (t.dayIndex !== null && t.dayIndex !== undefined && t.dayIndex !== '' && s.startDate) {
          const date = addDays(s.startDate, Number(t.dayIndex));
          if (getDayFlag(calMap, date).restricted) calConflicts++;
        }
      });
    }
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
    <div class="stat-chip ${calConflicts ? 'danger' : ''}">
      <div class="num">${calConflicts}</div>
      <div class="label">Shabbat/chag transport conflicts</div>
    </div>
    <div class="stat-chip ${stopsNeedingLocation ? 'warn' : ''}">
      <div class="num">${stopsNeedingLocation}</div>
      <div class="label">Stops needing location for Shabbat calc</div>
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
    { key: 'map', label: 'Map' },
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
  else if (currentStopTab === 'map') body = renderMapTab(stop);
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

let expandedDays = new Set();

function renderDaysTab(stop, withDates) {
  const calMap = computeShabbatChagMap(stop, withDates);
  const locationSet = hasLocation(stop);
  const rows = [];

  if (!locationSet) {
    rows.push(`<div class="card" style="background:#fff7e6;border-color:var(--amber)">
      Add this stop's coordinates in the <b>Country info</b> tab to automatically flag Shabbat and holiday days here.
    </div>`);
  }

  for (let i = 0; i < stop.durationDays; i++) {
    const date = withDates.startDate ? addDays(withDates.startDate, i) : '';
    const dayType = stop.dayTypes[i] || 'unset';
    const scheduled = (stop.attractionBank || []).filter((a) => a.scheduledDay === i);
    const accom = (stop.accommodations || []).find((a) => i >= a.startDayIndex && i < a.startDayIndex + a.nights);
    const flag = getDayFlag(calMap, date);
    const isExpanded = expandedDays.has(i);

    let flagBadges = '';
    if (flag.isFriday) flagBadges += `<span class="cal-badge shabbat">🕯 Shabbat begins${flag.candleLighting ? ' ' + flag.candleLighting : ''}</span>`;
    if (flag.isSaturday) flagBadges += `<span class="cal-badge shabbat">✨ Shabbat ends${flag.havdalah ? ' ' + flag.havdalah : ''}</span>`;
    if (flag.isChag) flagBadges += `<span class="cal-badge chag">🕎 ${escapeHtml(flag.chagName || 'Chag')}</span>`;

    rows.push(`
      <div class="card day-card ${flag.restricted ? 'day-restricted' : ''}">
        <div class="day-card-head">
          <div>
            <div class="day-num">Day ${i + 1}</div>
            <div class="dates">${date ? formatDate(date) : ''}</div>
          </div>
          <select class="day-type-select" data-day="${i}">
            ${DAY_TYPES.map((dt) => `<option value="${dt.value}" ${dt.value === dayType ? 'selected' : ''}>${dt.label}</option>`).join('')}
          </select>
        </div>
        ${flagBadges ? `<div class="cal-badges">${flagBadges}</div>` : ''}
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

        <button class="btn-expand-toggle" data-action="toggle-day-expand" data-day="${i}">${isExpanded ? '▾ Hide hour-by-hour schedule' : '▸ Hour-by-hour schedule'}</button>
        ${isExpanded ? renderDayScheduleSection(stop, i) : ''}
      </div>
    `);
  }
  return rows.join('');
}

function renderDayScheduleSection(stop, dayIndex) {
  const blocks = (stop.daySchedule[dayIndex] || []).slice().sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));
  const rows = blocks.length ? blocks.map((b) => `
    <div class="sched-row">
      <div class="sched-time">${b.startTime || '?'}${b.endTime ? '–' + b.endTime : ''}</div>
      <div class="sched-label"><span class="sched-type">${escapeHtml(b.type)}</span>${b.label ? ' · ' + escapeHtml(b.label) : ''}${b.notes ? ' · ' + escapeHtml(b.notes) : ''}</div>
      <button class="icon-btn" data-action="delete-block" data-day="${dayIndex}" data-block-id="${b.id}">✕</button>
    </div>
  `).join('') : '<div class="hint-inline">No time blocks yet — add work, meals, sleep, travel, or attractions below.</div>';

  return `
    <div class="day-schedule">
      ${rows}
      <button class="btn btn-secondary" data-action="add-block" data-day="${dayIndex}" style="margin-top:8px">+ Add time block</button>
      <div id="block-form-slot-${dayIndex}"></div>
    </div>
  `;
}

function renderBlockForm(stop, dayIndex) {
  const scheduledAttractions = (stop.attractionBank || []).filter((a) => a.scheduledDay === dayIndex);
  return `
    <form class="inline-form" id="block-form-${dayIndex}">
      <label>Type</label>
      <select name="type">${BLOCK_TYPES.map((t) => `<option value="${t}">${t}</option>`).join('')}</select>
      <div class="form-row">
        <div><label>Start time</label><input type="time" name="startTime" required /></div>
        <div><label>End time</label><input type="time" name="endTime" /></div>
      </div>
      ${scheduledAttractions.length ? `
        <label>Link to a scheduled attraction (optional)</label>
        <select name="attractionId">
          <option value="">— none —</option>
          ${scheduledAttractions.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('')}
        </select>
      ` : ''}
      <label>Label</label>
      <input name="label" placeholder="e.g. Breakfast, Work block, Rainbow Mountain hike" />
      <label>Notes</label>
      <input name="notes" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Add</button>
        <button type="button" class="btn btn-secondary" data-action="cancel-block-form" data-day="${dayIndex}">Cancel</button>
      </div>
    </form>
  `;
}

function timesOverlap(s1, e1, s2, e2) {
  if (!s1 || !s2) return false;
  const end1 = e1 || s1;
  const end2 = e2 || s2;
  return s1 < end2 && s2 < end1;
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
        ${a.description ? `<div class="hint">${escapeHtml(a.description)}</div>` : ''}
        <div class="attr-meta">
          ${a.location ? `
            <span class="loc-row">
              <a class="map-link" target="_blank" rel="noopener" href="${a.geoLat ? mapsPinUrl(a.geoLat, a.geoLon) : mapsSearchUrl(a.location + ', ' + stop.country)}">📍 ${escapeHtml(a.location)} ↗</a>
              ${a.geoLat ? '<span class="geo-badge">located</span>' : `<button class="icon-btn" data-action="geocode-attraction" data-attr-id="${a.id}">🔎</button>`}
            </span>
          ` : ''}
          ${a.guidedOrSelf && a.guidedOrSelf !== 'Not set' ? `<span class="attr-tag">${escapeHtml(a.guidedOrSelf)}</span>` : ''}
        </div>
        ${a.gettingThere ? `<div class="hint">🚗 ${escapeHtml(a.gettingThere)}</div>` : ''}
        ${a.whatToBring ? `<div class="hint">🎒 ${escapeHtml(a.whatToBring)}</div>` : ''}
        ${a.notes ? `<div class="hint">${escapeHtml(a.notes)}</div>` : ''}
        <div class="attr-status">${a.scheduledDay !== null && a.scheduledDay !== undefined ? '📅 Scheduled — Day ' + (a.scheduledDay + 1) : '— Unscheduled'}</div>
      </div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-attraction" data-attr-id="${a.id}">✎</button>
        <button class="icon-btn" data-action="delete-attraction" data-attr-id="${a.id}">✕</button>
      </div>
    </div>
  `).join('') : `<div class="empty-state">No attractions yet. Add your own, or ask AI for suggestions below and import the list.</div>`;

  return `
    <button class="btn btn-primary btn-block" id="btn-add-attraction">+ Add attraction manually</button>
    <div id="attraction-form-slot"></div>

    <div class="section-title">AI research helper</div>
    <div class="card">
      <p class="hint">Build a ready-to-use prompt for this country, copy it into Claude (or any AI), then paste the full reply back in below — each suggestion becomes its own attraction, with location, tour info, getting there, and what to bring already filled in.</p>
      <button class="btn btn-secondary" id="btn-build-ai-prompt">Build AI prompt for ${escapeHtml(stop.country)}</button>
      <div id="ai-prompt-slot"></div>
    </div>
    <div class="card">
      <label>Paste the AI's full reply here</label>
      <textarea id="ai-import-text" rows="6" placeholder="Paste the AI's structured reply here (or a plain list — that still works too)"></textarea>
      <button class="btn btn-primary" id="btn-import-ai-list" style="margin-top:8px">Import as attractions</button>
    </div>

    <div class="section-title">Bank</div>
    ${rows}
  `;
}

function renderAttractionForm(existing) {
  const a = existing || defaultAttraction();
  const isEdit = !!existing;
  return `
    <form class="inline-form" id="attraction-form">
      <label>Attraction / activity name</label>
      <input name="name" value="${escapeAttr(a.name)}" required placeholder="e.g. Rainbow Mountain hike" />
      <label>What it is</label>
      <input name="description" value="${escapeAttr(a.description || '')}" placeholder="short description" />
      <label>Location (for the map link)</label>
      <input name="location" value="${escapeAttr(a.location || '')}" placeholder="e.g. Vinicunca, Cusco region" />
      <label>Guided tour or self-guided?</label>
      <select name="guidedOrSelf">
        ${GUIDED_OPTIONS.map((g) => `<option value="${g}" ${g === a.guidedOrSelf ? 'selected' : ''}>${g}</option>`).join('')}
      </select>
      <label>Getting there</label>
      <input name="gettingThere" value="${escapeAttr(a.gettingThere || '')}" placeholder="e.g. 3hr drive from Cusco, or organized transfer" />
      <label>What to bring</label>
      <input name="whatToBring" value="${escapeAttr(a.whatToBring || '')}" placeholder="e.g. warm layers, altitude meds, cash for entry" />
      <label>Other notes</label>
      <input name="notes" value="${escapeAttr(a.notes || '')}" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${isEdit ? 'Save changes' : 'Add to bank'}</button>
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

Please suggest 6-10 specific attractions/activities in ${stop.country} that fit this. IMPORTANT — reply using exactly this format for each one, so I can import it directly into my planning app:

### Attraction Name
What: one or two sentence description of what it is
Where: specific place/neighborhood name (for a map search)
Tour or self-guided: Guided tour recommended / Can visit independently / Either works
Getting there: how to get there from a typical base, and travel time
What to bring: brief list (gear, altitude meds, cash, etc.)
Notes: child-suitability, booking-ahead needs, or anything else worth knowing

Repeat that block for each suggestion. Please don't add any other text before, between, or after the blocks.`;
}

/* ----- Smart parser for the structured AI reply ----- */
// Understands the "### Title / What: / Where: / Tour or self-guided: / Getting there: /
// What to bring: / Notes:" format from buildAiPrompt(). Falls back to one-attraction-per-line
// for plain pasted lists that don't use that format, so nothing is ever lost.

function parseAiImportText(text) {
  const hasStructured = /^###\s+/m.test(text);
  if (!hasStructured) {
    return text.split('\n')
      .map((l) => l.replace(/^[\s\-•*\d.)]+/, '').trim())
      .filter((l) => l.length > 0)
      .map((name) => Object.assign(defaultAttraction(), { name, source: 'ai-import' }));
  }

  const blocks = text.split(/^###\s+/m).slice(1); // drop any preamble before the first ###
  const fieldPatterns = [
    ['description', /^what:\s*(.*)$/i],
    ['location', /^where:\s*(.*)$/i],
    ['guidedOrSelf', /^tour or self-guided:\s*(.*)$/i],
    ['gettingThere', /^getting there:\s*(.*)$/i],
    ['whatToBring', /^what to bring:\s*(.*)$/i],
    ['notes', /^notes:\s*(.*)$/i]
  ];

  return blocks.map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter((l) => l.length);
    if (!lines.length) return null;
    const attr = Object.assign(defaultAttraction(), { name: lines[0], source: 'ai-import' });
    for (const line of lines.slice(1)) {
      let matched = false;
      for (const [field, pattern] of fieldPatterns) {
        const m = line.match(pattern);
        if (m) {
          attr[field] = (attr[field] ? attr[field] + ' ' : '') + m[1].trim();
          matched = true;
          break;
        }
      }
      if (!matched && line) {
        attr.notes = attr.notes ? attr.notes + ' ' + line : line;
      }
    }
    // normalize guidedOrSelf to one of our select options where possible
    const gs = (attr.guidedOrSelf || '').toLowerCase();
    if (gs.includes('guided')) attr.guidedOrSelf = 'Guided tour recommended';
    else if (gs.includes('independent') || gs.includes('alone') || gs.includes('self')) attr.guidedOrSelf = 'Can visit independently';
    else if (gs.includes('either')) attr.guidedOrSelf = 'Either works';
    else if (!gs) attr.guidedOrSelf = 'Not set';
    return attr;
  }).filter(Boolean);
}

/* ----- Stay tab (accommodation) ----- */

function renderStayTab(stop, withDates) {
  const list = stop.accommodations || [];
  const rows = list.length ? list.map((a) => `
    <div class="card">
      <div class="attr-main">
        <div class="attr-name">${escapeHtml(a.name)}</div>
        <div class="hint">Day ${a.startDayIndex + 1}–${a.startDayIndex + a.nights} · ${a.nights} night${a.nights === 1 ? '' : 's'}${a.cost ? ' · ' + a.cost + ' ' + escapeHtml(a.currency || '') : ''}</div>
        ${a.address ? `
          <div class="loc-row">
            <a class="map-link" target="_blank" rel="noopener" href="${a.geoLat ? mapsPinUrl(a.geoLat, a.geoLon) : mapsSearchUrl(a.address)}">${escapeHtml(a.address)} ↗</a>
            ${a.geoLat ? '<span class="geo-badge">📍 located</span>' : `<button class="icon-btn" data-action="geocode-accom" data-accom-id="${a.id}">🔎</button>`}
          </div>
        ` : ''}
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
  const withDates = stopWithDatesById(stop.id);
  const calMap = computeShabbatChagMap(stop, withDates);
  const list = stop.transport || [];
  const rows = list.length ? list.map((t) => {
    let warning = '';
    if (t.dayIndex !== null && t.dayIndex !== undefined && t.dayIndex !== '' && withDates.startDate) {
      const date = addDays(withDates.startDate, Number(t.dayIndex));
      const flag = getDayFlag(calMap, date);
      if (flag.restricted) {
        const reason = flag.isChag ? (flag.chagName || 'a chag') : 'Shabbat';
        warning = `<div class="cal-warning">⚠ This falls on ${escapeHtml(reason)} — avoid travel on this day.</div>`;
      }
    }
    const searchUrl = t.mode === 'Flight' ? googleFlightsSearchUrl(t.detail) : webSearchUrl((t.detail || t.mode) + ' ' + stop.country);
    return `
    <div class="card">
      <div class="attr-main">
        <div class="attr-name">${t.kind} · ${escapeHtml(t.mode)}</div>
        <div class="hint">${escapeHtml(t.detail || '')}${t.dayIndex !== null && t.dayIndex !== undefined && t.dayIndex !== '' ? ' · Day ' + (Number(t.dayIndex) + 1) : ''}${t.cost ? ' · ' + t.cost + ' ' + escapeHtml(t.currency || '') : ''}</div>
        ${warning}
        ${t.confirmation ? `<div class="hint">Confirmation: ${escapeHtml(t.confirmation)}</div>` : ''}
        ${t.notes ? `<div class="hint">${escapeHtml(t.notes)}</div>` : ''}
        <a class="map-link" target="_blank" rel="noopener" href="${searchUrl}">${t.mode === 'Flight' ? 'Search flights ↗' : 'Search online ↗'}</a>
      </div>
      <button class="icon-btn" data-action="delete-transport" data-transport-id="${t.id}">✕</button>
    </div>
  `;
  }).join('') : `<div class="empty-state">No transport entries yet — add flights, car rentals, transfers, or local transport notes.</div>`;

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

/* ----- Map tab (free, keyless — OpenStreetMap via Leaflet, loaded from CDN) ----- */

function collectMapPoints(stop) {
  const points = [];
  (stop.accommodations || []).forEach((a) => {
    if (a.geoLat && a.geoLon) points.push({ lat: a.geoLat, lon: a.geoLon, label: '🛏 ' + a.name, kind: 'accom' });
  });
  (stop.attractionBank || []).forEach((a) => {
    if (a.geoLat && a.geoLon) points.push({ lat: a.geoLat, lon: a.geoLon, label: '📍 ' + a.name, kind: 'attraction' });
  });
  return points;
}

function renderMapTab(stop) {
  const points = collectMapPoints(stop);
  const missingCount = (stop.accommodations || []).filter((a) => a.address && !a.geoLat).length
    + (stop.attractionBank || []).filter((a) => a.location && !a.geoLat).length;
  return `
    <p class="hint">Pins come from accommodations and attractions you've looked up with the 🔎 "find exact location" button on their tabs — this map loads live map tiles, so it needs an internet connection.</p>
    ${missingCount ? `<p class="hint">${missingCount} location${missingCount === 1 ? '' : 's'} not yet looked up — visit Stay or Attractions and tap 🔎 next to the address to add them here.</p>` : ''}
    <div id="stop-map-container" style="height:340px;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:#eee"></div>
    <div id="map-status" class="hint" style="margin-top:8px"></div>
  `;
}

let leafletLoadPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve();
  if (leafletLoadPromise) return leafletLoadPromise;
  leafletLoadPromise = new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('offline-or-blocked'));
    document.body.appendChild(script);
  });
  return leafletLoadPromise;
}

function initStopMap(stop) {
  const container = document.getElementById('stop-map-container');
  const status = document.getElementById('map-status');
  if (!container) return;

  const points = collectMapPoints(stop);
  const info = stop.countryInfo || {};
  let center = points.length
    ? [points.reduce((s, p) => s + p.lat, 0) / points.length, points.reduce((s, p) => s + p.lon, 0) / points.length]
    : (info.lat && info.lon ? [parseFloat(info.lat), parseFloat(info.lon)] : null);

  if (!center) {
    status.textContent = 'Add coordinates in Country Info, or look up an accommodation/attraction location, to show a map here.';
    return;
  }

  loadLeaflet().then(() => {
    if (!document.getElementById('stop-map-container')) return; // tab changed while loading
    const map = window.L.map('stop-map-container').setView(center, points.length ? 11 : 8);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19
    }).addTo(map);
    points.forEach((p) => window.L.marker([p.lat, p.lon]).addTo(map).bindPopup(p.label));
    if (!points.length) status.textContent = 'Showing the stop\'s general area — look up specific accommodations/attractions to pin them here.';
  }).catch(() => {
    status.textContent = 'Could not load the map — this needs an internet connection.';
  });
}

/* ----- Country info tab ----- */

function renderInfoTab(stop) {
  const info = stop.countryInfo || {};
  return `
    <div class="card" style="background:#f0f7f5">
      <h3 style="margin:0 0 6px;font-size:0.9rem">Location for Shabbat &amp; holiday calculation</h3>
      <p class="hint">Enter this stop's approximate coordinates and timezone once, and candle-lighting, havdalah, and holiday days will be flagged automatically on the Days and Transport tabs — fully offline. Tip: search "[city] latitude longitude" or long-press the location in Google Maps to copy coordinates.</p>
      <form class="inline-form" id="location-form" style="margin-top:8px;border:none;padding:0">
        <div class="form-row">
          <div>
            <label>Latitude</label>
            <input name="lat" value="${escapeAttr(info.lat || '')}" placeholder="e.g. -13.53" />
          </div>
          <div>
            <label>Longitude</label>
            <input name="lon" value="${escapeAttr(info.lon || '')}" placeholder="e.g. -71.97" />
          </div>
        </div>
        <label>Timezone (IANA name)</label>
        <input name="timezone" value="${escapeAttr(info.timezone || '')}" placeholder="e.g. America/Lima" />
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save location</button>
        </div>
      </form>
    </div>

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

/* ---------- Budget page ---------- */

function renderBudget() {
  const expenses = data.expenses || [];
  const totalUSD = expenses.reduce((sum, e) => sum + (Number(e.amountUSD) || 0), 0);
  const budget = data.meta.totalBudgetUSD;
  const pct = budget ? Math.min(100, Math.round((totalUSD / budget) * 100)) : null;

  const byCategory = {};
  expenses.forEach((e) => { byCategory[e.category] = (byCategory[e.category] || 0) + (Number(e.amountUSD) || 0); });
  const catRows = EXPENSE_CATEGORIES
    .filter((c) => byCategory[c])
    .sort((a, b) => byCategory[b] - byCategory[a])
    .map((c) => `
      <div class="cat-row">
        <div class="cat-label">${c}</div>
        <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${budget ? Math.min(100, (byCategory[c] / totalUSD) * 100) : 0}%"></div></div>
        <div class="cat-amount">$${byCategory[c].toFixed(0)}</div>
      </div>
    `).join('');

  const fxInfo = data.meta.fxRates
    ? `Rates as of ${new Date(data.meta.fxRates.date).toLocaleDateString()}`
    : 'No exchange rates loaded yet';

  const stopOptions = data.stops.map((s) => `<option value="${s.id}">${escapeHtml(s.country)}</option>`).join('');

  const expenseRows = expenses.length
    ? [...expenses].sort((a, b) => (b.date || '').localeCompare(a.date || '')).map((e) => {
        const stop = stopById(e.stopId);
        const converted = e.amountUSD === null ? '<span style="color:var(--red)">unconverted</span>' : '$' + Number(e.amountUSD).toFixed(2);
        return `
        <div class="card">
          <div class="attr-main">
            <div class="attr-name">${escapeHtml(e.description || e.category)} <span class="hint">· ${e.category}</span></div>
            <div class="hint">${e.amountLocal} ${escapeHtml(e.currency)} → ${converted}${stop ? ' · ' + escapeHtml(stop.country) : ''}${e.date ? ' · ' + e.date : ''}</div>
            ${e.notes ? `<div class="hint">${escapeHtml(e.notes)}</div>` : ''}
          </div>
          <button class="icon-btn" data-action="delete-expense" data-expense-id="${e.id}">✕</button>
        </div>`;
      }).join('')
    : `<div class="empty-state">No expenses logged yet.</div>`;

  return `
    <div class="section-title">Budget</div>
    <div class="card">
      <div class="form-row">
        <div>
          <label class="hint" style="display:block;margin-bottom:4px">Total trip budget (USD)</label>
          <input type="number" id="total-budget-input" value="${budget || ''}" placeholder="e.g. 60000" />
        </div>
      </div>
      ${budget ? `
        <div class="budget-bar-track" style="margin-top:12px">
          <div class="budget-bar-fill ${pct >= 100 ? 'over' : ''}" style="width:${pct}%"></div>
        </div>
        <div class="hint" style="margin-top:6px">$${totalUSD.toFixed(0)} of $${Number(budget).toFixed(0)} spent/committed (${pct}%)</div>
      ` : `<p class="hint" style="margin-top:8px">Set a total budget to see spend-so-far as a percentage.</p>`}
    </div>

    <div class="card">
      <div class="hint">${fxInfo}</div>
      <button class="btn btn-secondary" id="btn-refresh-fx" style="margin-top:8px">Refresh exchange rates</button>
    </div>

    ${catRows ? `<div class="section-title">By category</div>${catRows}` : ''}

    <button class="btn btn-primary btn-block" id="btn-add-expense" style="margin-top:14px">+ Add expense</button>
    <div id="expense-form-slot"></div>

    <div class="section-title">All expenses</div>
    ${expenseRows}
  `;
}

function renderExpenseForm(stopOptionsHtml) {
  return `
    <form class="inline-form" id="expense-form">
      <label>Category</label>
      <select name="category">${EXPENSE_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
      <label>Description</label>
      <input name="description" placeholder="e.g. Cusco apartment, week 2" />
      <label>Country / stop (optional)</label>
      <select name="stopId">
        <option value="">— trip-wide / not tied to one stop —</option>
        ${stopOptionsHtml}
      </select>
      <div class="form-row">
        <div>
          <label>Amount</label>
          <input name="amountLocal" type="number" min="0" step="0.01" required />
        </div>
        <div>
          <label>Currency</label>
          <input name="currency" placeholder="USD" value="USD" required />
        </div>
      </div>
      <label>Date</label>
      <input name="date" type="date" />
      <label>Notes</label>
      <input name="notes" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Add expense</button>
        <button type="button" class="btn btn-secondary" id="cancel-expense-form">Cancel</button>
      </div>
    </form>
  `;
}

function attachBudgetHandlers() {
  document.getElementById('total-budget-input').addEventListener('change', (e) => {
    const v = parseFloat(e.target.value);
    data.meta.totalBudgetUSD = isNaN(v) ? null : v;
    saveData();
    render();
  });

  document.getElementById('btn-refresh-fx').addEventListener('click', () => refreshFxRates(false));

  const addBtn = document.getElementById('btn-add-expense');
  if (addBtn) addBtn.addEventListener('click', () => {
    const stopOptionsHtml = data.stops.map((s) => `<option value="${s.id}">${escapeHtml(s.country)}</option>`).join('');
    document.getElementById('expense-form-slot').innerHTML = renderExpenseForm(stopOptionsHtml);
    const form = document.getElementById('expense-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const currency = (fd.get('currency') || 'USD').trim().toUpperCase();
      const amountLocal = parseFloat(fd.get('amountLocal')) || 0;
      const amountUSD = convertToUSD(amountLocal, currency);
      data.expenses.push({
        id: uid('exp'),
        category: fd.get('category'),
        description: (fd.get('description') || '').trim(),
        stopId: fd.get('stopId') || null,
        amountLocal, currency,
        amountUSD,
        fxRateUsed: data.meta.fxRates ? (data.meta.fxRates.rates[currency] || null) : null,
        fxDate: data.meta.fxRates ? data.meta.fxRates.date : null,
        date: fd.get('date') || '',
        notes: (fd.get('notes') || '').trim()
      });
      saveData();
      if (amountUSD === null) toast('Saved — but that currency isn\'t in your rates yet. Tap "Refresh exchange rates".');
      else toast('Expense added.');
      render();
    });
    document.getElementById('cancel-expense-form').addEventListener('click', () => {
      document.getElementById('expense-form-slot').innerHTML = '';
    });
  });

  document.querySelectorAll('[data-action="delete-expense"]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this expense?')) return;
    data.expenses = data.expenses.filter((e) => e.id !== b.dataset.expenseId);
    saveData();
    render();
  }));
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
    <div class="section-title">App version</div>
    <div class="settings-block">
      <h3>Currently running: ${APP_VERSION}</h3>
      <p class="hint">If you've uploaded an update and the app still looks old after reopening it, use this to force a completely clean reload. It clears the app's offline cache and re-downloads everything — your trip data is untouched, since that's stored separately.</p>
      <button class="btn btn-secondary btn-block" id="btn-force-refresh">Force refresh app</button>
    </div>
  `;
}

/* ---------- Maps helper ---------- */

function mapsSearchUrl(query) {
  return 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(query);
}

function mapsPinUrl(lat, lon) {
  return 'https://www.google.com/maps/search/?api=1&query=' + lat + ',' + lon;
}

/* ---------- Handlers ---------- */

function attachHandlers() {
  document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.goto)));
  document.querySelectorAll('[data-open-stop]').forEach((b) => b.addEventListener('click', () => openStop(b.dataset.openStop)));

  if (currentView === 'route') attachRouteHandlers();
  if (currentView === 'stop') attachStopHandlers();
  if (currentView === 'budget') attachBudgetHandlers();
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
      const defaults = typeof lookupCountryData === 'function' ? lookupCountryData(country) : null;
      if (defaults) {
        Object.assign(s.countryInfo, {
          currency: defaults.currency || '', language: defaults.language || '', plug: defaults.plug || '',
          emergency: defaults.emergency || '', lat: String(defaults.lat), lon: String(defaults.lon), timezone: defaults.timezone || ''
        });
      }
      data.stops.push(s);
      toast(defaults ? 'Stop added — country info auto-filled (check & adjust in Country info tab).' : 'Stop added.');
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
  else if (currentStopTab === 'map') initStopMap(stop);
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

  document.querySelectorAll('[data-action="toggle-day-expand"]').forEach((b) => b.addEventListener('click', () => {
    const dayIndex = Number(b.dataset.day);
    if (expandedDays.has(dayIndex)) expandedDays.delete(dayIndex); else expandedDays.add(dayIndex);
    render();
  }));

  document.querySelectorAll('[data-action="add-block"]').forEach((b) => b.addEventListener('click', () => {
    const dayIndex = Number(b.dataset.day);
    document.getElementById('block-form-slot-' + dayIndex).innerHTML = renderBlockForm(stop, dayIndex);
    wireBlockForm(stop, dayIndex);
  }));

  document.querySelectorAll('[data-action="delete-block"]').forEach((b) => b.addEventListener('click', () => {
    const dayIndex = Number(b.dataset.day);
    stop.daySchedule[dayIndex] = (stop.daySchedule[dayIndex] || []).filter((blk) => blk.id !== b.dataset.blockId);
    saveData();
    render();
  }));
}

function wireBlockForm(stop, dayIndex) {
  const form = document.getElementById('block-form-' + dayIndex);
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const startTime = fd.get('startTime');
    const endTime = fd.get('endTime') || '';
    const attractionId = fd.get('attractionId') || null;
    let label = (fd.get('label') || '').trim();
    if (!label && attractionId) {
      const a = stop.attractionBank.find((x) => x.id === attractionId);
      if (a) label = a.name;
    }
    const existingBlocks = stop.daySchedule[dayIndex] || [];
    const overlap = existingBlocks.some((blk) => timesOverlap(startTime, endTime, blk.startTime, blk.endTime));

    if (!stop.daySchedule[dayIndex]) stop.daySchedule[dayIndex] = [];
    stop.daySchedule[dayIndex].push({
      id: uid('block'), type: fd.get('type'), label, startTime, endTime,
      attractionId, notes: (fd.get('notes') || '').trim()
    });
    saveData();
    toast(overlap ? 'Added — heads up, this overlaps another block on this day.' : 'Time block added.');
    render();
  });
  document.querySelector(`[data-action="cancel-block-form"][data-day="${dayIndex}"]`).addEventListener('click', () => {
    document.getElementById('block-form-slot-' + dayIndex).innerHTML = '';
  });
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
    stop.attractionBank.push(Object.assign(defaultAttraction(), { id: uid('attr'), name, source: 'manual', scheduledDay: dayIndex }));
    saveData();
    render();
  });
}

function attachAttractionsHandlers(stop) {
  const addBtn = document.getElementById('btn-add-attraction');
  if (addBtn) addBtn.addEventListener('click', () => {
    document.getElementById('attraction-form-slot').innerHTML = renderAttractionForm(null);
    wireAttractionForm(stop, null);
  });

  document.querySelectorAll('[data-action="edit-attraction"]').forEach((b) => b.addEventListener('click', () => {
    const a = stop.attractionBank.find((x) => x.id === b.dataset.attrId);
    document.getElementById('attraction-form-slot').innerHTML = renderAttractionForm(a);
    wireAttractionForm(stop, a);
  }));

  document.querySelectorAll('[data-action="delete-attraction"]').forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this attraction?')) return;
    stop.attractionBank = stop.attractionBank.filter((a) => a.id !== b.dataset.attrId);
    saveData();
    render();
  }));

  document.querySelectorAll('[data-action="geocode-attraction"]').forEach((b) => b.addEventListener('click', async () => {
    const attr = stop.attractionBank.find((a) => a.id === b.dataset.attrId);
    if (!attr) return;
    toast('Looking up location…');
    const result = await geocodeLocation(attr.location + ', ' + stop.country);
    if (result) {
      attr.geoLat = result.lat;
      attr.geoLon = result.lon;
      saveData();
      toast('Location found.');
      render();
    } else {
      toast('Could not find that location — check the spelling, or you may be offline.');
    }
  }));

  const promptBtn = document.getElementById('btn-build-ai-prompt');
  if (promptBtn) promptBtn.addEventListener('click', () => {
    const prompt = buildAiPrompt(stop);
    document.getElementById('ai-prompt-slot').innerHTML = `
      <textarea id="ai-prompt-text" rows="10" readonly>${escapeHtml(prompt)}</textarea>
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
    const parsed = parseAiImportText(text);
    if (!parsed.length) { toast('Nothing to import.'); return; }
    parsed.forEach((attr) => {
      attr.id = uid('attr');
      stop.attractionBank.push(attr);
    });
    saveData();
    toast(`Imported ${parsed.length} attraction${parsed.length === 1 ? '' : 's'}.`);
    render();
  });
}

function wireAttractionForm(stop, existing) {
  const form = document.getElementById('attraction-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const values = {
      name: fd.get('name').trim(),
      description: (fd.get('description') || '').trim(),
      location: (fd.get('location') || '').trim(),
      guidedOrSelf: fd.get('guidedOrSelf'),
      gettingThere: (fd.get('gettingThere') || '').trim(),
      whatToBring: (fd.get('whatToBring') || '').trim(),
      notes: (fd.get('notes') || '').trim()
    };
    if (existing) {
      Object.assign(existing, values);
      toast('Attraction updated.');
    } else {
      stop.attractionBank.push(Object.assign(defaultAttraction(), values, { id: uid('attr'), source: 'manual' }));
      toast('Attraction added.');
    }
    saveData();
    document.getElementById('attraction-form-slot').innerHTML = '';
    render();
  });
  document.getElementById('cancel-attraction-form').addEventListener('click', () => {
    document.getElementById('attraction-form-slot').innerHTML = '';
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
        notes: (fd.get('notes') || '').trim(),
        geoLat: null, geoLon: null
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

  document.querySelectorAll('[data-action="geocode-accom"]').forEach((b) => b.addEventListener('click', async () => {
    const accom = stop.accommodations.find((a) => a.id === b.dataset.accomId);
    if (!accom) return;
    toast('Looking up location…');
    const result = await geocodeLocation(accom.address + ', ' + stop.country);
    if (result) {
      accom.geoLat = result.lat;
      accom.geoLon = result.lon;
      saveData();
      toast('Location found.');
      render();
    } else {
      toast('Could not find that location — check the address, or you may be offline.');
    }
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
  const locForm = document.getElementById('location-form');
  locForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(locForm);
    stop.countryInfo.lat = (fd.get('lat') || '').trim();
    stop.countryInfo.lon = (fd.get('lon') || '').trim();
    stop.countryInfo.timezone = (fd.get('timezone') || '').trim();
    saveData();
    toast('Location saved — Shabbat/holiday flags updated.');
    render();
  });

  const form = document.getElementById('info-form');
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    Object.assign(stop.countryInfo, {
      currency: (fd.get('currency') || '').trim(),
      language: (fd.get('language') || '').trim(),
      plug: (fd.get('plug') || '').trim(),
      emergency: (fd.get('emergency') || '').trim(),
      visaNotes: (fd.get('visaNotes') || '').trim(),
      notes: (fd.get('notes') || '').trim()
    });
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

  document.getElementById('btn-force-refresh').addEventListener('click', async () => {
    toast('Clearing cache and reloading…');
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (e) {
      console.warn('Force refresh cleanup had an issue, reloading anyway.', e);
    }
    // cache-busting query param forces the browser to bypass any remaining HTTP cache too
    window.location.href = window.location.pathname + '?refreshed=' + Date.now();
  });
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
  const base = defaultData();
  const merged = Object.assign({}, base, parsed);
  merged.meta = Object.assign({}, base.meta, parsed.meta || {});
  merged.expenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
  merged.stops = (parsed.stops || []).map((s) => {
    const stop = Object.assign(defaultStop(), s);
    stop.countryInfo = Object.assign({}, defaultStop().countryInfo, s.countryInfo || {});
    stop.attractionBank = (s.attractionBank || []).map((a) => Object.assign(defaultAttraction(), a));
    return stop;
  });
  return merged;
}

/* ---------- Small utils ---------- */

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(str) { return escapeHtml(str); }

/* ---------- Init ---------- */

document.querySelectorAll('nav.bottom-nav button').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
const versionBadge = document.getElementById('version-badge');
if (versionBadge) versionBadge.textContent = APP_VERSION;
render();

if (!data.meta.fxRates) {
  refreshFxRates(true);
}

if ('serviceWorker' in navigator) {
  // Fixes "update doesn't apply": when a new service worker takes over,
  // reload once automatically instead of relying on a manual force-quit.
  let refreshedOnce = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshedOnce) return;
    refreshedOnce = true;
    window.location.reload();
  });
  window.addEventListener('load', () => {
    // updateViaCache: 'none' stops the browser from serving a stale, HTTP-cached
    // copy of sw.js itself — this was likely the real cause of updates not sticking.
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).then((reg) => {
      reg.update();
      // Re-check for updates whenever the app comes back to the foreground,
      // since a backgrounded/installed app doesn't always re-check on its own.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') reg.update();
      });
    }).catch((err) => console.warn('SW registration failed', err));
  });
}

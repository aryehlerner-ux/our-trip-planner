/* ---------- Data layer ---------- */

const APP_VERSION = 'v12 · ' + '2026-07-27';
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
const CONFIDENCE_LEVELS = ['Confirmed', 'Preliminary', 'Estimate', 'Assumption'];
const BOOKING_STATUS = ['Researching', 'Shortlisted', 'Pending decision', 'Booked', 'Cancelled'];
const BOOKING_CATEGORIES = ['Accommodation', 'Activity / tour', 'Visa', 'Insurance', 'Transport', 'Other'];

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
      fxRates: null, // { base: 'USD', date: '...', rates: { PEN: 3.7, ... } }
      shabbatSettings: { candleLightingMins: 18, havdalahMethod: 'deg8.5' },
      travelers: { adults: 2, children: 1 },
      workDefaults: {
        enabled: true,
        wakeTime: '08:00',
        bedtime: '21:00',
        blocks: [ { startTime: '09:00', endTime: '11:00' }, { startTime: '21:00', endTime: '23:00' } ]
      },
      dismissedMilestones: []
    },
    stops: [],
    expenses: [], // { id, category, stopId, description, amountLocal, currency, amountUSD, fxRateUsed, fxDate, date, notes }
    awardFlights: [], // { id, program, fromLabel, toLabel, date, pointsPerPerson, taxesFees, passengers, transferPartner, transferBonus, cashEquivalent, confidence, dateChecked, source, bookingDeadline, status, notes }
    bookings: [] // { id, title, category, deadline, status, notes, link }
  };
}

function defaultAttraction() {
  return {
    id: '', name: '', description: '', location: '', guidedOrSelf: 'Not set',
    gettingThere: '', whatToBring: '', notes: '', tags: [], source: 'manual', scheduledDay: null,
    geoLat: null, geoLon: null,
    durationMins: '', confirmation: '', bookingLink: '',
    cost: defaultCost()
  };
}

function defaultStop() {
  return {
    id: '', country: '', durationDays: 14, notes: '',
    dayTypes: {},
    workOverrides: {}, // { [dayIndex]: true } — explicitly skip the work target for that day
    daySchedule: {}, // { [dayIndex]: [ { id, type, label, startTime, endTime, attractionId, notes } ] }
    attractionBank: [],
    accommodations: [],
    transport: [],
    countryInfo: { currency: '', language: '', plug: '', emergency: '', visaNotes: '', notes: '', lat: '', lon: '', timezone: '', chabadKosher: '', chabadVerifiedDate: '' }
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

/* ---------- Undo ---------- */
// Snapshot-based. pushUndo() is called immediately BEFORE any mutation.
// Bounded to 20 states so memory stays trivial. The most recent snapshot is
// also persisted, so one undo survives a reload (deeper history does not —
// that's a deliberate tradeoff, not a silent limitation).

const UNDO_LIMIT = 20;
const UNDO_KEY = 'tripPlannerUndo_v1';
let undoStack = [];
let lastUndoLabel = '';

function pushUndo(label) {
  try {
    const snapshot = JSON.stringify(data);
    undoStack.push({ snapshot, label: label || 'change' });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    lastUndoLabel = label || 'change';
    localStorage.setItem(UNDO_KEY, JSON.stringify({ snapshot, label: lastUndoLabel }));
  } catch (e) {
    console.warn('Could not record undo state', e);
  }
}

function canUndo() {
  if (undoStack.length) return true;
  return !!localStorage.getItem(UNDO_KEY);
}

function undoLast() {
  let entry = undoStack.pop();
  if (!entry) {
    const raw = localStorage.getItem(UNDO_KEY);
    if (!raw) { toast('Nothing to undo.'); return; }
    try { entry = JSON.parse(raw); } catch (e) { toast('Nothing to undo.'); return; }
    localStorage.removeItem(UNDO_KEY);
  }
  try {
    data = loadFromObject(JSON.parse(entry.snapshot));
    saveData();
    if (undoStack.length) {
      localStorage.setItem(UNDO_KEY, JSON.stringify(undoStack[undoStack.length - 1]));
    } else {
      localStorage.removeItem(UNDO_KEY);
    }
    toast('Undone: ' + (entry.label || 'change'));
    render();
  } catch (e) {
    console.error('Undo failed', e);
    toast('Could not undo that.');
  }
}

/* ---------- Normalized cost ---------- */
// Every costable entity (accommodation, transport, attraction) carries this
// same shape, so the budget can roll everything up without special-casing.

function defaultCost() {
  return {
    amount: '', currency: 'USD', basis: 'total', // 'total' | 'per-person'
    travelers: '', quantity: 1,
    paid: '', status: 'estimated', // 'estimated' | 'confirmed'
    refundable: 'unknown' // 'refundable' | 'non-refundable' | 'unknown'
  };
}

function travelerProfileLine() {
  const t = (data.meta && data.meta.travelers) || {};
  const adults = Number(t.adults) || 0;
  const kids = Number(t.children) || 0;
  const parts = [];
  if (adults) parts.push(adults + ' adult' + (adults === 1 ? '' : 's'));
  if (kids) parts.push(kids + ' young child' + (kids === 1 ? '' : 'ren'));
  return parts.length ? parts.join(' and ') : 'two adults and one young child';
}

function travelerCount() {
  const t = (data.meta && data.meta.travelers) || {};
  return (Number(t.adults) || 0) + (Number(t.children) || 0) || 1;
}

// Returns { totalLocal, totalUSD|null, paidUSD|null } for a normalized cost object.
function computeCostTotals(cost) {
  if (!cost || !cost.amount) return { totalLocal: 0, totalUSD: 0, paidUSD: 0 };
  const amt = Number(cost.amount) || 0;
  const qty = Number(cost.quantity) || 1;
  const mult = cost.basis === 'per-person' ? (Number(cost.travelers) || travelerCount()) : 1;
  const totalLocal = amt * qty * mult;
  const totalUSD = convertToUSD(totalLocal, cost.currency);
  const paidLocal = Number(cost.paid) || 0;
  const paidUSD = paidLocal ? convertToUSD(paidLocal, cost.currency) : 0;
  return { totalLocal, totalUSD, paidUSD };
}

function formatCostSummary(cost) {
  if (!cost || !cost.amount) return '';
  const { totalLocal, totalUSD, paidUSD } = computeCostTotals(cost);
  const usdPart = totalUSD === null ? ' <span style="color:var(--red)">(unconverted)</span>' : ' → $' + totalUSD.toFixed(0);
  const basisPart = cost.basis === 'per-person' ? ' (per person × ' + (cost.travelers || travelerCount()) + ')' : '';
  const paidPart = paidUSD ? ' · paid $' + paidUSD.toFixed(0) : '';
  const statusPart = cost.status === 'confirmed' ? ' · confirmed' : ' · estimated';
  return `💰 ${totalLocal.toFixed(2)} ${escapeHtml(cost.currency || '')}${basisPart}${usdPart}${paidPart}${statusPart}`;
}

// Shared cost fields for any entity form. `c` is a cost object (or undefined).
function costFieldsHtml(c) {
  const cost = Object.assign(defaultCost(), c || {});
  return `
    <div class="cost-fieldset">
      <div class="cost-legend">Cost (optional — feeds the budget automatically)</div>
      <div class="form-row">
        <div><label>Amount</label><input name="cost_amount" type="number" min="0" step="0.01" value="${escapeAttr(cost.amount)}" /></div>
        <div><label>Currency</label><input name="cost_currency" value="${escapeAttr(cost.currency)}" placeholder="USD" /></div>
      </div>
      <div class="form-row">
        <div><label>Basis</label>
          <select name="cost_basis">
            <option value="total" ${cost.basis === 'total' ? 'selected' : ''}>Total</option>
            <option value="per-person" ${cost.basis === 'per-person' ? 'selected' : ''}>Per person</option>
          </select>
        </div>
        <div><label>Quantity / nights</label><input name="cost_quantity" type="number" min="1" value="${escapeAttr(cost.quantity || 1)}" /></div>
      </div>
      <div class="form-row">
        <div><label>Amount paid so far</label><input name="cost_paid" type="number" min="0" step="0.01" value="${escapeAttr(cost.paid)}" /></div>
        <div><label>Status</label>
          <select name="cost_status">
            <option value="estimated" ${cost.status === 'estimated' ? 'selected' : ''}>Estimated</option>
            <option value="confirmed" ${cost.status === 'confirmed' ? 'selected' : ''}>Confirmed</option>
          </select>
        </div>
      </div>
      <label>Refundable?</label>
      <select name="cost_refundable">
        <option value="unknown" ${cost.refundable === 'unknown' ? 'selected' : ''}>Not sure</option>
        <option value="refundable" ${cost.refundable === 'refundable' ? 'selected' : ''}>Refundable</option>
        <option value="non-refundable" ${cost.refundable === 'non-refundable' ? 'selected' : ''}>Non-refundable</option>
      </select>
    </div>
  `;
}

function readCostFields(fd) {
  return {
    amount: fd.get('cost_amount') || '',
    currency: (fd.get('cost_currency') || 'USD').trim().toUpperCase() || 'USD',
    basis: fd.get('cost_basis') || 'total',
    travelers: '',
    quantity: Number(fd.get('cost_quantity')) || 1,
    paid: fd.get('cost_paid') || '',
    status: fd.get('cost_status') || 'estimated',
    refundable: fd.get('cost_refundable') || 'unknown'
  };
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

// Available havdalah customs. 'deg' uses solar depression angle (tzeit hakochavim),
// 'mins' uses fixed minutes after sunset. Both are common; which is "right" depends
// on community custom, so the user picks and we always display what was used.
const HAVDALAH_METHODS = [
  { key: 'deg8.5', label: 'Tzeit — 8.5° (common default)', deg: 8.5 },
  { key: 'deg7.083', label: 'Tzeit — 7.083° (three medium stars)', deg: 7.083 },
  { key: 'mins42', label: '42 minutes after sunset', mins: 42 },
  { key: 'mins50', label: '50 minutes after sunset', mins: 50 },
  { key: 'mins60', label: '60 minutes after sunset', mins: 60 },
  { key: 'mins72', label: '72 minutes after sunset (Rabbeinu Tam)', mins: 72 }
];

const CANDLE_LIGHTING_OPTIONS = [18, 20, 22, 30, 40];

function getShabbatSettings() {
  const s = (data.meta && data.meta.shabbatSettings) || {};
  return {
    candleLightingMins: s.candleLightingMins != null ? s.candleLightingMins : 18,
    havdalahMethod: s.havdalahMethod || 'deg8.5'
  };
}

function havdalahMethodLabel(key) {
  const m = HAVDALAH_METHODS.find((x) => x.key === key);
  return m ? m.label : key;
}

function formatTimeInZone(dateObj, timezone) {
  if (!dateObj) return null;
  try {
    return dateObj.toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (e) {
    return null;
  }
}

// Always returns HH:MM in 24-hour local time for a hebcal event, regardless of
// the runtime's locale defaults.
function eventTime24(ev, timezone) {
  if (ev.eventTime) {
    const t = formatTimeInZone(ev.eventTime, timezone);
    if (t) return t;
  }
  if (ev.eventTimeStr && /^\d{1,2}:\d{2}$/.test(ev.eventTimeStr)) {
    const [h, m] = ev.eventTimeStr.split(':');
    return String(h).padStart(2, '0') + ':' + m;
  }
  // Last resort: parse the rendered string, honouring am/pm if present.
  const desc = ev.render('en');
  const m = desc.match(/(\d{1,2}):(\d{2})\s*(am|pm)?/i);
  if (!m) return null;
  let hh = parseInt(m[1], 10);
  const mm = m[2];
  const ap = (m[3] || '').toLowerCase();
  if (ap === 'pm' && hh < 12) hh += 12;
  if (ap === 'am' && hh === 12) hh = 0;
  return String(hh).padStart(2, '0') + ':' + mm;
}

function computeShabbatChagMap(stop, withDates) {
  if (!withDates.startDate || !hasLocation(stop) || typeof Hebcal === 'undefined') return null;
  const info = stop.countryInfo;
  const settings = getShabbatSettings();
  try {
    const loc = new Hebcal.Location(parseFloat(info.lat), parseFloat(info.lon), false, info.timezone, stop.country, '');
    const start = new Date(withDates.startDate + 'T00:00:00');
    const end = new Date(withDates.endDate + 'T00:00:00');

    const calOpts = {
      start, end, location: loc, candlelighting: true, il: false,
      candleLightingMins: settings.candleLightingMins
    };
    const method = HAVDALAH_METHODS.find((m) => m.key === settings.havdalahMethod) || HAVDALAH_METHODS[0];
    if (method.deg) calOpts.havdalahDeg = method.deg; else calOpts.havdalahMins = method.mins;

    const events = Hebcal.HebrewCalendar.calendar(calOpts);
    const map = {};
    events.forEach((ev) => {
      const iso = isoFromGregDate(ev.getDate().greg());
      if (!map[iso]) map[iso] = { candleLighting: null, havdalah: null, sunset: null, isChag: false, chagName: null };
      const f = ev.getFlags();
      const desc = ev.render('en');
      // Use the event's structured time, not a regex over the rendered string.
      // The rendered string is locale-dependent and can come back as "5:50pm",
      // which a naive regex truncates to "5:50" — showing 5am for a 5pm time.
      const evTime = eventTime24(ev, info.timezone);
      if (/Candle lighting/.test(desc)) {
        map[iso].candleLighting = evTime;
      }
      if (/Havdalah/.test(desc)) {
        map[iso].havdalah = evTime;
      }
      if (f & Hebcal.flags.CHAG) {
        map[iso].isChag = true;
        map[iso].chagName = desc.replace(/^\S+ /, '');
      }
    });

    // Add exact sunset for every day in range that matters (Fri/Sat/chag).
    // Computed separately because sunset isn't emitted as a calendar event.
    let cursor = withDates.startDate;
    while (cursor && cursor < withDates.endDate) {
      const d = new Date(cursor + 'T12:00:00');
      const dow = new Date(cursor + 'T00:00:00').getDay();
      const entry = map[cursor];
      if (dow === 5 || dow === 6 || (entry && entry.isChag)) {
        if (!map[cursor]) map[cursor] = { candleLighting: null, havdalah: null, sunset: null, isChag: false, chagName: null };
        try {
          const z = new Hebcal.Zmanim(loc, d);
          map[cursor].sunset = formatTimeInZone(z.sunset(), info.timezone);
        } catch (e) {
          map[cursor].sunset = null; // extreme latitude or unavailable
        }
      }
      cursor = addDays(cursor, 1);
    }

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
    sunset: entry ? entry.sunset : null,
    chagName: entry ? entry.chagName : null
  };
}

/* ---------- Work-hours system ----------
   A global daily template (wake, work blocks, bedtime) applies to every day
   automatically. It's virtual — never written into daySchedule — so editing
   the template updates every day instantly, past and future. When a real
   scheduled block overlaps a default work block, the work block is "interrupted"
   (rendered underneath, credited hours reduced by the overlap) rather than
   deleted or blocking the schedule. Overlapped hours are still owed, per your
   call — the weekly ledger reflects that as a running balance, not a per-day
   reset, so a shortfall carries until it's made up. */

function getWorkDefaults() {
  return (data.meta && data.meta.workDefaults) || defaultData().meta.workDefaults;
}

function workDefaultIntervals() {
  const wd = getWorkDefaults();
  if (!wd.enabled) return [];
  return (wd.blocks || [])
    .map((b) => ({ start: minutesFromTime(b.startTime), end: minutesFromTime(b.endTime), startTime: b.startTime, endTime: b.endTime }))
    .filter((b) => b.start !== null && b.end !== null && b.end > b.start);
}

// A day counts toward the weekly target unless it's Friday/Saturday/a chag
// (via the existing Shabbat flag), or you've explicitly marked it skipped.
function isWorkEligibleDay(stop, dayIndex, flag) {
  if (stop.workOverrides && stop.workOverrides[dayIndex]) return false;
  if (flag && flag.restricted) return false;
  return true;
}

// Credited minutes for one day: each default work interval contributes its
// full duration minus whatever real (non-Work-type) block time overlaps it.
// A manual "Work" block placed outside the defaults counts as bonus credit.
function computeDayWorkStats(stop, dayIndex, flag) {
  const eligible = isWorkEligibleDay(stop, dayIndex, flag);
  const intervals = workDefaultIntervals();
  if (!eligible || !intervals.length) return { targetMinutes: 0, creditedMinutes: 0, eligible, intervals };

  const targetMinutes = intervals.reduce((sum, iv) => sum + (iv.end - iv.start), 0);
  const blocks = (stop.daySchedule[dayIndex] || []);
  let credited = 0;

  intervals.forEach((iv) => {
    let displaced = 0;
    blocks.forEach((b) => {
      if (b.type === 'Work') return; // an explicit work block here doesn't displace — it IS the work
      const bs = minutesFromTime(b.startTime);
      if (bs === null) return;
      const be = minutesFromTime(b.endTime) !== null ? minutesFromTime(b.endTime) : bs;
      const os = Math.max(iv.start, bs), oe = Math.min(iv.end, be);
      if (oe > os) displaced += (oe - os);
    });
    credited += Math.max(0, (iv.end - iv.start) - displaced);
  });

  blocks.forEach((b) => {
    if (b.type !== 'Work') return;
    const bs = minutesFromTime(b.startTime);
    if (bs === null) return;
    const be = minutesFromTime(b.endTime) !== null ? minutesFromTime(b.endTime) : bs;
    const overlapsDefault = intervals.some((iv) => bs < iv.end && be > iv.start);
    if (!overlapsDefault) credited += Math.max(0, be - bs);
  });

  return { targetMinutes, creditedMinutes: credited, eligible, intervals };
}

// Flattens the whole trip (every stop, in route order) into one day-by-day
// list with resolved calendar dates — the basis for both the weekly ledger
// and for finding "today"/"tomorrow" against the real calendar.
function buildTripDayList() {
  const stopsWithDates = computeStopDates();
  const list = [];
  stopsWithDates.forEach((s) => {
    const stop = stopById(s.id);
    for (let i = 0; i < s.durationDays; i++) {
      list.push({ stop, dayIndex: i, date: s.startDate ? addDays(s.startDate, i) : null });
    }
  });
  return list;
}

function sundayOfWeek(dateIso) {
  const d = new Date(dateIso + 'T00:00:00');
  d.setDate(d.getDate() - d.getDay());
  return isoFromGregDate(d);
}

// Weekly (Sunday-start) buckets across the whole trip, target vs. credited,
// with a running cumulative balance — negative means hours owed, positive
// means banked ahead. Computed fresh each call; trip length keeps this cheap.
function buildWeeklyWorkLedger() {
  const days = buildTripDayList().filter((d) => d.date);
  const weeksMap = new Map();
  days.forEach((d) => {
    const key = sundayOfWeek(d.date);
    if (!weeksMap.has(key)) weeksMap.set(key, { weekStart: key, targetMinutes: 0, creditedMinutes: 0 });
    const withDates = stopWithDatesById(d.stop.id);
    const calMap = computeShabbatChagMap(d.stop, withDates);
    const flag = getDayFlag(calMap, d.date);
    const stats = computeDayWorkStats(d.stop, d.dayIndex, flag);
    const w = weeksMap.get(key);
    w.targetMinutes += stats.targetMinutes;
    w.creditedMinutes += stats.creditedMinutes;
  });
  const weeks = [...weeksMap.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart));
  let cumulative = 0;
  weeks.forEach((w) => {
    w.deficitMinutes = w.targetMinutes - w.creditedMinutes;
    cumulative += w.deficitMinutes;
    w.cumulativeAfterMinutes = cumulative;
  });
  return { weeks, cumulativeBalanceMinutes: cumulative };
}

function formatHoursBalance(minutes) {
  const hrs = Math.abs(minutes) / 60;
  const label = hrs.toFixed(1) + 'h';
  if (minutes > 0.5) return { text: label + ' owed', cls: 'owed' };
  if (minutes < -0.5) return { text: label + ' banked ahead', cls: 'banked' };
  return { text: 'on target', cls: 'ontarget' };
}

/* ---------- Resolving the real calendar date to a trip day ---------- */

function todayIso() {
  const d = new Date();
  return isoFromGregDate(d);
}

function resolveRealDate(dateIso) {
  const stopsWithDates = computeStopDates();
  for (const s of stopsWithDates) {
    if (!s.startDate) continue;
    if (dateIso >= s.startDate && dateIso < s.endDate) {
      const dayIndex = Math.round((new Date(dateIso + 'T00:00:00') - new Date(s.startDate + 'T00:00:00')) / 86400000);
      return { stop: stopById(s.id), dayIndex, date: dateIso };
    }
  }
  return null;
}

/* ---------- Toast ---------- */

let toastTimer = null;

// Toast with an inline Undo button — replaces confirm() dialogs for destructive
// actions. Acting first and offering a cheap reversal is faster and less
// error-prone than an "are you sure?" people click through on autopilot.
function toastWithUndo(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.innerHTML = escapeHtml(msg) + ' <button class="toast-undo" id="toast-undo-btn">Undo</button>';
  el.classList.add('show');
  clearTimeout(toastTimer);
  const btn = document.getElementById('toast-undo-btn');
  if (btn) btn.addEventListener('click', () => {
    el.classList.remove('show');
    undoLast();
  });
  toastTimer = setTimeout(() => el.classList.remove('show'), 6000);
}

function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

/* ---------- Navigation state ---------- */

let currentView = 'dashboard'; // dashboard | route | stop | day | week | budget | settings
let currentStopId = null;
let currentStopTab = 'days'; // days | attractions | stay | transport | map | info
let currentDayIndex = null;

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
  aiReviewItems = null;
  aiReviewStopId = null;
  reviewExpanded = new Set();
  document.querySelectorAll('nav.bottom-nav button').forEach((b) => b.classList.remove('active'));
  render();
}

function openDayPage(stopId, dayIndex) {
  currentView = 'day';
  currentStopId = stopId;
  currentDayIndex = dayIndex;
  document.querySelectorAll('nav.bottom-nav button').forEach((b) => b.classList.remove('active'));
  render();
}

function openWeekPage() {
  currentView = 'week';
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
  else if (currentView === 'day') main.innerHTML = renderDayPage();
  else if (currentView === 'week') main.innerHTML = renderWeekPage();
  else if (currentView === 'budget') main.innerHTML = renderBudget();
  else if (currentView === 'settings') main.innerHTML = renderSettings();
  attachHandlers();
  if (currentView === 'day') attachDayPageMapHandler();
  if (currentView === 'week') attachWeekPageHandlers();
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

  const upcomingDeadlines = [
    ...(data.awardFlights || []).map((f) => f.bookingDeadline),
    ...(data.bookings || []).map((b) => b.deadline)
  ].filter((d) => d && daysUntil(d) !== null && daysUntil(d) <= 14 && daysUntil(d) >= 0).length;

  const today = todayIso();
  const todayEntry = resolveRealDate(today);
  const tomorrowEntry = resolveRealDate(addDays(today, 1));
  const urgentItems = computeUrgentItems();
  const workWidget = renderWorkWeekWidget();

  return `
    ${!start ? `<div class="card" style="background:#fff7e6;border-color:var(--amber)">Set your trip start date in <b>Settings</b> to see Today/Tomorrow and urgent items here.</div>` : ''}

    ${renderMilestoneBanners()}

    <div class="section-title">Today &amp; tomorrow</div>
    ${renderTodayCard(todayEntry, 'Today')}
    ${renderTodayCard(tomorrowEntry, 'Tomorrow')}
    <button class="week-link" data-action="open-week">View full week ›</button>

    ${workWidget}

    <div class="section-title">Needs attention (next 7 days)</div>
    ${urgentItems.length
      ? urgentItems.map((it) => `
        <div class="card urgent-row ${it.severity}" data-jump-stop="${it.stopId || ''}" data-jump-tab="${it.tab || ''}" data-jump-budget="${it.jumpBudget ? '1' : ''}">
          <span class="urgent-icon">${it.severity === 'high' ? '⚠' : 'ⓘ'}</span>
          <span class="urgent-msg">${escapeHtml(it.message)}</span>
          <span class="chevron">›</span>
        </div>`).join('')
      : `<div class="empty-state">Nothing urgent in the next 7 days.</div>`}

    <div class="section-title">Trip health</div>
    <div class="stat-row">
      <div class="stat-chip ${toDeparture !== null && toDeparture < 0 ? 'warn' : ''}">
        <div class="num">${toDeparture === null ? '—' : toDeparture}</div>
        <div class="label">Days to departure</div>
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
      <div class="stat-chip ${upcomingDeadlines ? 'warn' : ''}">
        <div class="num">${upcomingDeadlines}</div>
        <div class="label">Booking deadlines within 14 days</div>
      </div>
    </div>
  `;
}

function renderTodayCard(entry, label) {
  if (!entry) {
    return `<div class="card"><div class="hint">${label}: outside your currently planned trip dates.</div></div>`;
  }
  const { stop, dayIndex, date } = entry;
  const dayType = stop.dayTypes[dayIndex] || 'unset';
  const dayTypeLabel = (DAY_TYPES.find((d) => d.value === dayType) || {}).label || 'Not set';
  const scheduled = (stop.attractionBank || []).filter((a) => a.scheduledDay === dayIndex);
  const accom = (stop.accommodations || []).find((a) => dayIndex >= a.startDayIndex && dayIndex < a.startDayIndex + a.nights);
  return `
    <div class="card today-card" data-open-day="${stop.id}" data-day="${dayIndex}">
      <div class="today-card-head">
        <span class="today-label">${label}</span>
        <span class="today-country">${escapeHtml(stop.country)} · Day ${dayIndex + 1}</span>
      </div>
      <div class="hint">${formatDate(date)} · ${escapeHtml(dayTypeLabel)}</div>
      ${accom ? `<div class="hint">🛏 ${escapeHtml(accom.name)}</div>` : '<div class="hint" style="color:var(--red)">No accommodation set</div>'}
      <div class="hint">${scheduled.length ? scheduled.map((a) => escapeHtml(a.name)).join(', ') : 'Nothing scheduled yet'}</div>
      <div class="chevron">›</div>
    </div>
  `;
}

function renderWorkWeekWidget() {
  if (!getWorkDefaults().enabled) return '';
  const ledger = buildWeeklyWorkLedger();
  const thisWeekKey = sundayOfWeek(todayIso());
  const thisWeek = ledger.weeks.find((w) => w.weekStart === thisWeekKey);
  const balance = formatHoursBalance(ledger.cumulativeBalanceMinutes);
  if (!thisWeek) return '';
  const pct = thisWeek.targetMinutes ? Math.min(100, Math.round((thisWeek.creditedMinutes / thisWeek.targetMinutes) * 100)) : 0;
  return `
    <div class="section-title">Work hours this week</div>
    <div class="card">
      <div class="hint">${(thisWeek.creditedMinutes / 60).toFixed(1)}h of ${(thisWeek.targetMinutes / 60).toFixed(1)}h target</div>
      <div class="budget-bar-track" style="margin-top:8px"><div class="budget-bar-fill ${pct >= 100 ? '' : 'over'}" style="width:${pct}%"></div></div>
      <div class="hint balance-${balance.cls}" style="margin-top:8px">Running balance: ${balance.text}${balance.cls === 'owed' ? ' — carries forward until made up' : ''}</div>
    </div>
  `;
}

function computeUrgentItems() {
  const items = [];
  const start = todayIso();
  const seenNoAccom = new Set();
  for (let d = 0; d < 7; d++) {
    const dateIso = addDays(start, d);
    const entry = resolveRealDate(dateIso);
    if (!entry) continue;
    const { stop, dayIndex } = entry;
    const accom = (stop.accommodations || []).find((a) => dayIndex >= a.startDayIndex && dayIndex < a.startDayIndex + a.nights);
    if (!accom) {
      const key = stop.id + ':' + dayIndex;
      if (!seenNoAccom.has(key)) {
        seenNoAccom.add(key);
        items.push({ severity: 'high', message: `No accommodation for ${formatDate(dateIso)} — ${stop.country}, Day ${dayIndex + 1}`, stopId: stop.id, tab: 'stay' });
      }
    }
    const dayType = stop.dayTypes[dayIndex] || 'unset';
    const scheduled = (stop.attractionBank || []).filter((a) => a.scheduledDay === dayIndex);
    if (!scheduled.length && !['travel', 'shabbat-holiday', 'buffer'].includes(dayType)) {
      items.push({ severity: 'info', message: `Nothing planned for ${formatDate(dateIso)} — ${stop.country}, Day ${dayIndex + 1}`, stopId: stop.id, tab: 'days' });
    }
  }
  (data.awardFlights || []).forEach((f) => {
    const d = daysUntil(f.bookingDeadline);
    if (d !== null && d >= 0 && d <= 7) {
      items.push({ severity: 'high', message: `Award flight deadline in ${d}d: ${f.program} ${f.fromLabel} → ${f.toLabel}`, jumpBudget: true });
    }
  });
  (data.bookings || []).forEach((b) => {
    const d = daysUntil(b.deadline);
    if (d !== null && d >= 0 && d <= 7) {
      items.push({ severity: 'high', message: `Booking deadline in ${d}d: ${b.title}`, jumpBudget: true });
    }
  });
  return items;
}

/* ---------- This Week page ---------- */
// A proper 7-day-at-a-glance view (today + next 6 real calendar days), since
// that's the unit you actually plan in — a week of work hours, a week to
// the next Shabbat. Each row taps straight into that day's full page.

const DAY_TYPE_COLOR = {
  'travel': '#c9a24a', 'work-base': '#5b8fa8', 'light-local': '#7fae8e',
  'intensive-excursion': '#c2704f', 'rest-family': '#9b8ac9', 'shabbat-holiday': '#2b6777',
  'buffer': '#b3ab98', 'unset': '#cfc7b0'
};

function renderWeekPage() {
  const startIso = todayIso();
  const rows = [];
  for (let d = 0; d < 7; d++) {
    const dateIso = addDays(startIso, d);
    const entry = resolveRealDate(dateIso);
    const dow = new Date(dateIso + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short' });
    const dayNum = new Date(dateIso + 'T00:00:00').getDate();

    if (!entry) {
      rows.push(`
        <div class="card week-row" style="cursor:default">
          <div class="week-row-date"><span class="dow">${dow}</span>${dayNum}</div>
          <div class="week-row-main"><div class="week-row-meta">Outside your planned trip dates</div></div>
        </div>`);
      continue;
    }

    const { stop, dayIndex } = entry;
    const withDates = stopWithDatesById(stop.id);
    const calMap = computeShabbatChagMap(stop, withDates);
    const flag = getDayFlag(calMap, dateIso);
    const dayType = stop.dayTypes[dayIndex] || 'unset';
    const dayTypeLabel = (DAY_TYPES.find((t) => t.value === dayType) || {}).label || 'Not set';
    const conflicts = detectDayConflicts(stop, dayIndex, flag);
    const accom = (stop.accommodations || []).find((a) => dayIndex >= a.startDayIndex && dayIndex < a.startDayIndex + a.nights);
    const scheduled = (stop.attractionBank || []).filter((a) => a.scheduledDay === dayIndex);
    const wstats = getWorkDefaults().enabled ? computeDayWorkStats(stop, dayIndex, flag) : null;

    rows.push(`
      <div class="card week-row" data-open-day="${stop.id}" data-day="${dayIndex}">
        <div class="week-row-date"><span class="dow">${dow}</span>${dayNum}</div>
        <span class="week-type-dot" style="background:${DAY_TYPE_COLOR[dayType] || '#ccc'}" title="${escapeAttr(dayTypeLabel)}"></span>
        <div class="week-row-main">
          <div class="week-row-country">${escapeHtml(stop.country)} · Day ${dayIndex + 1}</div>
          <div class="week-row-meta">${escapeHtml(dayTypeLabel)}${accom ? ' · 🛏 ' + escapeHtml(accom.name) : ' · no stay set'}${scheduled.length ? ' · ' + scheduled.length + ' planned' : ''}</div>
        </div>
        ${wstats && wstats.targetMinutes > 0 ? `<span class="week-row-work">${(wstats.creditedMinutes / 60).toFixed(1)}/${(wstats.targetMinutes / 60).toFixed(1)}h</span>` : ''}
        ${conflicts.length ? `<span class="week-row-conflict" title="${conflicts.length} conflict(s)">⚠</span>` : ''}
        <span class="chevron">›</span>
      </div>`);
  }

  return `
    <button class="btn-back" id="btn-back-to-dashboard">‹ Dashboard</button>
    <div class="section-title">This week</div>
    ${rows.join('')}
  `;
}

function attachWeekPageHandlers() {
  const backBtn = document.getElementById('btn-back-to-dashboard');
  if (backBtn) backBtn.addEventListener('click', () => setView('dashboard'));
}

/* ---------- Milestone banners ----------
   Small, dismissible, date-driven celebrations. Since there's no way to push
   a notification from a static app, each milestone stays visible for a short
   grace window (not just its exact day) so it isn't missed if you don't open
   the app that precise day — but each can be dismissed for good. */

function getTripDateRange() {
  const stops = computeStopDates().filter((s) => s.startDate);
  if (!stops.length) return null;
  return { start: stops[0].startDate, end: stops[stops.length - 1].endDate };
}

function computeMilestones() {
  const range = getTripDateRange();
  if (!range) return [];
  const today = todayIso();
  const dismissed = new Set(data.meta.dismissedMilestones || []);
  const candidates = [];

  candidates.push({ key: 'trip-start', date: range.start, emoji: '✈️', message: 'Your trip begins today!' });

  const totalDays = Math.round((new Date(range.end + 'T00:00:00') - new Date(range.start + 'T00:00:00')) / 86400000);
  if (totalDays > 1) {
    candidates.push({ key: 'halfway', date: addDays(range.start, Math.floor(totalDays / 2)), emoji: '🎉', message: "You're halfway through the trip!" });
  }

  let d = range.start;
  let guard = 0;
  while (new Date(d + 'T00:00:00').getDay() !== 5 && guard < 7) { d = addDays(d, 1); guard++; }
  candidates.push({ key: 'first-shabbat', date: d, emoji: '🕯', message: 'Your first Shabbat abroad begins tonight.' });

  candidates.push({ key: 'one-month-return', date: addDays(range.end, -30), emoji: '📅', message: "One month until you're back in Israel." });
  candidates.push({ key: 'trip-end', date: addDays(range.end, -1), emoji: '🏡', message: 'Last day of the trip — welcome home soon!' });

  return candidates.filter((m) => !dismissed.has(m.key) && today >= m.date && today <= addDays(m.date, 2));
}

function renderMilestoneBanners() {
  const milestones = computeMilestones();
  if (!milestones.length) return '';
  return milestones.map((m) => `
    <div class="milestone-banner">
      <span class="milestone-emoji">${m.emoji}</span>
      <span class="milestone-text">${escapeHtml(m.message)}</span>
      <button class="milestone-dismiss" data-action="dismiss-milestone" data-key="${m.key}">✕</button>
    </div>
  `).join('');
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

function renderZmanimPanel(stop, flag) {
  if (!flag.restricted) return '';
  const settings = getShabbatSettings();
  const bits = [];
  if (flag.sunset) bits.push(`<div class="zman-row"><span class="zman-label">Sunset</span><span class="zman-time">${flag.sunset}</span></div>`);
  if (flag.candleLighting) bits.push(`<div class="zman-row"><span class="zman-label">🕯 Candle lighting</span><span class="zman-time">${flag.candleLighting}</span></div>`);
  if (flag.havdalah) bits.push(`<div class="zman-row"><span class="zman-label">✨ Ends (havdalah)</span><span class="zman-time">${flag.havdalah}</span></div>`);
  const chabadInfo = (stop.countryInfo || {}).chabadKosher;
  const chabadLine = chabadInfo ? `<div class="zman-chabad">🕯 ${escapeHtml(chabadInfo)}</div>` : '';
  if (bits.length) {
    return `<div class="zmanim-panel">
      ${flag.isChag ? `<div class="zman-chag">🕎 ${escapeHtml(flag.chagName || 'Chag')}</div>` : ''}
      ${bits.join('')}
      <div class="zman-method">${settings.candleLightingMins} min before sunset · ${escapeHtml(havdalahMethodLabel(settings.havdalahMethod))} · times local to ${escapeHtml(stop.countryInfo.timezone || stop.country)}</div>
      ${chabadLine}
    </div>`;
  } else if (hasLocation(stop)) {
    return `<div class="zmanim-panel"><div class="hint-inline">Times unavailable for this date/latitude.</div>${chabadLine}</div>`;
  }
  return chabadLine ? `<div class="zmanim-panel">${chabadLine}</div>` : '';
}

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

    const zmanimPanel = renderZmanimPanel(stop, flag);

    let flagBadges = '';
    if (flag.isFriday) flagBadges += `<span class="cal-badge shabbat">🕯 Shabbat begins${flag.candleLighting ? ' ' + flag.candleLighting : ''}</span>`;
    if (flag.isSaturday) flagBadges += `<span class="cal-badge shabbat">✨ Shabbat ends${flag.havdalah ? ' ' + flag.havdalah : ''}</span>`;
    if (flag.isChag) flagBadges += `<span class="cal-badge chag">🕎 ${escapeHtml(flag.chagName || 'Chag')}</span>`;

    const conflicts = detectDayConflicts(stop, i, flag);
    const conflictHtml = conflicts.length
      ? `<div class="conflict-list">${conflicts.map((c) => `<div class="conflict-item ${c.severity}">${c.severity === 'high' ? '⚠' : 'ⓘ'} ${escapeHtml(c.message)}</div>`).join('')}</div>`
      : '';

    // Work-hours mini panel — only shown if the global template is on
    let workPanel = '';
    if (getWorkDefaults().enabled) {
      const skipped = !!(stop.workOverrides && stop.workOverrides[i]);
      const wstats = computeDayWorkStats(stop, i, flag);
      const restrictedNote = flag.restricted ? ' (Shabbat/chag — not counted)' : '';
      workPanel = `
        <div class="work-panel">
          <label class="work-skip-row">
            <input type="checkbox" data-action="toggle-work-skip" data-day="${i}" ${skipped ? 'checked' : ''} ${flag.restricted ? 'disabled' : ''} />
            <span>Skip work target today</span>
          </label>
          ${wstats.targetMinutes > 0
            ? `<div class="work-stat">💼 ${(wstats.creditedMinutes / 60).toFixed(1)}h / ${(wstats.targetMinutes / 60).toFixed(1)}h credited today</div>`
            : `<div class="work-stat hint-inline">No work target today${restrictedNote}</div>`}
        </div>`;
    }

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
        ${zmanimPanel}
        ${conflictHtml}
        ${workPanel}
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
        ${isExpanded ? renderDayScheduleSection(stop, i, flag) : ''}
        <button class="btn-fullpage-link" data-action="open-day-page" data-stop="${stop.id}" data-day="${i}">⤢ Open as full page</button>
      </div>
    `);
  }
  return rows.join('');
}

/* ----- Conflict detection -----
   Runs on every render so warnings persist, rather than firing once as a toast.
   Each conflict is { severity: 'high'|'info', message }. Nothing is ever blocked —
   these inform, they don't prevent. */

function minutesFromTime(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function detectDayConflicts(stop, dayIndex, flag) {
  const conflicts = [];
  const blocks = (stop.daySchedule[dayIndex] || []).slice()
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  // 1. Overlapping blocks
  for (let x = 0; x < blocks.length; x++) {
    for (let y = x + 1; y < blocks.length; y++) {
      if (timesOverlap(blocks[x].startTime, blocks[x].endTime, blocks[y].startTime, blocks[y].endTime)) {
        conflicts.push({
          severity: 'high',
          message: `"${blocks[x].label || blocks[x].type}" overlaps "${blocks[y].label || blocks[y].type}"`
        });
      }
    }
  }

  // 2. Anything scheduled after candle-lighting on Friday / before havdalah on Shabbat
  if (flag && flag.isFriday && flag.candleLighting) {
    const cl = minutesFromTime(flag.candleLighting);
    blocks.forEach((b) => {
      const st = minutesFromTime(b.startTime);
      if (st !== null && cl !== null && st >= cl - 30 && b.type !== 'Sleep / rest' && b.type !== 'Meal') {
        conflicts.push({
          severity: 'high',
          message: `"${b.label || b.type}" at ${b.startTime} is at or after candle lighting (${flag.candleLighting})`
        });
      }
    });
  }
  if (flag && flag.isSaturday && flag.havdalah) {
    const hv = minutesFromTime(flag.havdalah);
    blocks.forEach((b) => {
      const st = minutesFromTime(b.startTime);
      const restricted = ['Travel', 'Attraction / excursion', 'Work'].includes(b.type);
      if (st !== null && hv !== null && st < hv && restricted) {
        conflicts.push({
          severity: 'high',
          message: `"${b.label || b.type}" at ${b.startTime} falls during Shabbat (ends ${flag.havdalah})`
        });
      }
    });
  }

  // 3. Unrealistically packed day — more than 10 scheduled hours
  const scheduledMins = blocks.reduce((sum, b) => {
    const st = minutesFromTime(b.startTime);
    const en = minutesFromTime(b.endTime);
    return sum + (st !== null && en !== null && en > st ? en - st : 0);
  }, 0);
  if (scheduledMins > 600) {
    conflicts.push({
      severity: 'info',
      message: `${(scheduledMins / 60).toFixed(1)} hours scheduled — that's a heavy day with a young child`
    });
  }

  // 4. Attractions assigned to this day but never given a time
  const scheduledAttrIds = new Set(blocks.map((b) => b.attractionId).filter(Boolean));
  (stop.attractionBank || []).forEach((a) => {
    if (a.scheduledDay === dayIndex && !scheduledAttrIds.has(a.id)) {
      conflicts.push({ severity: 'info', message: `"${a.name}" is on this day but has no time slot yet` });
    }
  });

  return conflicts;
}

/* ----- Visual day timeline -----
   Proportional 6am–midnight agenda so a day's shape (and its gaps) is visible
   at a glance, rather than a flat list of rows. */

const TIMELINE_START_MIN = 6 * 60;   // 06:00
const TIMELINE_END_MIN = 24 * 60;    // 24:00
const TIMELINE_HEIGHT = 540;         // px

const BLOCK_TYPE_CLASS = {
  'Work': 'blk-work',
  'Meal': 'blk-meal',
  'Sleep / rest': 'blk-sleep',
  'Travel': 'blk-travel',
  'Attraction / excursion': 'blk-attraction',
  'Free time': 'blk-free',
  'Other': 'blk-other'
};

function renderTimeline(stop, dayIndex, flag) {
  const blocks = (stop.daySchedule[dayIndex] || []).slice()
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  const span = TIMELINE_END_MIN - TIMELINE_START_MIN;
  const toY = (mins) => ((Math.min(Math.max(mins, TIMELINE_START_MIN), TIMELINE_END_MIN) - TIMELINE_START_MIN) / span) * TIMELINE_HEIGHT;

  // hour gridlines every 2 hours
  let grid = '';
  for (let h = 6; h <= 24; h += 2) {
    const y = toY(h * 60);
    grid += `<div class="tl-gridline" style="top:${y}px"><span class="tl-hour">${String(h % 24).padStart(2, '0')}:00</span></div>`;
  }

  // Shabbat/chag shading — candle lighting to end of day, or start of day to havdalah
  let shade = '';
  if (flag && flag.isFriday && flag.candleLighting) {
    const y = toY(minutesFromTime(flag.candleLighting));
    shade += `<div class="tl-shabbat-shade" style="top:${y}px;height:${TIMELINE_HEIGHT - y}px"></div>
              <div class="tl-shabbat-line" style="top:${y}px"><span>🕯 ${flag.candleLighting}</span></div>`;
  }
  if (flag && flag.isSaturday && flag.havdalah) {
    const y = toY(minutesFromTime(flag.havdalah));
    shade += `<div class="tl-shabbat-shade" style="top:0px;height:${y}px"></div>
              <div class="tl-shabbat-line" style="top:${y}px"><span>✨ ${flag.havdalah}</span></div>`;
  }

  // Virtual default work blocks — dashed, underneath. Never stored, always
  // derived live from Settings, so editing the template updates every day.
  const workEligible = isWorkEligibleDay(stop, dayIndex, flag);
  let defaultEls = '';
  if (workEligible) {
    workDefaultIntervals().forEach((iv) => {
      const top = toY(iv.start);
      const height = Math.max(18, toY(iv.end) - top);
      defaultEls += `
        <div class="tl-default-block" style="top:${top}px;height:${height}px">
          <span class="tl-default-label">Work (default) ${iv.startTime}–${iv.endTime}</span>
        </div>`;
    });
  }

  const blockEls = blocks.map((b) => {
    const st = minutesFromTime(b.startTime);
    if (st === null) return '';
    const en = minutesFromTime(b.endTime);
    const top = toY(st);
    const height = en !== null && en > st ? Math.max(22, toY(en) - top) : 22;
    const cls = BLOCK_TYPE_CLASS[b.type] || 'blk-other';
    return `
      <div class="tl-block ${cls}" style="top:${top}px;height:${height}px" data-block-id="${b.id}" data-day="${dayIndex}">
        <div class="tl-block-inner">
          <span class="tl-block-time">${b.startTime}${b.endTime ? '–' + b.endTime : ''}</span>
          <span class="tl-block-label">${escapeHtml(b.label || b.type)}</span>
        </div>
        <button class="tl-block-del" data-action="delete-block" data-day="${dayIndex}" data-block-id="${b.id}">✕</button>
      </div>`;
  }).join('');

  const emptyHint = !blocks.length && !defaultEls
    ? `<div class="hint-inline" style="margin-top:8px">No time blocks yet — add work, meals, sleep, travel, or attractions below.</div>` : '';

  return `
    <div class="timeline" style="height:${TIMELINE_HEIGHT}px">
      ${grid}
      ${shade}
      ${defaultEls}
      ${blockEls}
    </div>
    ${emptyHint}
    <div class="tl-legend">
      <span class="tl-key blk-work"></span>Work
      <span class="tl-key blk-meal"></span>Meal
      <span class="tl-key blk-sleep"></span>Sleep
      <span class="tl-key blk-travel"></span>Travel
      <span class="tl-key blk-attraction"></span>Attraction
      <span class="tl-key blk-free"></span>Free
    </div>
  `;
}

let dayViewMode = {}; // { [dayIndex]: 'timeline' | 'list' }

/* ----- Full-page Day View ----- */

function collectDayMapPoints(stop, dayIndex, accom) {
  const points = [];
  if (accom && accom.geoLat && accom.geoLon) points.push({ lat: accom.geoLat, lon: accom.geoLon, label: '🛏 ' + accom.name });
  (stop.attractionBank || []).forEach((a) => {
    if (a.scheduledDay === dayIndex && a.geoLat && a.geoLon) points.push({ lat: a.geoLat, lon: a.geoLon, label: '📍 ' + a.name });
  });
  return points;
}

function renderDayPage() {
  const stop = stopById(currentStopId);
  if (!stop || currentDayIndex === null) { setView('route'); return ''; }
  const i = currentDayIndex;
  const withDates = stopWithDatesById(currentStopId);
  const date = withDates.startDate ? addDays(withDates.startDate, i) : '';
  const calMap = computeShabbatChagMap(stop, withDates);
  const flag = getDayFlag(calMap, date);
  const dayType = stop.dayTypes[i] || 'unset';
  const accom = (stop.accommodations || []).find((a) => i >= a.startDayIndex && i < a.startDayIndex + a.nights);
  const scheduled = (stop.attractionBank || []).filter((a) => a.scheduledDay === i);
  const conflicts = detectDayConflicts(stop, i, flag);
  const zmanimPanel = renderZmanimPanel(stop, flag);

  const workDefaultsOn = getWorkDefaults().enabled;
  const skipped = !!(stop.workOverrides && stop.workOverrides[i]);
  const wstats = computeDayWorkStats(stop, i, flag);

  const mapPoints = collectDayMapPoints(stop, i, accom);
  const prevDisabled = i <= 0;
  const nextDisabled = i >= stop.durationDays - 1;

  return `
    <button class="btn-back" id="btn-back-to-stop">‹ ${escapeHtml(stop.country)}</button>
    <div class="day-page-header">
      <button class="day-nav-btn" id="day-prev" ${prevDisabled ? 'disabled style="opacity:.3"' : ''}>‹</button>
      <div class="day-page-title">
        <div class="day-num" style="font-size:1.25rem">Day ${i + 1} of ${stop.durationDays}</div>
        <div class="dates">${date ? formatDate(date) : ''}</div>
      </div>
      <button class="day-nav-btn" id="day-next" ${nextDisabled ? 'disabled style="opacity:.3"' : ''}>›</button>
    </div>

    <select class="day-type-select" data-day="${i}" style="width:100%;margin-bottom:10px">
      ${DAY_TYPES.map((dt) => `<option value="${dt.value}" ${dt.value === dayType ? 'selected' : ''}>${dt.label}</option>`).join('')}
    </select>

    ${zmanimPanel}
    ${conflicts.length ? `<div class="conflict-list">${conflicts.map((c) => `<div class="conflict-item ${c.severity}">${c.severity === 'high' ? '⚠' : 'ⓘ'} ${escapeHtml(c.message)}</div>`).join('')}</div>` : ''}

    ${workDefaultsOn ? `
      <div class="work-panel">
        <label class="work-skip-row">
          <input type="checkbox" data-action="toggle-work-skip" data-day="${i}" ${skipped ? 'checked' : ''} ${flag.restricted ? 'disabled' : ''} />
          <span>Skip work target today</span>
        </label>
        ${wstats.targetMinutes > 0
          ? `<div class="work-stat">💼 ${(wstats.creditedMinutes / 60).toFixed(1)}h / ${(wstats.targetMinutes / 60).toFixed(1)}h credited today</div>`
          : `<div class="work-stat hint-inline">No work target today</div>`}
      </div>` : ''}

    <div class="day-accom">${accom ? '🛏 Sleeping: ' + escapeHtml(accom.name) : '<span class="hint-inline">No accommodation set for this night — add one in the Stay tab.</span>'}</div>

    <div class="section-title">Timeline</div>
    ${renderDayScheduleSection(stop, i, flag)}

    <div class="section-title">Attractions scheduled today</div>
    <div class="day-activities">
      ${scheduled.length ? scheduled.map((a) => `
        <div class="activity-chip">
          <span>${escapeHtml(a.name)}</span>
          <button class="chip-x" data-action="unschedule" data-attr-id="${a.id}">✕</button>
        </div>`).join('') : '<span class="hint-inline">Nothing scheduled yet.</span>'}
    </div>
    <button class="btn btn-secondary" data-action="add-activity-to-day" data-day="${i}">+ Add activity to this day</button>
    <div id="day-activity-picker-${i}"></div>

    ${mapPoints.length ? `
      <div class="section-title">Today's map</div>
      <div id="day-map-container" style="height:260px;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:#eee"></div>
      <div id="day-map-status" class="hint" style="margin-top:6px"></div>
    ` : ''}
  `;
}

function attachDayPageMapHandler() {
  const stop = stopById(currentStopId);
  if (!stop || currentDayIndex === null) return;
  const backBtn = document.getElementById('btn-back-to-stop');
  if (backBtn) backBtn.addEventListener('click', () => openStop(stop.id));
  const prevBtn = document.getElementById('day-prev');
  if (prevBtn) prevBtn.addEventListener('click', () => openDayPage(stop.id, currentDayIndex - 1));
  const nextBtn = document.getElementById('day-next');
  if (nextBtn) nextBtn.addEventListener('click', () => openDayPage(stop.id, currentDayIndex + 1));

  // Reuse the same generic per-day handlers used inside the Stop workspace —
  // they query by data-action/data-day and don't care which page they're on.
  attachDaysHandlers(stop);

  const mapDiv = document.getElementById('day-map-container');
  if (!mapDiv) return;
  const accom = (stop.accommodations || []).find((a) => currentDayIndex >= a.startDayIndex && currentDayIndex < a.startDayIndex + a.nights);
  const points = collectDayMapPoints(stop, currentDayIndex, accom);
  const status = document.getElementById('day-map-status');
  const center = points.length
    ? [points.reduce((s, p) => s + p.lat, 0) / points.length, points.reduce((s, p) => s + p.lon, 0) / points.length]
    : null;
  if (!center) return;
  loadLeaflet().then(() => {
    if (!document.getElementById('day-map-container')) return;
    const map = window.L.map('day-map-container').setView(center, 12);
    window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap contributors', maxZoom: 19 }).addTo(map);
    points.forEach((p) => window.L.marker([p.lat, p.lon]).addTo(map).bindPopup(p.label));
  }).catch(() => { if (status) status.textContent = 'Could not load the map — needs an internet connection.'; });
}

function renderDayScheduleSection(stop, dayIndex, flag) {
  const mode = dayViewMode[dayIndex] || 'timeline';
  const blocks = (stop.daySchedule[dayIndex] || []).slice().sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  const listRows = blocks.length ? blocks.map((b) => `
    <div class="sched-row">
      <div class="sched-time">${b.startTime || '?'}${b.endTime ? '–' + b.endTime : ''}</div>
      <div class="sched-label"><span class="sched-type">${escapeHtml(b.type)}</span>${b.label ? ' · ' + escapeHtml(b.label) : ''}${b.notes ? ' · ' + escapeHtml(b.notes) : ''}</div>
      <button class="icon-btn" data-action="delete-block" data-day="${dayIndex}" data-block-id="${b.id}">✕</button>
    </div>
  `).join('') : '<div class="hint-inline">No time blocks yet — add work, meals, sleep, travel, or attractions below.</div>';

  return `
    <div class="day-schedule">
      <div class="view-toggle">
        <button class="view-toggle-btn ${mode === 'timeline' ? 'active' : ''}" data-action="day-view-mode" data-day="${dayIndex}" data-mode="timeline">Timeline</button>
        <button class="view-toggle-btn ${mode === 'list' ? 'active' : ''}" data-action="day-view-mode" data-day="${dayIndex}" data-mode="list">List</button>
      </div>
      ${mode === 'timeline' ? renderTimeline(stop, dayIndex, flag) : listRows}
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
        ${a.durationMins ? `<div class="hint">⏱ About ${(Number(a.durationMins)/60).toFixed(1)} hours</div>` : ''}
        ${formatCostSummary(a.cost) ? `<div class="hint">${formatCostSummary(a.cost)}</div>` : ''}
        ${a.confirmation ? `<div class="hint">Confirmation: ${escapeHtml(a.confirmation)}</div>` : ''}
        ${a.bookingLink ? `<a class="map-link" target="_blank" rel="noopener" href="${escapeAttr(a.bookingLink)}">Booking link ↗</a>` : ''}
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
      <button class="btn btn-primary" id="btn-import-ai-list" style="margin-top:8px">Preview import</button>
    </div>
    <div id="ai-review-slot">${(aiReviewItems && aiReviewStopId === stop.id) ? renderAiReviewSection(stop) : ''}</div>

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
      <label>Typical visit duration (minutes)</label>
      <input name="durationMins" type="number" min="0" step="15" value="${escapeAttr(a.durationMins || '')}" placeholder="e.g. 180" />
      <label>Booking link (optional)</label>
      <input name="bookingLink" value="${escapeAttr(a.bookingLink || '')}" placeholder="https://..." />
      <label>Confirmation code (optional)</label>
      <input name="confirmation" value="${escapeAttr(a.confirmation || '')}" />
      ${costFieldsHtml(a.cost)}
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
  const existingNames = (stop.attractionBank || []).map((a) => a.name).filter(Boolean);
  const existingLine = existingNames.length
    ? `\n- Already on our list, please don't repeat these: ${existingNames.join(', ')}`
    : '';

  return `I'm planning a family trip and need attraction/activity suggestions for ${stop.country}.

Context:
- Dates: ${withDates.startDate ? formatDate(withDates.startDate) + ' to ' + formatDate(withDates.endDate) : 'not yet set'} (${stop.durationDays} days)
- Travelers: ${travelerProfileLine()}
- Style: slow travel, dramatic nature, authentic local culture, villages, markets, crafts, indigenous-led or community-run tourism; avoid staged/touristy experiences, shopping malls, and nightlife
- Budget-conscious — prefer a realistic mix, not just premium/expensive options
- Practical needs: road quality, child safety, nap disruption, and whether private transport helps should factor into suggestions
- We keep Shabbat (no Friday-Saturday travel) and would like Chabad/kosher notes if relevant${existingLine}

Please suggest 8-10 specific attractions/activities in ${stop.country} that fit this, covering a mix of nature, culture, food/market, and easy/light options — not all intensive excursions.

VERY IMPORTANT — formatting instructions, please follow exactly:
Reply in plain text only. Do NOT use markdown formatting — no headers (no #), no bold (no **), no bullet symbols. Just plain lines of text exactly as shown below, because I'm copying your reply directly into an app that reads this exact structure:

Attraction: [name of the place or activity]
What: [one or two sentence description of what it is]
Where: [specific place/neighborhood name, for a map search]
Tour or self-guided: [Guided tour recommended / Can visit independently / Either works]
Getting there: [how to get there from a typical base, and travel time]
What to bring: [brief list — gear, altitude meds, cash, etc.]
Notes: [child-suitability, booking-ahead needs, or anything else worth knowing]

Leave one blank line between each attraction. Start every single one with the word "Attraction:" exactly like that, in plain text — this is how my app finds where each new suggestion starts. Please don't add any introduction, summary, or closing remarks — just the list of attractions in that exact format, nothing else.`;
}

/* ----- Smart parser for the structured AI reply ----- */
// Understands the "### Title / What: / Where: / Tour or self-guided: / Getting there: /
// What to bring: / Notes:" format from buildAiPrompt(). Falls back to one-attraction-per-line
// for plain pasted lists that don't use that format, so nothing is ever lost.

function parseAiImportText(text) {
  // Strip markdown decoration that may or may not have survived copy-paste
  // (headers/bold render away when copied from a formatted chat UI, but
  // remain if pasted as raw markdown source) — normalize both cases the same way.
  const cleanLine = (l) => l
    .replace(/\*\*/g, '')
    .replace(/^#{1,6}\s*/, '')
    .replace(/^\d+[.)]\s*/, '')
    .replace(/^[-•▪●]\s*/, '')
    .trim();

  const rawLines = text.split('\n').map(cleanLine);

  const fieldPatterns = [
    ['description', /^what:\s*(.*)$/i],
    ['location', /^where:\s*(.*)$/i],
    ['guidedOrSelf', /^tour or self-guided:\s*(.*)$/i],
    ['gettingThere', /^getting there:\s*(.*)$/i],
    ['whatToBring', /^what to bring:\s*(.*)$/i],
    ['notes', /^notes:\s*(.*)$/i]
  ];
  const titlePattern = /^attraction(?:\s*(?:name|title))?:\s*(.*)$/i;

  const hasExplicitTitles = rawLines.some((l) => titlePattern.test(l));
  const hasAnyFieldLabels = rawLines.some((l) => fieldPatterns.some(([, p]) => p.test(l)));

  // Best case: the "Attraction: / What: / Where: ..." format came through
  // (with or without markdown decoration — cleanLine already normalized it).
  if (hasExplicitTitles) {
    const attractions = [];
    let current = null;
    rawLines.forEach((line) => {
      if (!line) return;
      const titleMatch = line.match(titlePattern);
      if (titleMatch && titleMatch[1]) {
        if (current && current.name) attractions.push(current);
        current = Object.assign(defaultAttraction(), { name: titleMatch[1].trim(), source: 'ai-import' });
        return;
      }
      if (!current) return; // ignore any preamble before the first "Attraction:" line
      let matched = false;
      for (const [field, pattern] of fieldPatterns) {
        const m = line.match(pattern);
        if (m) {
          current[field] = (current[field] ? current[field] + ' ' : '') + m[1].trim();
          matched = true;
          break;
        }
      }
      if (!matched) current.notes = current.notes ? current.notes + ' ' + line : line;
    });
    if (current && current.name) attractions.push(current);
    return normalizeGuided(attractions);
  }

  // Next best: no "Attraction:" labels, but the field labels (What:/Where:/etc.)
  // are present — treat the first unlabeled line before each run of fields as
  // that item's title.
  if (hasAnyFieldLabels) {
    const attractions = [];
    let current = null;
    rawLines.forEach((line) => {
      if (!line) return;
      let matched = false;
      for (const [field, pattern] of fieldPatterns) {
        const m = line.match(pattern);
        if (m) {
          if (!current) current = Object.assign(defaultAttraction(), { name: 'Untitled suggestion', source: 'ai-import' });
          current[field] = (current[field] ? current[field] + ' ' : '') + m[1].trim();
          matched = true;
          break;
        }
      }
      if (matched) return;
      // An unlabeled line: if the current item already has fields filled,
      // this line starts a NEW item (its title). Otherwise it's this item's title.
      const hasContent = current && (current.description || current.location || current.gettingThere || current.whatToBring || current.notes);
      if (!current || hasContent) {
        if (current) attractions.push(current);
        current = Object.assign(defaultAttraction(), { name: line, source: 'ai-import' });
      } else {
        current.name = (current.name === 'Untitled suggestion' ? line : current.name + ' ' + line).trim();
      }
    });
    if (current) attractions.push(current);
    return normalizeGuided(attractions);
  }

  // Fallback: no recognizable field structure at all. Group by BLANK-LINE
  // separated paragraphs rather than one-attraction-per-line — a title
  // followed by a description line (very common in a casual AI reply) then
  // becomes one attraction (name + description), not two garbled entries.
  const paragraphs = text.split(/\n\s*\n/).map((p) => p.split('\n').map(cleanLine).filter(Boolean)).filter((p) => p.length);
  return paragraphs.map((pLines) => {
    const [name, ...rest] = pLines;
    return Object.assign(defaultAttraction(), {
      name: name.replace(/^[\s\-•*\d.)]+/, '').trim(),
      description: rest.join(' ').trim(),
      source: 'ai-import'
    });
  });
}

function normalizeGuided(attractions) {
  attractions.forEach((attr) => {
    const gs = (attr.guidedOrSelf || '').toLowerCase();
    if (gs.includes('guided')) attr.guidedOrSelf = 'Guided tour recommended';
    else if (gs.includes('independent') || gs.includes('alone') || gs.includes('self')) attr.guidedOrSelf = 'Can visit independently';
    else if (gs.includes('either')) attr.guidedOrSelf = 'Either works';
    else if (!gs) attr.guidedOrSelf = 'Not set';
  });
  return attractions;
}

/* ----- Batch review before saving AI-parsed attractions -----
   Parsing happens immediately, but nothing is written to the attraction bank
   until you review each item — edit a mis-parsed name, uncheck ones you don't
   want — and explicitly commit. Rejects are simply discarded, never saved. */

let aiReviewItems = null;
let aiReviewStopId = null;

let reviewExpanded = new Set();

function renderAiReviewSection(stop) {
  if (!aiReviewItems || !aiReviewItems.length) return '';
  const includedCount = aiReviewItems.filter((it) => it._include).length;
  const rows = aiReviewItems.map((it, idx) => {
    const isOpen = reviewExpanded.has(idx);
    return `
    <div class="card review-item ${it._include ? '' : 'review-item-excluded'}">
      <label class="review-include-row">
        <input type="checkbox" data-action="review-toggle" data-idx="${idx}" ${it._include ? 'checked' : ''} />
        <input type="text" data-action="review-field" data-field="name" data-idx="${idx}" value="${escapeAttr(it.name)}" class="review-name-input" />
        <button class="icon-btn" data-action="review-expand" data-idx="${idx}">${isOpen ? '▾' : '✎'}</button>
      </label>
      ${!isOpen ? `
        ${it.description ? `<div class="hint">${escapeHtml(it.description)}</div>` : ''}
        ${it.location ? `<div class="hint">📍 ${escapeHtml(it.location)}</div>` : ''}
        ${it.gettingThere ? `<div class="hint">🚗 ${escapeHtml(it.gettingThere)}</div>` : ''}
        ${it.whatToBring ? `<div class="hint">🎒 ${escapeHtml(it.whatToBring)}</div>` : ''}
        ${it.notes ? `<div class="hint">${escapeHtml(it.notes)}</div>` : ''}
      ` : `
        <label class="hint" style="display:block;margin-top:6px">What</label>
        <textarea data-action="review-field" data-field="description" data-idx="${idx}" rows="2">${escapeHtml(it.description || '')}</textarea>
        <label class="hint" style="display:block;margin-top:6px">Where</label>
        <input type="text" data-action="review-field" data-field="location" data-idx="${idx}" value="${escapeAttr(it.location || '')}" />
        <label class="hint" style="display:block;margin-top:6px">Getting there</label>
        <input type="text" data-action="review-field" data-field="gettingThere" data-idx="${idx}" value="${escapeAttr(it.gettingThere || '')}" />
        <label class="hint" style="display:block;margin-top:6px">What to bring</label>
        <input type="text" data-action="review-field" data-field="whatToBring" data-idx="${idx}" value="${escapeAttr(it.whatToBring || '')}" />
        <label class="hint" style="display:block;margin-top:6px">Notes</label>
        <textarea data-action="review-field" data-field="notes" data-idx="${idx}" rows="2">${escapeHtml(it.notes || '')}</textarea>
      `}
    </div>
  `;
  }).join('');

  return `
    <div class="review-banner">
      <b>Review before saving</b> — ${aiReviewItems.length} suggestion${aiReviewItems.length === 1 ? '' : 's'} parsed, ${includedCount} will be added. Tap ✎ to edit any field, untick anything you don't want.
    </div>
    ${rows}
    <div class="form-actions" style="margin:10px 0 20px">
      <button class="btn btn-primary" id="btn-commit-ai-review">Add ${includedCount} attraction${includedCount === 1 ? '' : 's'}</button>
      <button class="btn btn-secondary" id="btn-cancel-ai-review">Discard all</button>
    </div>
  `;
}

function attachAiReviewHandlers(stop) {
  if (!aiReviewItems || aiReviewStopId !== stop.id) return;

  document.querySelectorAll('[data-action="review-toggle"]').forEach((cb) => cb.addEventListener('change', () => {
    aiReviewItems[Number(cb.dataset.idx)]._include = cb.checked;
    // Only the banner count and button label need updating — re-render the
    // whole review slot rather than the whole tab, so typing elsewhere isn't disrupted.
    document.getElementById('ai-review-slot').innerHTML = renderAiReviewSection(stop);
    attachAiReviewHandlers(stop);
  }));

  document.querySelectorAll('[data-action="review-expand"]').forEach((b) => b.addEventListener('click', () => {
    const idx = Number(b.dataset.idx);
    if (reviewExpanded.has(idx)) reviewExpanded.delete(idx); else reviewExpanded.add(idx);
    document.getElementById('ai-review-slot').innerHTML = renderAiReviewSection(stop);
    attachAiReviewHandlers(stop);
  }));

  document.querySelectorAll('[data-action="review-field"]').forEach((inp) => {
    const evt = inp.tagName === 'SELECT' ? 'change' : 'input';
    inp.addEventListener(evt, () => {
      aiReviewItems[Number(inp.dataset.idx)][inp.dataset.field] = inp.value;
    });
  });

  const commitBtn = document.getElementById('btn-commit-ai-review');
  if (commitBtn) commitBtn.addEventListener('click', () => {
    const toAdd = aiReviewItems.filter((it) => it._include);
    if (!toAdd.length) { toast('Nothing selected to add.'); return; }
    pushUndo('import attractions from AI');
    toAdd.forEach((it) => {
      const clean = Object.assign(defaultAttraction(), it, { id: uid('attr') });
      delete clean._include;
      stop.attractionBank.push(clean);
    });
    saveData();
    toastWithUndo(`Added ${toAdd.length} attraction${toAdd.length === 1 ? '' : 's'}.`);
    aiReviewItems = null;
    aiReviewStopId = null;
    reviewExpanded = new Set();
    render();
  });

  const cancelBtn = document.getElementById('btn-cancel-ai-review');
  if (cancelBtn) cancelBtn.addEventListener('click', () => {
    aiReviewItems = null;
    aiReviewStopId = null;
    reviewExpanded = new Set();
    render();
  });
}

/* ----- Stay tab (accommodation) ----- */

function renderStayTab(stop, withDates) {
  const list = stop.accommodations || [];
  const rows = list.length ? list.map((a) => {
    const costLine = formatCostSummary(a.cost);
    return `
    <div class="card">
      <div class="attr-main">
        <div class="attr-name">${escapeHtml(a.name)}</div>
        <div class="hint">Day ${a.startDayIndex + 1}–${a.startDayIndex + a.nights} · ${a.nights} night${a.nights === 1 ? '' : 's'}</div>
        ${costLine ? `<div class="hint">${costLine}</div>` : ''}
        ${a.address ? `
          <div class="loc-row">
            <a class="map-link" target="_blank" rel="noopener" href="${a.geoLat ? mapsPinUrl(a.geoLat, a.geoLon) : mapsSearchUrl(a.address)}">${escapeHtml(a.address)} ↗</a>
            ${a.geoLat ? '<span class="geo-badge">📍 located</span>' : `<button class="icon-btn" data-action="geocode-accom" data-accom-id="${a.id}">🔎</button>`}
          </div>
        ` : ''}
        ${a.confirmation ? `<div class="hint">Confirmation: ${escapeHtml(a.confirmation)}</div>` : ''}
        ${a.cancelBy ? `<div class="hint">Free cancellation until ${formatDate(a.cancelBy)} ${deadlineBadge(a.cancelBy)}</div>` : ''}
        ${a.notes ? `<div class="hint">${escapeHtml(a.notes)}</div>` : ''}
      </div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-accom" data-accom-id="${a.id}">✎</button>
        <button class="icon-btn" data-action="delete-accom" data-accom-id="${a.id}">✕</button>
      </div>
    </div>
  `;
  }).join('') : `<div class="empty-state">No accommodation entries yet — add where you'll sleep each night.</div>`;

  return `
    <button class="btn btn-primary btn-block" id="btn-add-accom">+ Add accommodation</button>
    <div id="accom-form-slot"></div>
    <div class="section-title">Where you're sleeping</div>
    ${rows}
  `;
}

function renderAccomForm(stop, existing) {
  const a = existing || { name: '', address: '', startDayIndex: 0, nights: 3, confirmation: '', notes: '', cancelBy: '', cost: defaultCost() };
  return `
    <form class="inline-form" id="accom-form">
      <label>Name</label>
      <input name="name" value="${escapeAttr(a.name)}" required placeholder="e.g. Casa Andina Cusco" />
      <label>Address (used for the map link)</label>
      <input name="address" value="${escapeAttr(a.address || '')}" placeholder="e.g. Calle San Agustín 400, Cusco" />
      <div class="form-row">
        <div>
          <label>Starting on day #</label>
          <input name="startDayIndex" type="number" min="1" max="${stop.durationDays}" value="${(a.startDayIndex || 0) + 1}" required />
        </div>
        <div>
          <label>Number of nights</label>
          <input name="nights" type="number" min="1" value="${a.nights || 1}" required />
        </div>
      </div>
      ${costFieldsHtml(a.cost)}
      <label>Confirmation code (optional)</label>
      <input name="confirmation" value="${escapeAttr(a.confirmation || '')}" />
      <label>Free cancellation until (optional)</label>
      <input name="cancelBy" type="date" value="${escapeAttr(a.cancelBy || '')}" />
      <label>Notes (kitchen, Shabbat-practicality, etc.)</label>
      <input name="notes" value="${escapeAttr(a.notes || '')}" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${existing ? 'Save changes' : 'Add'}</button>
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
        <div class="hint">${escapeHtml(t.detail || '')}${t.dayIndex !== null && t.dayIndex !== undefined && t.dayIndex !== '' ? ' · Day ' + (Number(t.dayIndex) + 1) : ''}</div>
        ${formatCostSummary(t.cost) ? `<div class="hint">${formatCostSummary(t.cost)}</div>` : ''}
        ${warning}
        ${t.confirmation ? `<div class="hint">Confirmation: ${escapeHtml(t.confirmation)}</div>` : ''}
        ${t.notes ? `<div class="hint">${escapeHtml(t.notes)}</div>` : ''}
        <a class="map-link" target="_blank" rel="noopener" href="${searchUrl}">${t.mode === 'Flight' ? 'Search flights ↗' : 'Search online ↗'}</a>
      </div>
      <div class="actions">
        <button class="icon-btn" data-action="edit-transport" data-transport-id="${t.id}">✎</button>
        <button class="icon-btn" data-action="delete-transport" data-transport-id="${t.id}">✕</button>
      </div>
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

function renderTransportForm(stop, existing) {
  const t = existing || { kind: 'Arrival', mode: 'Flight', detail: '', dayIndex: '', confirmation: '', notes: '', cost: defaultCost() };
  return `
    <form class="inline-form" id="transport-form">
      <label>Type</label>
      <select name="kind">${TRANSPORT_KINDS.map((k) => `<option value="${k}" ${k === t.kind ? 'selected' : ''}>${k}</option>`).join('')}</select>
      <label>Mode</label>
      <select name="mode">${TRANSPORT_MODES.map((m) => `<option value="${m}" ${m === t.mode ? 'selected' : ''}>${m}</option>`).join('')}</select>
      <label>Details</label>
      <input name="detail" value="${escapeAttr(t.detail || '')}" placeholder="e.g. Avianca flight NYC → Lima" />
      <label>Day # (optional)</label>
      <input name="dayIndex" type="number" min="1" max="${stop.durationDays}" value="${t.dayIndex !== null && t.dayIndex !== undefined && t.dayIndex !== '' ? Number(t.dayIndex) + 1 : ''}" />
      ${costFieldsHtml(t.cost)}
      <label>Confirmation code (optional)</label>
      <input name="confirmation" value="${escapeAttr(t.confirmation || '')}" />
      <label>Notes</label>
      <input name="notes" value="${escapeAttr(t.notes || '')}" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">${existing ? 'Save changes' : 'Add'}</button>
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
  const staleDays = info.chabadVerifiedDate ? Math.round((Date.now() - new Date(info.chabadVerifiedDate + 'T00:00:00')) / 86400000) : null;
  const staleClass = staleDays === null ? '' : (staleDays > 60 ? 'stale-danger' : (staleDays > 30 ? 'stale-warn' : 'stale-fresh'));
  const staleLabel = staleDays === null ? 'Not yet verified' : `Last verified ${formatDate(info.chabadVerifiedDate)} (${staleDays} day${staleDays === 1 ? '' : 's'} ago)`;

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

    <div class="card" style="background:#f7f2e8">
      <h3 style="margin:0 0 6px;font-size:0.9rem">🕯 Chabad &amp; kosher info</h3>
      <p class="hint">Chabad house contact, kosher restaurants/stores, eruv info, minyan times — whatever you've found for this stop. This kind of info goes stale, so it's tracked with a last-verified date rather than treated as permanently accurate.</p>
      <form class="inline-form" id="chabad-form" style="margin-top:8px;border:none;padding:0">
        <textarea name="chabadKosher" rows="4" placeholder="e.g. Chabad of Cusco, Rabbi ___, +51 ___. Kosher-ish market at ___. No formal eruv.">${escapeHtml(info.chabadKosher || '')}</textarea>
        <div class="form-row" style="margin-top:8px;align-items:flex-end">
          <div>
            <label>Verified on</label>
            <input name="chabadVerifiedDate" type="date" value="${escapeAttr(info.chabadVerifiedDate || '')}" />
          </div>
          <button type="button" class="btn btn-secondary" id="btn-verify-today" style="flex:0 0 auto;height:42px">Mark verified today</button>
        </div>
        <div class="staleness-badge ${staleClass}">${staleLabel}</div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary">Save Chabad/kosher info</button>
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

let budgetSubTab = 'spending'; // spending | flights

function renderBudget() {
  const tabBar = `
    <div class="stop-tabs">
      <button class="stop-tab ${budgetSubTab === 'spending' ? 'active' : ''}" data-budget-tab="spending">Spending</button>
      <button class="stop-tab ${budgetSubTab === 'flights' ? 'active' : ''}" data-budget-tab="flights">Flights &amp; bookings</button>
    </div>
  `;
  return tabBar + (budgetSubTab === 'spending' ? renderBudgetSpending() : renderFlightsBookings());
}

/* Collects every cost in the trip — from accommodations, transport, attractions,
   AND manual expenses — into one normalized list. This is what makes the budget
   update automatically instead of requiring the same number to be typed twice. */
function collectAllCostItems() {
  const items = [];

  (data.stops || []).forEach((stop) => {
    (stop.accommodations || []).forEach((a) => {
      const t = computeCostTotals(a.cost);
      if (t.totalUSD || t.totalUSD === null) {
        if (a.cost && a.cost.amount) items.push({
          source: 'Accommodation', category: 'Accommodation', label: a.name,
          stopName: stop.country, totalUSD: t.totalUSD, paidUSD: t.paidUSD,
          status: a.cost.status, auto: true
        });
      }
    });
    (stop.transport || []).forEach((tr) => {
      if (tr.cost && tr.cost.amount) {
        const t = computeCostTotals(tr.cost);
        items.push({
          source: 'Transport', category: tr.mode === 'Flight' ? 'Flights' : 'Transportation',
          label: tr.detail || tr.mode, stopName: stop.country,
          totalUSD: t.totalUSD, paidUSD: t.paidUSD, status: tr.cost.status, auto: true
        });
      }
    });
    (stop.attractionBank || []).forEach((a) => {
      if (a.cost && a.cost.amount) {
        const t = computeCostTotals(a.cost);
        items.push({
          source: 'Activity', category: 'Activities', label: a.name, stopName: stop.country,
          totalUSD: t.totalUSD, paidUSD: t.paidUSD, status: a.cost.status, auto: true
        });
      }
    });
  });

  (data.expenses || []).forEach((e) => {
    const stop = stopById(e.stopId);
    items.push({
      source: 'Manual', category: e.category, label: e.description || e.category,
      stopName: stop ? stop.country : '', totalUSD: e.amountUSD, paidUSD: 0,
      status: 'confirmed', auto: false, expenseId: e.id
    });
  });

  return items;
}

function renderBudgetSpending() {
  const allItems = collectAllCostItems();
  const totalUSD = allItems.reduce((sum, i) => sum + (Number(i.totalUSD) || 0), 0);
  const paidUSD = allItems.reduce((sum, i) => sum + (Number(i.paidUSD) || 0), 0);
  const confirmedUSD = allItems.filter((i) => i.status === 'confirmed').reduce((s, i) => s + (Number(i.totalUSD) || 0), 0);
  const estimatedUSD = totalUSD - confirmedUSD;
  const unconvertedCount = allItems.filter((i) => i.totalUSD === null).length;
  const autoCount = allItems.filter((i) => i.auto).length;

  const expenses = data.expenses || [];
  const budget = data.meta.totalBudgetUSD;
  const pct = budget ? Math.min(100, Math.round((totalUSD / budget) * 100)) : null;

  const byCategory = {};
  allItems.forEach((i) => { byCategory[i.category] = (byCategory[i.category] || 0) + (Number(i.totalUSD) || 0); });
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

    <div class="budget-summary">
      <div class="bs-cell"><div class="bs-num">$${totalUSD.toFixed(0)}</div><div class="bs-label">Planned total</div></div>
      <div class="bs-cell"><div class="bs-num">$${confirmedUSD.toFixed(0)}</div><div class="bs-label">Confirmed</div></div>
      <div class="bs-cell"><div class="bs-num">$${estimatedUSD.toFixed(0)}</div><div class="bs-label">Still estimated</div></div>
      <div class="bs-cell"><div class="bs-num">$${paidUSD.toFixed(0)}</div><div class="bs-label">Paid so far</div></div>
      <div class="bs-cell"><div class="bs-num">$${(totalUSD - paidUSD).toFixed(0)}</div><div class="bs-label">Outstanding</div></div>
    </div>
    ${unconvertedCount ? `<div class="card" style="background:#f4e2dd;border-color:var(--red)"><div class="hint">${unconvertedCount} item${unconvertedCount === 1 ? '' : 's'} in a currency not in your rate table — tap "Refresh exchange rates" above. They're excluded from totals rather than counted as zero.</div></div>` : ''}

    ${catRows ? `<div class="section-title">By category</div>${catRows}` : ''}

    <div class="section-title">Tracked automatically (${autoCount})</div>
    <p class="hint">These come from costs you entered on accommodations, transport, and activities — no need to re-enter them here. Edit them where they live.</p>
    ${allItems.filter((i) => i.auto).length
      ? allItems.filter((i) => i.auto).map((i) => `
        <div class="card auto-cost-row">
          <div class="attr-main">
            <div class="attr-name">${escapeHtml(i.label)} <span class="hint">· ${i.source}${i.stopName ? ' · ' + escapeHtml(i.stopName) : ''}</span></div>
            <div class="hint">${i.totalUSD === null ? '<span style="color:var(--red)">unconverted</span>' : '$' + Number(i.totalUSD).toFixed(0)}${i.paidUSD ? ' · paid $' + Number(i.paidUSD).toFixed(0) : ''} · ${i.status}</div>
          </div>
        </div>`).join('')
      : '<div class="empty-state">No item costs yet — add a cost when you create an accommodation, transport leg, or activity.</div>'}

    <div class="section-title">Manual expenses</div>
    <p class="hint">For things with no home elsewhere — groceries, laundry, tips.</p>
    <button class="btn btn-primary btn-block" id="btn-add-expense">+ Add expense</button>
    <div id="expense-form-slot"></div>
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

/* ---------- Flights & bookings sub-page ---------- */

function deadlineBadge(iso) {
  if (!iso) return '';
  const d = daysUntil(iso);
  if (d < 0) return `<span class="deadline-badge expired">Deadline passed (${formatDate(iso)})</span>`;
  if (d <= 14) return `<span class="deadline-badge soon">⏳ ${d} day${d === 1 ? '' : 's'} left</span>`;
  return `<span class="deadline-badge">Due ${formatDate(iso)}</span>`;
}

function renderFlightsBookings() {
  const flights = data.awardFlights || [];
  const bookings = data.bookings || [];

  const flightRows = flights.length ? [...flights].sort((a, b) => (a.bookingDeadline || '9999').localeCompare(b.bookingDeadline || '9999')).map((f) => `
    <div class="card">
      <div class="attr-main">
        <div class="attr-name">${escapeHtml(f.program)} · ${escapeHtml(f.fromLabel)} → ${escapeHtml(f.toLabel)}</div>
        <div class="hint">${f.pointsPerPerson ? f.pointsPerPerson + ' pts/person' : ''}${f.taxesFees ? ' + ' + f.taxesFees + ' fees' : ''}${f.passengers ? ' · ' + f.passengers + ' passengers' : ''}</div>
        ${f.transferPartner ? `<div class="hint">Transfer: ${escapeHtml(f.transferPartner)}${f.transferBonus ? ' (' + escapeHtml(f.transferBonus) + ' bonus)' : ''}</div>` : ''}
        ${f.cashEquivalent ? `<div class="hint">Cash equivalent: ${escapeHtml(f.cashEquivalent)}</div>` : ''}
        <div class="attr-meta">
          <span class="attr-tag">${escapeHtml(f.confidence)}</span>
          <span class="attr-tag status-${(f.status || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(f.status)}</span>
          ${deadlineBadge(f.bookingDeadline)}
        </div>
        ${f.dateChecked ? `<div class="hint">Checked ${formatDate(f.dateChecked)}${f.source ? ' · ' + escapeHtml(f.source) : ''}</div>` : ''}
        ${f.notes ? `<div class="hint">${escapeHtml(f.notes)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="delete-flight" data-flight-id="${f.id}">✕</button>
    </div>
  `).join('') : `<div class="empty-state">No award flights tracked yet.</div>`;

  const bookingRows = bookings.length ? [...bookings].sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999')).map((b) => `
    <div class="card">
      <div class="attr-main">
        <div class="attr-name">${escapeHtml(b.title)} <span class="hint">· ${b.category}</span></div>
        <div class="attr-meta">
          <span class="attr-tag status-${(b.status || '').toLowerCase().replace(/\s+/g, '-')}">${escapeHtml(b.status)}</span>
          ${deadlineBadge(b.deadline)}
        </div>
        ${b.link ? `<a class="map-link" target="_blank" rel="noopener" href="${escapeAttr(b.link)}">Open link ↗</a>` : ''}
        ${b.notes ? `<div class="hint">${escapeHtml(b.notes)}</div>` : ''}
      </div>
      <button class="icon-btn" data-action="delete-booking" data-booking-id="${b.id}">✕</button>
    </div>
  `).join('') : `<div class="empty-state">No bookings tracked yet.</div>`;

  return `
    <div class="section-title">Award flights</div>
    <button class="btn btn-primary btn-block" id="btn-add-flight">+ Track an award flight</button>
    <div id="flight-form-slot"></div>
    ${flightRows}

    <div class="section-title">Other bookings</div>
    <p class="hint">Anything else with a deadline — a Pesach apartment hold, a visa appointment, a tour deposit.</p>
    <button class="btn btn-primary btn-block" id="btn-add-booking">+ Add a booking</button>
    <div id="booking-form-slot"></div>
    ${bookingRows}
  `;
}

function renderFlightForm() {
  return `
    <form class="inline-form" id="flight-form">
      <label>Program (e.g. SAS, United, El Al via Qantas)</label>
      <input name="program" required />
      <div class="form-row">
        <div><label>From</label><input name="fromLabel" placeholder="Tel Aviv" required /></div>
        <div><label>To</label><input name="toLabel" placeholder="New York" required /></div>
      </div>
      <div class="form-row">
        <div><label>Points per person</label><input name="pointsPerPerson" type="number" min="0" /></div>
        <div><label>Taxes &amp; fees (total)</label><input name="taxesFees" placeholder="e.g. $72 x3" /></div>
      </div>
      <label>Passengers</label>
      <input name="passengers" type="number" min="1" value="3" />
      <div class="form-row">
        <div><label>Transfer partner (optional)</label><input name="transferPartner" placeholder="e.g. Amex MR" /></div>
        <div><label>Transfer bonus (optional)</label><input name="transferBonus" placeholder="e.g. 30%" /></div>
      </div>
      <label>Cash equivalent (optional)</label>
      <input name="cashEquivalent" placeholder="e.g. $2,400 for 3" />
      <label>Confidence</label>
      <select name="confidence">${CONFIDENCE_LEVELS.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
      <label>Status</label>
      <select name="status">${BOOKING_STATUS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
      <div class="form-row">
        <div><label>Date checked</label><input name="dateChecked" type="date" /></div>
        <div><label>Booking deadline</label><input name="bookingDeadline" type="date" /></div>
      </div>
      <label>Source (optional)</label>
      <input name="source" placeholder="e.g. pointsyeah.com search" />
      <label>Notes</label>
      <input name="notes" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Add</button>
        <button type="button" class="btn btn-secondary" id="cancel-flight-form">Cancel</button>
      </div>
    </form>
  `;
}

function renderBookingForm() {
  return `
    <form class="inline-form" id="booking-form">
      <label>Title</label>
      <input name="title" required placeholder="e.g. Pesach apartment hold" />
      <label>Category</label>
      <select name="category">${BOOKING_CATEGORIES.map((c) => `<option value="${c}">${c}</option>`).join('')}</select>
      <label>Status</label>
      <select name="status">${BOOKING_STATUS.map((s) => `<option value="${s}">${s}</option>`).join('')}</select>
      <label>Deadline (optional)</label>
      <input name="deadline" type="date" />
      <label>Link (optional)</label>
      <input name="link" placeholder="https://..." />
      <label>Notes</label>
      <input name="notes" />
      <div class="form-actions">
        <button type="submit" class="btn btn-primary">Add</button>
        <button type="button" class="btn btn-secondary" id="cancel-booking-form">Cancel</button>
      </div>
    </form>
  `;
}

function attachFlightsBookingsHandlers() {
  const addFlightBtn = document.getElementById('btn-add-flight');
  if (addFlightBtn) addFlightBtn.addEventListener('click', () => {
    document.getElementById('flight-form-slot').innerHTML = renderFlightForm();
    const form = document.getElementById('flight-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      data.awardFlights.push({
        id: uid('flight'),
        program: fd.get('program').trim(),
        fromLabel: fd.get('fromLabel').trim(),
        toLabel: fd.get('toLabel').trim(),
        pointsPerPerson: fd.get('pointsPerPerson') || '',
        taxesFees: (fd.get('taxesFees') || '').trim(),
        passengers: fd.get('passengers') || '',
        transferPartner: (fd.get('transferPartner') || '').trim(),
        transferBonus: (fd.get('transferBonus') || '').trim(),
        cashEquivalent: (fd.get('cashEquivalent') || '').trim(),
        confidence: fd.get('confidence'),
        status: fd.get('status'),
        dateChecked: fd.get('dateChecked') || '',
        bookingDeadline: fd.get('bookingDeadline') || '',
        source: (fd.get('source') || '').trim(),
        notes: (fd.get('notes') || '').trim()
      });
      saveData();
      toast('Award flight tracked.');
      render();
    });
    document.getElementById('cancel-flight-form').addEventListener('click', () => {
      document.getElementById('flight-form-slot').innerHTML = '';
    });
  });

  document.querySelectorAll('[data-action="delete-flight"]').forEach((b) => b.addEventListener('click', () => {
    pushUndo('delete tracked flight');
    data.awardFlights = data.awardFlights.filter((f) => f.id !== b.dataset.flightId);
    saveData();
    toastWithUndo('Tracked flight removed.');
    render();
  }));

  const addBookingBtn = document.getElementById('btn-add-booking');
  if (addBookingBtn) addBookingBtn.addEventListener('click', () => {
    document.getElementById('booking-form-slot').innerHTML = renderBookingForm();
    const form = document.getElementById('booking-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      data.bookings.push({
        id: uid('booking'),
        title: fd.get('title').trim(),
        category: fd.get('category'),
        status: fd.get('status'),
        deadline: fd.get('deadline') || '',
        link: (fd.get('link') || '').trim(),
        notes: (fd.get('notes') || '').trim()
      });
      saveData();
      toast('Booking added.');
      render();
    });
    document.getElementById('cancel-booking-form').addEventListener('click', () => {
      document.getElementById('booking-form-slot').innerHTML = '';
    });
  });

  document.querySelectorAll('[data-action="delete-booking"]').forEach((b) => b.addEventListener('click', () => {
    pushUndo('delete booking');
    data.bookings = data.bookings.filter((bk) => bk.id !== b.dataset.bookingId);
    saveData();
    toastWithUndo('Booking removed.');
    render();
  }));
}

function attachBudgetHandlers() {
  document.querySelectorAll('[data-budget-tab]').forEach((b) => b.addEventListener('click', () => {
    budgetSubTab = b.dataset.budgetTab;
    render();
  }));

  if (budgetSubTab === 'flights') {
    attachFlightsBookingsHandlers();
    return;
  }

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
    pushUndo('delete expense');
    data.expenses = data.expenses.filter((e) => e.id !== b.dataset.expenseId);
    saveData();
    toastWithUndo('Expense removed.');
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
    <div class="section-title">Shabbat &amp; holiday times</div>
    <div class="settings-block">
      <h3>Calculation custom</h3>
      <p class="hint">These determine the candle-lighting and havdalah times shown on your day cards. Times are always calculated for each stop's own coordinates and timezone. Whichever you choose is displayed alongside the times, so it's never ambiguous which method produced them.</p>
      <label class="hint" style="display:block;margin:10px 0 4px">Candle lighting — minutes before sunset</label>
      <select id="candle-mins-select">
        ${CANDLE_LIGHTING_OPTIONS.map((m) => `<option value="${m}" ${getShabbatSettings().candleLightingMins === m ? 'selected' : ''}>${m} minutes</option>`).join('')}
      </select>
      <label class="hint" style="display:block;margin:10px 0 4px">Havdalah / Shabbat ends</label>
      <select id="havdalah-method-select">
        ${HAVDALAH_METHODS.map((m) => `<option value="${m.key}" ${getShabbatSettings().havdalahMethod === m.key ? 'selected' : ''}>${m.label}</option>`).join('')}
      </select>
      <p class="hint" style="margin-top:10px">Calculations run entirely offline using the bundled Hebrew calendar. Sunset is astronomical for the stop's coordinates; candle lighting and havdalah follow the custom selected above. If your community follows a different practice, pick the closest option — and verify locally when it matters.</p>
    </div>

    <div class="section-title">Work hours</div>
    <div class="settings-block">
      <h3>Daily default schedule</h3>
      <p class="hint">Applies automatically to every day of the whole trip — you don't set this per stop. Friday, Saturday, and any chag are automatically excluded from the target. If a real activity overlaps a work block, the block isn't deleted — it's shown underneath, and the overlapped time still counts as owed, carried forward week to week until it's made up.</p>
      <label class="hint" style="display:block;margin:8px 0 4px">
        <input type="checkbox" id="work-enabled-toggle" ${getWorkDefaults().enabled ? 'checked' : ''} /> Use a daily work-hours template
      </label>
      <div id="work-defaults-fields" style="${getWorkDefaults().enabled ? '' : 'display:none'}">
        <div class="form-row">
          <div><label>Wake time</label><input type="time" id="work-wake" value="${escapeAttr(getWorkDefaults().wakeTime)}" /></div>
          <div><label>Bedtime</label><input type="time" id="work-bedtime" value="${escapeAttr(getWorkDefaults().bedtime)}" /></div>
        </div>
        <label class="hint" style="display:block;margin:10px 0 4px">Work block 1</label>
        <div class="form-row">
          <div><input type="time" id="work-block1-start" value="${escapeAttr((getWorkDefaults().blocks[0] || {}).startTime || '')}" /></div>
          <div><input type="time" id="work-block1-end" value="${escapeAttr((getWorkDefaults().blocks[0] || {}).endTime || '')}" /></div>
        </div>
        <label class="hint" style="display:block;margin:10px 0 4px">Work block 2</label>
        <div class="form-row">
          <div><input type="time" id="work-block2-start" value="${escapeAttr((getWorkDefaults().blocks[1] || {}).startTime || '')}" /></div>
          <div><input type="time" id="work-block2-end" value="${escapeAttr((getWorkDefaults().blocks[1] || {}).endTime || '')}" /></div>
        </div>
        <button class="btn btn-secondary btn-block" id="btn-save-work-defaults" style="margin-top:10px">Save schedule</button>
        <p class="hint" style="margin-top:8px">Current weekly target: <b>${(workDefaultIntervals().reduce((s, iv) => s + (iv.end - iv.start), 0) * 5 / 60).toFixed(1)}h</b> (2 blocks × 5 eligible days/week).</p>
      </div>
    </div>

    <div class="section-title">Travelers</div>
    <div class="settings-block">
      <h3>Who's on this trip</h3>
      <p class="hint">Used for per-person cost calculations and to pre-fill AI research prompts, so you don't retype it each time.</p>
      <div class="form-row">
        <div><label>Adults</label><input type="number" min="0" id="travelers-adults" value="${(data.meta.travelers || {}).adults ?? 2}" /></div>
        <div><label>Children</label><input type="number" min="0" id="travelers-children" value="${(data.meta.travelers || {}).children ?? 1}" /></div>
      </div>
    </div>

    <div class="section-title">Undo</div>
    <div class="settings-block">
      <h3>Undo the last change</h3>
      <p class="hint">Reverses your most recent edit or deletion. Recent changes are also undoable straight from the toast that appears after each action.</p>
      <button class="btn btn-secondary btn-block" id="btn-undo-settings" ${canUndo() ? '' : 'disabled style="opacity:.5"'}>Undo last change</button>
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
  document.querySelectorAll('[data-open-day]').forEach((b) => b.addEventListener('click', () => openDayPage(b.dataset.openDay, Number(b.dataset.day))));
  const weekLink = document.querySelector('[data-action="open-week"]');
  if (weekLink) weekLink.addEventListener('click', openWeekPage);
  document.querySelectorAll('[data-action="dismiss-milestone"]').forEach((b) => b.addEventListener('click', () => {
    if (!data.meta.dismissedMilestones) data.meta.dismissedMilestones = [];
    data.meta.dismissedMilestones.push(b.dataset.key);
    saveData();
    render();
  }));
  document.querySelectorAll('[data-jump-stop], [data-jump-budget]').forEach((b) => b.addEventListener('click', () => {
    if (b.dataset.jumpBudget) { setView('budget'); budgetSubTab = 'flights'; render(); return; }
    if (b.dataset.jumpStop) {
      openStop(b.dataset.jumpStop);
      if (b.dataset.jumpTab) { currentStopTab = b.dataset.jumpTab; render(); }
    }
  }));

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
  pushUndo('delete stop');
  data.stops = data.stops.filter((s) => s.id !== id);
  saveData();
  toastWithUndo('Stop removed.');
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

  document.querySelectorAll('[data-action="day-view-mode"]').forEach((b) => b.addEventListener('click', () => {
    dayViewMode[Number(b.dataset.day)] = b.dataset.mode;
    render();
  }));

  document.querySelectorAll('[data-action="toggle-work-skip"]').forEach((cb) => cb.addEventListener('click', () => {
    const dayIndex = Number(cb.dataset.day);
    if (!stop.workOverrides) stop.workOverrides = {};
    stop.workOverrides[dayIndex] = cb.checked;
    saveData();
    render();
  }));

  document.querySelectorAll('[data-action="open-day-page"]').forEach((b) => b.addEventListener('click', () => {
    openDayPage(b.dataset.stop, Number(b.dataset.day));
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
    pushUndo('delete attraction');
    stop.attractionBank = stop.attractionBank.filter((a) => a.id !== b.dataset.attrId);
    saveData();
    toastWithUndo('Attraction removed.');
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
    aiReviewItems = parsed.map((a) => Object.assign(a, { _include: true }));
    aiReviewStopId = stop.id;
    render();
  });

  attachAiReviewHandlers(stop);
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
      durationMins: fd.get('durationMins') || '',
      bookingLink: (fd.get('bookingLink') || '').trim(),
      confirmation: (fd.get('confirmation') || '').trim(),
      cost: readCostFields(fd),
      notes: (fd.get('notes') || '').trim()
    };
    if (existing) {
      pushUndo('attraction edit');
      if (values.location !== existing.location) { values.geoLat = null; values.geoLon = null; }
      Object.assign(existing, values);
      toastWithUndo('Attraction updated.');
    } else {
      pushUndo('add attraction');
      stop.attractionBank.push(Object.assign(defaultAttraction(), values, { id: uid('attr'), source: 'manual' }));
      toastWithUndo('Attraction added.');
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
  const openAccomForm = (existing) => {
    document.getElementById('accom-form-slot').innerHTML = renderAccomForm(stop, existing);
    const form = document.getElementById('accom-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const values = {
        name: fd.get('name').trim(),
        address: (fd.get('address') || '').trim(),
        startDayIndex: Math.max(0, (parseInt(fd.get('startDayIndex'), 10) || 1) - 1),
        nights: Math.max(1, parseInt(fd.get('nights'), 10) || 1),
        confirmation: (fd.get('confirmation') || '').trim(),
        cancelBy: fd.get('cancelBy') || '',
        notes: (fd.get('notes') || '').trim(),
        cost: readCostFields(fd)
      };
      if (existing) {
        pushUndo('accommodation edit');
        // address changed? invalidate the cached coordinates rather than keeping a wrong pin
        if (values.address !== existing.address) { values.geoLat = null; values.geoLon = null; }
        Object.assign(existing, values);
        toastWithUndo('Accommodation updated.');
      } else {
        pushUndo('add accommodation');
        stop.accommodations.push(Object.assign({ id: uid('accom'), geoLat: null, geoLon: null }, values));
        toastWithUndo('Accommodation added.');
      }
      saveData();
      render();
    });
    document.getElementById('cancel-accom-form').addEventListener('click', () => {
      document.getElementById('accom-form-slot').innerHTML = '';
    });
  };

  const addBtn = document.getElementById('btn-add-accom');
  if (addBtn) addBtn.addEventListener('click', () => openAccomForm(null));

  document.querySelectorAll('[data-action="edit-accom"]').forEach((b) => b.addEventListener('click', () => {
    openAccomForm(stop.accommodations.find((a) => a.id === b.dataset.accomId));
  }));

  document.querySelectorAll('[data-action="delete-accom"]').forEach((b) => b.addEventListener('click', () => {
    pushUndo('delete accommodation');
    stop.accommodations = stop.accommodations.filter((a) => a.id !== b.dataset.accomId);
    saveData();
    toastWithUndo('Accommodation removed.');
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
  const openTransportForm = (existing) => {
    document.getElementById('transport-form-slot').innerHTML = renderTransportForm(stop, existing);
    const form = document.getElementById('transport-form');
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const dayIndexRaw = fd.get('dayIndex');
      const values = {
        kind: fd.get('kind'),
        mode: fd.get('mode'),
        detail: (fd.get('detail') || '').trim(),
        dayIndex: dayIndexRaw ? Math.max(0, parseInt(dayIndexRaw, 10) - 1) : null,
        confirmation: (fd.get('confirmation') || '').trim(),
        notes: (fd.get('notes') || '').trim(),
        cost: readCostFields(fd)
      };
      if (existing) {
        pushUndo('transport edit');
        Object.assign(existing, values);
        toastWithUndo('Transport updated.');
      } else {
        pushUndo('add transport');
        stop.transport.push(Object.assign({ id: uid('transport') }, values));
        toastWithUndo('Transport added.');
      }
      saveData();
      render();
    });
    document.getElementById('cancel-transport-form').addEventListener('click', () => {
      document.getElementById('transport-form-slot').innerHTML = '';
    });
  };

  const addBtn = document.getElementById('btn-add-transport');
  if (addBtn) addBtn.addEventListener('click', () => openTransportForm(null));

  document.querySelectorAll('[data-action="edit-transport"]').forEach((b) => b.addEventListener('click', () => {
    openTransportForm(stop.transport.find((t) => t.id === b.dataset.transportId));
  }));

  document.querySelectorAll('[data-action="delete-transport"]').forEach((b) => b.addEventListener('click', () => {
    pushUndo('delete transport');
    stop.transport = stop.transport.filter((t) => t.id !== b.dataset.transportId);
    saveData();
    toastWithUndo('Transport removed.');
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

  const chabadForm = document.getElementById('chabad-form');
  chabadForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new FormData(chabadForm);
    stop.countryInfo.chabadKosher = (fd.get('chabadKosher') || '').trim();
    stop.countryInfo.chabadVerifiedDate = fd.get('chabadVerifiedDate') || '';
    saveData();
    toast('Chabad/kosher info saved.');
    render();
  });
  document.getElementById('btn-verify-today').addEventListener('click', () => {
    document.querySelector('#chabad-form [name="chabadVerifiedDate"]').value = todayIso();
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

  document.getElementById('candle-mins-select').addEventListener('change', (e) => {
    data.meta.shabbatSettings.candleLightingMins = Number(e.target.value);
    saveData();
    toast('Candle-lighting custom updated — times recalculated.');
  });

  document.getElementById('havdalah-method-select').addEventListener('change', (e) => {
    data.meta.shabbatSettings.havdalahMethod = e.target.value;
    saveData();
    toast('Havdalah custom updated — times recalculated.');
  });

  const workEnabledToggle = document.getElementById('work-enabled-toggle');
  if (workEnabledToggle) workEnabledToggle.addEventListener('change', (e) => {
    data.meta.workDefaults.enabled = e.target.checked;
    saveData();
    render();
  });

  const saveWorkBtn = document.getElementById('btn-save-work-defaults');
  if (saveWorkBtn) saveWorkBtn.addEventListener('click', () => {
    data.meta.workDefaults.wakeTime = document.getElementById('work-wake').value || data.meta.workDefaults.wakeTime;
    data.meta.workDefaults.bedtime = document.getElementById('work-bedtime').value || data.meta.workDefaults.bedtime;
    const b1s = document.getElementById('work-block1-start').value;
    const b1e = document.getElementById('work-block1-end').value;
    const b2s = document.getElementById('work-block2-start').value;
    const b2e = document.getElementById('work-block2-end').value;
    const blocks = [];
    if (b1s && b1e) blocks.push({ startTime: b1s, endTime: b1e });
    if (b2s && b2e) blocks.push({ startTime: b2s, endTime: b2e });
    data.meta.workDefaults.blocks = blocks;
    saveData();
    toast('Work schedule saved — applies to every day automatically.');
    render();
  });

  ['travelers-adults', 'travelers-children'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      data.meta.travelers = {
        adults: Number(document.getElementById('travelers-adults').value) || 0,
        children: Number(document.getElementById('travelers-children').value) || 0
      };
      saveData();
      toast('Traveler count updated.');
    });
  });

  const undoBtn = document.getElementById('btn-undo-settings');
  if (undoBtn) undoBtn.addEventListener('click', () => undoLast());

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

// Converts the old flat { cost: 5, currency: 'PEN' } shape into the normalized
// cost object, so existing saved trips keep their numbers after this upgrade.
function migrateCost(item) {
  if (item.cost && typeof item.cost === 'object') {
    return Object.assign(defaultCost(), item.cost);
  }
  const legacyAmount = item.cost;
  const c = defaultCost();
  if (legacyAmount !== undefined && legacyAmount !== null && legacyAmount !== '') {
    c.amount = legacyAmount;
    c.currency = (item.currency || 'USD').toUpperCase();
  }
  return c;
}

function loadFromObject(parsed) {
  const base = defaultData();
  const merged = Object.assign({}, base, parsed);
  merged.meta = Object.assign({}, base.meta, parsed.meta || {});
  merged.meta.shabbatSettings = Object.assign({}, base.meta.shabbatSettings, (parsed.meta || {}).shabbatSettings || {});
  merged.meta.travelers = Object.assign({}, base.meta.travelers, (parsed.meta || {}).travelers || {});
  merged.meta.workDefaults = Object.assign({}, base.meta.workDefaults, (parsed.meta || {}).workDefaults || {});
  merged.meta.dismissedMilestones = Array.isArray((parsed.meta || {}).dismissedMilestones) ? parsed.meta.dismissedMilestones : [];
  merged.expenses = Array.isArray(parsed.expenses) ? parsed.expenses : [];
  merged.awardFlights = Array.isArray(parsed.awardFlights) ? parsed.awardFlights : [];
  merged.bookings = Array.isArray(parsed.bookings) ? parsed.bookings : [];
  merged.stops = (parsed.stops || []).map((s) => {
    const stop = Object.assign(defaultStop(), s);
    stop.countryInfo = Object.assign({}, defaultStop().countryInfo, s.countryInfo || {});
    stop.attractionBank = (s.attractionBank || []).map((a) => {
      const attr = Object.assign(defaultAttraction(), a);
      attr.cost = migrateCost(a);
      return attr;
    });
    stop.accommodations = (s.accommodations || []).map((a) => {
      const accom = Object.assign({}, a);
      accom.cost = migrateCost(a);
      return accom;
    });
    stop.transport = (s.transport || []).map((t) => {
      const tr = Object.assign({}, t);
      tr.cost = migrateCost(t);
      return tr;
    });
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

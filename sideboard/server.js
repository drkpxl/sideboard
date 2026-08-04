// Sideboard — zero-dependency Node 22 server.
// Polls Home Assistant, derives a display viewmodel, pushes it to the
// frontend over SSE, and serves the static app from public/.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Two runtimes share this file:
//  - HA add-on: options come from /data/options.json (flat snake_case, defined
//    in config.yaml), auth via the Supervisor proxy — no token to manage.
//  - Local dev: local.config.json + a long-lived token in .env.
function optionsToConfig(o) {
  const s = v => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);
  return {
    port: o.port ?? 8090,
    haUrl: null,
    entities: {
      weather: s(o.weather_entity),
      outdoorWeather: s(o.outdoor_weather_entity),
      sun: 'sun.sun',
      indoorTemp: s(o.indoor_temp_entity),
      outdoorAqi: s(o.outdoor_aqi_entity),
      indoorAqi: s(o.indoor_aqi_entity),
      energyToday: s(o.energy_today_entity),
      waterToday: s(o.water_today_entity),
      gasTotal: s(o.gas_total_entity),
      familyCalendar: s(o.family_calendar),
      binsSource: s(o.bins_source),
      nwsAlertEntity: s(o.nws_alert_entity),
      leakSensors: (o.leak_sensors || []).map(s).filter(Boolean),
      coSensors: (o.co_sensors || []).map(s).filter(Boolean),
      radonSensor: s(o.radon_sensor),
      doorSensors: (o.door_sensors || []).map(s).filter(Boolean),
      garageDoors: (o.garage_doors || []).map(s).filter(Boolean),
      birdnetSensor: s(o.birdnet_sensor),
      commuteSensor: s(o.commute_sensor),
      workdaySensor: s(o.workday_sensor),
      commutePresence: s(o.commute_presence),
    },
    dayparts: {
      morningStart: o.morning_start ?? '05:30',
      morningEnd: o.morning_end ?? '09:30',
      eveningStart: o.evening_start ?? '16:30',
      eveningEnd: o.evening_end ?? '22:30',
      dayShows: o.day_shows ?? 'evening',
    },
    prepBufferMin: o.prep_buffer_min ?? 15,
    aqiAlertThreshold: o.aqi_alert_threshold ?? 125,
    coAlertPpm: o.co_alert_ppm ?? 9,
    radonAlertPciL: o.radon_alert_pci_l ?? 4,
    maxAlerts: o.max_alerts ?? 3,
    birdMaxAgeHours: o.bird_max_age_hours ?? 12,
    rainProbThreshold: o.rain_prob_threshold ?? 40,
    gasThermsPerFt3: o.gas_therms_per_ft3 ?? 0.01037,
    language: s(o.language),
    timeFormat: String(o.time_format ?? 'auto'),
    nws: { enabled: o.nws_alerts ?? true, userAgent: o.nws_user_agent ?? 'day-board-addon' },
  };
}

// Dev files (.env, local.config.json) live at the repo root, one level above
// the add-on folder; check both so `node sideboard/server.js` just works.
function findLocal(name) {
  for (const dir of [ROOT, path.join(ROOT, '..')]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function loadConfig() {
  if (fs.existsSync('/data/options.json')) {
    return optionsToConfig(JSON.parse(fs.readFileSync('/data/options.json', 'utf8')));
  }
  const p = findLocal('local.config.json');
  if (!p) {
    console.error('No /data/options.json (add-on) and no local.config.json (dev) found');
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

// Every optional feature must be safe to omit entirely: a config written for an
// older version, or by someone who owns none of these sensors, has to boot.
function normalizeConfig(c) {
  c.entities ||= {};
  for (const k of ['leakSensors', 'coSensors', 'doorSensors', 'garageDoors']) {
    c.entities[k] = Array.isArray(c.entities[k]) ? c.entities[k].filter(Boolean) : [];
  }
  for (const k of ['radonSensor', 'birdnetSensor', 'commuteSensor',
    'workdaySensor', 'commutePresence']) {
    c.entities[k] ??= null;
  }
  c.coAlertPpm ??= 9;
  c.radonAlertPciL ??= 4;
  c.maxAlerts ??= 3;
  c.birdMaxAgeHours ??= 12;
  return c;
}
const CONFIG = normalizeConfig(loadConfig());

function loadEnv() {
  const out = {};
  try {
    const p = findLocal('.env');
    if (!p) return out;
    for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2];
    }
  } catch { /* no .env */ }
  return out;
}
const ENV = loadEnv();
// The Supervisor token env var has been renamed across generations
// (HASSIO_TOKEN → SUPERVISOR_TOKEN → the "apps" era); accept any of them.
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || process.env.HASSIO_TOKEN
  || process.env.APP_TOKEN || null;
const TOKEN = SUPERVISOR_TOKEN || process.env.HA_LL_ACCESS_TOKEN || ENV.HA_LL_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('No auth available: need a Supervisor token (add-on) or HA_LL_ACCESS_TOKEN in .env (dev)');
  // Env var NAMES only (no values) — tells us what this Supervisor provides.
  console.error('Environment variables present:', Object.keys(process.env).sort().join(', '));
  process.exit(1);
}
const API_BASE = SUPERVISOR_TOKEN
  ? 'http://supervisor/core/api'
  : (process.env.HA_URL || ENV.HA_URL || CONFIG.haUrl) + '/api';

// ---------------------------------------------------------------- HA client

async function ha(pathname, opts = {}) {
  const res = await fetch(API_BASE + pathname.replace(/^\/api/, ''), {
    ...opts,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      ...opts.headers,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HA ${pathname} -> ${res.status}`);
  return res.json();
}

// ------------------------------------------------------------ localization

// Every user-facing string lives here. Plain-string entries are shipped to the
// frontend as vm.strings; functions are sentence templates used server-side.
const LANG = {
  en: {
    locale: 'en-US',
    // client labels
    nextOut: 'NEXT OUT THE DOOR', firstUpTomorrow: 'FIRST UP TOMORROW', today: 'TODAY',
    thenToday: 'THEN TODAY', takeWithYou: 'TAKE WITH YOU', tomorrow: 'TOMORROW',
    overnight: 'OVERNIGHT', powerToday: 'POWER TODAY', waterToday: 'WATER TODAY',
    gasToday: 'GAS TODAY',
    rainToday: 'RAIN TODAY', temperature: 'TEMPERATURE', airQuality: 'AIR QUALITY',
    outside: 'outside', inside: 'inside', sunrise: 'SUNRISE', sunset: 'SUNSET',
    railIn: 'IN', railOut: 'OUT', allDay: 'ALL DAY', firstUp: 'FIRST UP', now: 'NOW',
    insideWord: 'INSIDE', outsideWord: 'OUTSIDE',
    nothingElse: 'Nothing else today', nothingScheduled: 'Nothing scheduled',
    nothingPlanned: 'Nothing scheduled', chanceOfRain: 'chance of rain', peaks: 'peaks',
    inMinTpl: 'in {m} min', inHmTpl: 'in {h} h {m} min', dataOldTpl: 'data {m} min old',
    conditions: {
      'clear-night': 'Clear', sunny: 'Sunny', partlycloudy: 'Partly cloudy',
      cloudy: 'Cloudy', fog: 'Foggy', rainy: 'Rain', pouring: 'Heavy rain',
      lightning: 'Storms', 'lightning-rainy': 'Storms', hail: 'Hail',
      snowy: 'Snow', 'snowy-rainy': 'Wintry mix', windy: 'Windy',
      'windy-variant': 'Windy', exceptional: 'Severe',
    },
    kinds: { trash: 'trash', recycling: 'recycling', compost: 'compost', bins: 'bins' },
    kindJoin: ' & ',
    // server sentence templates
    adviceFreezing: t => `Big coat — it's ${t}° out.`,
    adviceCold: t => `Warm coat — it's ${t}° out.`,
    adviceCool: t => `Jacket — it's ${t}° out.`,
    adviceMildHi: (t, hi) => `Light layer — ${t}° now, high of ${hi}°.`,
    adviceMild: t => `Light layer — ${t}° out.`,
    adviceHot: hi => `It's warm — heading to ${hi}°.`,
    adviceWarm: t => `No jacket needed — ${t}° out.`,
    umbrellaNow: () => 'Umbrella — raining now.',
    umbrellaFrom: h => `Umbrella too, rain from ${h}.`,
    umbrellaLikely: () => 'Umbrella too — rain likely.',
    binsTonight: kinds => `Bins out tonight — ${kinds}`,
    binsGoOut: () => 'Bins go out tonight.',
    rainTomorrow: () => 'Rain tomorrow — umbrellas by the door.',
    overnightLow: (cond, low) => `${cond}, low ${low}°`,
    windowsOpen: 'windows can stay open', windowsClose: 'close the windows',
    coldNight: 'cold night', warmNight: 'warm night',
    pctRain: p => `${p}% rain`, uv: u => `UV ${u}`,
    nightStorms: 'Storms passing through', nightRain: 'Rain', nightSnow: 'Snow',
    nightUntil: (verb, h) => `${verb} until ${h}`,
    nightLater: verb => `${verb} later tonight`,
    nightWindy: g => `Windy — gusts to ${g}`,
    waterLeak: name => `Water leak — ${name}`,
    aqiAlert: (label, aqi) => `Air quality ${label} — AQI ${aqi}`,
    aqiPoor: 'poor', aqiUnhealthy: 'unhealthy', aqiVeryUnhealthy: 'very unhealthy',
    alertUntil: (text, time) => `${text} until ${time}`,
    coAlert: (name, ppm) => `Carbon monoxide — ${name} ${ppm} ppm`,
    radonAlert: v => `Radon elevated — ${v} pCi/L`,
    // client labels
    moreAlertsTpl: '+{n} more', latestBird: 'LATEST BIRD', beforeBed: 'BEFORE BED',
    // closure + commute sentences
    allClosed: () => 'All doors closed',
    openList: names => `${names} still open`,
    stillOpen: names => `Still open — ${names}.`,
    commuteTo: (min, name) => `${min} min to ${name}`,
  },
  es: {
    locale: 'es-MX',
    nextOut: 'PRÓXIMA SALIDA', firstUpTomorrow: 'PRIMERO MAÑANA', today: 'HOY',
    thenToday: 'LUEGO HOY', takeWithYou: 'LLEVA CONTIGO', tomorrow: 'MAÑANA',
    overnight: 'ESTA NOCHE', powerToday: 'ENERGÍA HOY', waterToday: 'AGUA HOY',
    gasToday: 'GAS HOY',
    rainToday: 'LLUVIA HOY', temperature: 'TEMPERATURA', airQuality: 'CALIDAD DEL AIRE',
    outside: 'afuera', inside: 'adentro', sunrise: 'AMANECER', sunset: 'ATARDECER',
    railIn: 'INT', railOut: 'EXT', allDay: 'TODO EL DÍA', firstUp: 'PRIMERO', now: 'AHORA',
    insideWord: 'ADENTRO', outsideWord: 'AFUERA',
    nothingElse: 'Nada más hoy', nothingScheduled: 'Nada agendado',
    nothingPlanned: 'Nada agendado', chanceOfRain: 'prob. de lluvia', peaks: 'máx',
    inMinTpl: 'en {m} min', inHmTpl: 'en {h} h {m} min', dataOldTpl: 'datos de hace {m} min',
    conditions: {
      'clear-night': 'Despejado', sunny: 'Soleado', partlycloudy: 'Parcialmente nublado',
      cloudy: 'Nublado', fog: 'Niebla', rainy: 'Lluvia', pouring: 'Lluvia fuerte',
      lightning: 'Tormentas', 'lightning-rainy': 'Tormentas', hail: 'Granizo',
      snowy: 'Nieve', 'snowy-rainy': 'Aguanieve', windy: 'Viento',
      'windy-variant': 'Viento', exceptional: 'Severo',
    },
    kinds: { trash: 'basura', recycling: 'reciclaje', compost: 'composta', bins: 'botes' },
    kindJoin: ' y ',
    adviceFreezing: t => `Abrigo grueso — hace ${t}° afuera.`,
    adviceCold: t => `Abrigo — hace ${t}° afuera.`,
    adviceCool: t => `Chamarra — hace ${t}° afuera.`,
    adviceMildHi: (t, hi) => `Capa ligera — ${t}° ahora, máxima de ${hi}°.`,
    adviceMild: t => `Capa ligera — ${t}° afuera.`,
    adviceHot: hi => `Hará calor — llegando a ${hi}°.`,
    adviceWarm: t => `Sin chamarra — ${t}° afuera.`,
    umbrellaNow: () => 'Paraguas — está lloviendo.',
    umbrellaFrom: h => `Paraguas también — lluvia desde las ${h}.`,
    umbrellaLikely: () => 'Paraguas también — probable lluvia.',
    binsTonight: kinds => `Sacar esta noche — ${kinds}`,
    binsGoOut: () => 'La basura sale esta noche.',
    rainTomorrow: () => 'Lluvia mañana — paraguas junto a la puerta.',
    overnightLow: (cond, low) => `${cond}, mínima ${low}°`,
    windowsOpen: 'las ventanas pueden quedar abiertas', windowsClose: 'cierra las ventanas',
    coldNight: 'noche fría', warmNight: 'noche cálida',
    pctRain: p => `${p}% lluvia`, uv: u => `UV ${u}`,
    nightStorms: 'Tormentas', nightRain: 'Lluvia', nightSnow: 'Nieve',
    nightUntil: (verb, h) => `${verb} hasta las ${h}`,
    nightLater: verb => `${verb} más tarde`,
    nightWindy: g => `Viento — ráfagas de ${g}`,
    waterLeak: name => `Fuga de agua — ${name}`,
    aqiAlert: (label, aqi) => `Calidad del aire ${label} — AQI ${aqi}`,
    aqiPoor: 'mala', aqiUnhealthy: 'dañina', aqiVeryUnhealthy: 'muy dañina',
    alertUntil: (text, time) => `${text} hasta ${time}`,
    coAlert: (name, ppm) => `Monóxido de carbono — ${name} ${ppm} ppm`,
    radonAlert: v => `Radón elevado — ${v} pCi/L`,
    moreAlertsTpl: '+{n} más', latestBird: 'ÚLTIMA AVE', beforeBed: 'ANTES DE DORMIR',
    allClosed: () => 'Todas las puertas cerradas',
    openList: names => `${names} sin cerrar`,
    stillOpen: names => `Sigue abierto — ${names}.`,
    commuteTo: (min, name) => `${min} min a ${name}`,
  },
};
// Language, locale, clock style, and units all come from HA's own config at
// startup unless the add-on options override them — no assumptions baked in.
let L = LANG.en;
let LOCALE = 'en-US';
let HOUR12 = true;
let CLIENT_STRINGS = {};

function resolveLocale(haLanguage) {
  const requested = (CONFIG.language || haLanguage || 'en').toLowerCase();
  const short = requested.split(/[-_]/)[0];
  L = LANG[requested] || LANG[short] || LANG.en;
  // Use the full tag for date formatting even when we lack a string table
  // for it — day and month names still come out right via Intl.
  LOCALE = requested.includes('-') ? requested : (L.locale || 'en-US');
  if (CONFIG.timeFormat === '12') HOUR12 = true;
  else if (CONFIG.timeFormat === '24') HOUR12 = false;
  else {
    HOUR12 = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric' })
      .resolvedOptions().hour12 ?? true;
  }
  CLIENT_STRINGS = Object.fromEntries(
    Object.entries(L).filter(([, v]) => typeof v === 'string'));
}
resolveLocale(null);

// ------------------------------------------------------------- time helpers

let TZ = 'America/Denver'; // replaced by HA config at startup
let IS_METRIC = false;     // from HA unit_system at startup
let WIND_UNIT = 'mph';

// Advice thresholds are authored in °F; convert when HA runs metric.
function T(f) { return IS_METRIC ? Math.round((f - 32) / 1.8) : f; }

function zonedParts(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  });
  const p = {};
  for (const { type, value } of fmt.formatToParts(d)) p[type] = value;
  return {
    y: +p.year, mo: +p.month, d: +p.day,
    h: +p.hour === 24 ? 0 : +p.hour, mi: +p.minute, s: +p.second,
  };
}

function zoneOffset(d = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' });
  const part = fmt.formatToParts(d).find(p => p.type === 'timeZoneName');
  const m = part.value.match(/GMT([+-]\d{2}:\d{2})?/);
  return m && m[1] ? m[1] : '+00:00';
}

function localISODate(d = new Date()) {
  const { y, mo, d: day } = zonedParts(d);
  return `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function localMidnight(d = new Date()) {
  return new Date(`${localISODate(d)}T00:00:00${zoneOffset(d)}`);
}

function addDays(date, n) {
  return new Date(date.getTime() + n * 86400000);
}

function fmtClock(d) {
  if (!HOUR12) {
    const { h, mi } = zonedParts(d);
    return `${h}:${String(mi).padStart(2, '0')}`;
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour: 'numeric', minute: '2-digit', hour12: true,
  }).format(d).replace(/\s?[AP]M/i, '');
}

function fmtHourLabel(d) {
  // "3pm" in 12h mode, "15:00" in 24h mode
  const h = zonedParts(d).h;
  if (!HOUR12) return `${h}:00`;
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${h < 12 ? 'am' : 'pm'}`;
}

function fmtHourBare(h) {
  // Bare hour for "until N" phrasing: "2" (12h) or "14" (24h)
  return HOUR12 ? String(h % 12 === 0 ? 12 : h % 12) : String(h);
}

// ------------------------------------------------------------------- state

const S = {
  entities: {},          // entity_id -> {state, attributes}
  calToday: [], calTomorrow: [],
  binsEvents: [],        // normalized {whenISO, kind}
  daily: [], hourly: [], // forecasts
  powerHours: [], waterHours: [], // 24 numbers (per hour, entity units)
  powerNowKw: null,
  gasToday: null, // {value, unit}
  nwsAlerts: [],
  haOk: false,
  lastError: null,
};

const TRACKED = [
  CONFIG.entities.weather, CONFIG.entities.outdoorWeather,
  CONFIG.entities.sun, CONFIG.entities.indoorTemp,
  CONFIG.entities.outdoorAqi, CONFIG.entities.indoorAqi,
  CONFIG.entities.energyToday, CONFIG.entities.waterToday, CONFIG.entities.gasTotal,
  CONFIG.entities.nwsAlertEntity,
  ...CONFIG.entities.leakSensors,
  ...CONFIG.entities.coSensors,
  ...CONFIG.entities.doorSensors,
  ...CONFIG.entities.garageDoors,
  CONFIG.entities.radonSensor, CONFIG.entities.birdnetSensor,
  CONFIG.entities.commuteSensor, CONFIG.entities.workdaySensor,
  CONFIG.entities.commutePresence,
].filter(Boolean);

// ------------------------------------------------------------------ pollers

async function pollStates() {
  const all = await ha('/api/states');
  for (const e of all) {
    if (TRACKED.includes(e.entity_id)) {
      S.entities[e.entity_id] = { state: e.state, attributes: e.attributes };
    }
  }
  S.haOk = true;
}

function normEvent(e) {
  const startRaw = e.start?.dateTime || e.start?.date;
  const allDay = !e.start?.dateTime;
  return {
    summary: (e.summary || '').trim(),
    startISO: startRaw,
    allDay,
    start: allDay ? new Date(`${startRaw}T00:00:00${zoneOffset()}`) : new Date(startRaw),
  };
}

async function pollCalendar() {
  const cal = CONFIG.entities.familyCalendar;
  if (!cal) return;
  const mid = localMidnight();
  const ranges = [
    [mid, addDays(mid, 1)],
    [addDays(mid, 1), addDays(mid, 2)],
  ];
  const [today, tomorrow] = await Promise.all(ranges.map(([a, b]) =>
    ha(`/api/calendars/${cal}?start=${a.toISOString()}&end=${b.toISOString()}`)));
  const prep = evts => evts.map(normEvent)
    .filter(e => e.summary)
    .sort((a, b) => (a.allDay !== b.allDay) ? (a.allDay ? -1 : 1) : a.start - b.start);
  S.calToday = prep(today);
  S.calTomorrow = prep(tomorrow);
}

async function pollBins() {
  const src = CONFIG.entities.binsSource;
  S.binsEvents = [];
  if (!src) return;
  const mid = localMidnight();
  const horizon = addDays(mid, 2);
  const classify = t => {
    const kinds = [];
    if (/trash|garbage|waste/i.test(t)) kinds.push('trash');
    if (/recycl/i.test(t)) kinds.push('recycling');
    if (/compost|yard/i.test(t)) kinds.push('compost');
    if (!kinds.length && /\bbins?\b/i.test(t)) kinds.push('bins');
    return kinds.length ? kinds.join(' & ') : null;
  };
  try {
    if (src.startsWith('calendar.')) {
      const evts = await ha(`/api/calendars/${src}?start=${mid.toISOString()}&end=${horizon.toISOString()}`);
      for (const e of evts) {
        const n = normEvent(e);
        const kind = classify(n.summary);
        if (kind) S.binsEvents.push({ when: n.start.toISOString(), kind });
      }
    } else if (src.startsWith('todo.')) {
      const resp = await ha(`/api/services/todo/get_items?return_response`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: src, status: 'needs_action' }),
      });
      const items = resp?.service_response?.[src]?.items || [];
      for (const it of items) {
        const kind = classify(it.summary || '');
        const due = it.due;
        if (!kind || !due) continue;
        const when = due.length <= 10 ? new Date(`${due}T00:00:00${zoneOffset()}`) : new Date(due);
        if (when >= mid && when < horizon) S.binsEvents.push({ when: when.toISOString(), kind });
      }
    }
  } catch (err) {
    // Bins source not set up yet — footer simply stays hidden.
    if (!/-> 404|-> 400|-> 500/.test(String(err.message))) throw err;
  }
}

async function pollForecast() {
  const w = CONFIG.entities.weather;
  if (!w) return;
  const call = type => ha(`/api/services/weather/get_forecasts?return_response`, {
    method: 'POST',
    body: JSON.stringify({ entity_id: w, type }),
  }).then(r => r?.service_response?.[w]?.forecast || []);
  const [daily, hourly] = await Promise.all([call('daily'), call('hourly')]);
  S.daily = daily;
  S.hourly = hourly;
}

function numeric(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Bucket a cumulative day-meter history into per-hour deltas.
function hourlyDeltas(points, midnight) {
  const series = points
    .map(p => ({ t: new Date(p.last_changed || p.lu).getTime(), v: numeric(p.state) }))
    .filter(p => p.v !== null)
    .sort((a, b) => a.t - b.t);
  const out = [];
  const m0 = midnight.getTime();
  for (let h = 0; h < 24; h++) {
    const start = m0 + h * 3600000, end = start + 3600000;
    // Sum positive consecutive diffs so the midnight (or any) meter reset
    // inside an hour doesn't wipe out that hour's usage.
    let sum = null, prev = null;
    for (const p of series) {
      if (p.t >= end) break;
      if (p.t < start) { prev = p.v; continue; }
      if (prev !== null && p.v >= prev) sum = (sum ?? 0) + (p.v - prev);
      else if (sum === null) sum = 0;
      prev = p.v;
    }
    out.push(sum);
  }
  return out;
}

async function pollHistory() {
  const mid = localMidnight();
  const startArg = mid.toISOString();
  const q = id => !id ? Promise.resolve([])
    : ha(`/api/history/period/${startArg}?filter_entity_id=${id}&minimal_response&no_attributes`)
      .then(r => r?.[0] || []);

  const [energy, water, gas] = await Promise.all([
    q(CONFIG.entities.energyToday),
    q(CONFIG.entities.waterToday),
    q(CONFIG.entities.gasTotal),
  ]);

  S.powerHours = hourlyDeltas(energy, mid);
  S.waterHours = hourlyDeltas(water, mid);

  // Live kW: slope of the cumulative day meter over the last ~10 minutes.
  const pts = energy
    .map(p => ({ t: new Date(p.last_changed).getTime(), v: numeric(p.state) }))
    .filter(p => p.v !== null);
  const now = Date.now();
  const recent = pts.filter(p => now - p.t < 12 * 60000);
  if (recent.length >= 2) {
    const a = recent[0], b = recent[recent.length - 1];
    const hours = (b.t - a.t) / 3600000;
    S.powerNowKw = hours > 0 && b.v >= a.v ? (b.v - a.v) / hours : null;
  } else {
    S.powerNowKw = null;
  }

  // Gas: day total is the delta on the cumulative meter. If it counts in ft³
  // we convert to therms; any other unit (m³ etc.) is shown as-is.
  const gasVals = gas.map(p => numeric(p.state)).filter(v => v !== null);
  const gasUnit = ent(CONFIG.entities.gasTotal)?.attributes?.unit_of_measurement || '';
  const gasDelta = gasVals.length >= 2
    ? Math.max(0, gasVals[gasVals.length - 1] - gasVals[0])
    : (gasVals.length ? 0 : null);
  if (gasDelta === null) S.gasToday = null;
  else if (/ft³|ft3/i.test(gasUnit)) {
    S.gasToday = { value: gasDelta * CONFIG.gasThermsPerFt3, unit: 'therm' };
  } else {
    S.gasToday = { value: gasDelta, unit: gasUnit };
  }
}

let NWS_POINT = null;
async function pollNws() {
  // When an HA alert entity (e.g. the HACS "NWS Alerts" integration) is
  // configured, it is the source of truth and we skip direct polling.
  if (CONFIG.entities.nwsAlertEntity) return;
  if (!CONFIG.nws?.enabled) return;
  if (!NWS_POINT) return;
  const res = await fetch(`https://api.weather.gov/alerts/active?point=${NWS_POINT}`, {
    headers: { 'User-Agent': CONFIG.nws.userAgent, Accept: 'application/geo+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`NWS -> ${res.status}`);
  const data = await res.json();
  S.nwsAlerts = (data.features || [])
    .map(f => f.properties)
    .filter(p => p && p.status === 'Actual')
    .filter(p => warningWorthy(p.event, p.severity))
    .map(p => ({ event: p.event, headline: p.headline, ends: p.ends || p.expires, severity: p.severity }));
}

// --------------------------------------------------------------- derivation

function ent(id) { return S.entities[id] || null; }
function entNum(id) { return numeric(ent(id)?.state); }

// Integrations love to stutter ("Side Door Door", "Garage Door Opener Garage").
// Drop any word that already appeared so display names read like a person wrote
// them, without asking anyone to rename entities in HA.
function cleanName(raw) {
  const seen = new Set();
  const words = String(raw || '').split(/\s+/).filter(w => {
    const k = w.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return words.join(' ') || String(raw || '');
}

function listJoin(items) {
  try {
    return new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' }).format(items);
  } catch {
    return items.join(', ');
  }
}

// Current outdoor conditions: prefer the real NWS station observation,
// fall back to the forecast integration's modeled "now".
function outdoorNow() {
  const nws = ent(CONFIG.entities.outdoorWeather);
  const apple = ent(CONFIG.entities.weather);
  const nwsLive = nws && !['unavailable', 'unknown', ''].includes(nws.state || '');
  return {
    temp: (nwsLive ? numeric(nws.attributes?.temperature) : null)
      ?? numeric(apple?.attributes?.temperature),
    condition: nwsLive ? nws.state : apple?.state,
  };
}

function todayHourly() {
  const today = localISODate();
  return S.hourly.filter(f => localISODate(new Date(f.datetime)) === today);
}

function tomorrowDaily() {
  const tom = localISODate(addDays(new Date(), 1));
  return S.daily.find(f => localISODate(new Date(f.datetime)) === tom) || null;
}

function todayDaily() {
  const today = localISODate();
  return S.daily.find(f => localISODate(new Date(f.datetime)) === today) || null;
}

const RAINY = new Set(['rainy', 'pouring', 'lightning', 'lightning-rainy', 'hail', 'snowy-rainy']);
const STORMY = new Set(['lightning', 'lightning-rainy']);
const SNOWY = new Set(['snowy', 'snowy-rainy']);

function conditionWord(c) {
  return L.conditions[c] || (c ? c[0].toUpperCase() + c.slice(1) : '—');
}

function rainToday() {
  const hours = todayHourly();
  const now = Date.now();
  const remaining = hours.filter(h => new Date(h.datetime).getTime() >= now - 3600000);
  const probs = remaining.map(h => numeric(h.precipitation_probability) ?? 0);
  if (!probs.length) {
    const d = todayDaily();
    return { prob: numeric(d?.precipitation_probability) ?? 0, peak: null };
  }
  const max = Math.max(...probs);
  const idx = probs.indexOf(max);
  return {
    prob: Math.round(max),
    peak: max >= 15 ? fmtHourLabel(new Date(remaining[idx].datetime)) : null,
  };
}

function firstRainHour() {
  const th = CONFIG.rainProbThreshold;
  for (const h of todayHourly()) {
    if (new Date(h.datetime).getTime() < Date.now()) continue;
    if ((numeric(h.precipitation_probability) ?? 0) >= th || RAINY.has(h.condition)) {
      return fmtHourLabel(new Date(h.datetime));
    }
  }
  return null;
}

function adviceSentence() {
  const out = outdoorNow();
  const t = Math.round(out.temp ?? NaN);
  const hi = Math.round(numeric(todayDaily()?.temperature) ?? NaN);
  const lines = [];
  if (Number.isFinite(t)) {
    if (t < T(35)) lines.push(L.adviceFreezing(t));
    else if (t < T(50)) lines.push(L.adviceCold(t));
    else if (t < T(60)) lines.push(L.adviceCool(t));
    else if (t < T(70)) lines.push(Number.isFinite(hi) ? L.adviceMildHi(t, hi) : L.adviceMild(t));
    else lines.push(Number.isFinite(hi) && hi >= T(90) ? L.adviceHot(hi) : L.adviceWarm(t));
  }
  const rain = rainToday();
  if (RAINY.has(out.condition)) lines.push(L.umbrellaNow());
  else if (rain.prob >= CONFIG.rainProbThreshold) {
    const from = firstRainHour();
    lines.push(from ? L.umbrellaFrom(from.replace(/[ap]m$/, '')) : L.umbrellaLikely());
  }
  return lines.slice(0, 2).join('\n');
}

function timedEvents(list) { return list.filter(e => !e.allDay); }

function countdown() {
  const now = Date.now();
  const next = timedEvents(S.calToday).find(e => e.start.getTime() > now);
  if (next) {
    const leave = new Date(next.start.getTime() - CONFIG.prepBufferMin * 60000);
    return {
      label: L.nextOut,
      clock: fmtClock(leave),
      leaveISO: leave.toISOString(),
      name: next.summary,
    };
  }
  const tomorrow = timedEvents(S.calTomorrow)[0];
  if (tomorrow) {
    return {
      label: L.firstUpTomorrow,
      clock: fmtClock(tomorrow.start),
      leaveISO: null,
      name: tomorrow.summary,
    };
  }
  return { label: L.today, clock: '—', leaveISO: null, name: L.nothingScheduled };
}

function agendaToday(excludeSummary) {
  const now = Date.now();
  const upcoming = S.calToday.filter(e =>
    e.allDay || e.start.getTime() > now);
  const rows = [];
  for (const e of upcoming) {
    if (!e.allDay && e.summary === excludeSummary && rows.length === 0 && timedEvents(S.calToday).find(x => x.summary === excludeSummary)) continue;
    rows.push({ time: e.allDay ? 'all day' : fmtClock(e.start), name: e.summary });
  }
  return rows.slice(0, 4);
}

function agendaTomorrow() {
  return S.calTomorrow.map(e => ({
    time: e.allDay ? 'all day' : fmtClock(e.start),
    name: e.summary,
  })).slice(0, 4);
}

function binsLine() {
  const mid = localMidnight();
  const tonightEnd = addDays(mid, 1).getTime() + 10 * 3600000; // through tomorrow 10am
  const ev = S.binsEvents
    .map(b => ({ ...b, t: new Date(b.when).getTime() }))
    .filter(b => b.t >= mid.getTime() && b.t <= tonightEnd)
    .sort((a, b) => a.t - b.t)[0];
  if (!ev) return null;
  const kinds = ev.kind.split(' & ').map(k => L.kinds[k] || k).join(L.kindJoin);
  return L.binsTonight(kinds);
}

function overnight() {
  const now = new Date();
  // The coming night's minimum lands in the early hours of tomorrow,
  // so tomorrow's daily row carries the overnight low.
  const d = todayDaily();
  const tom = tomorrowDaily();
  const low = Math.round(numeric(tom?.templow ?? d?.templow) ?? NaN);
  const nightHours = S.hourly.filter(f => {
    const t = new Date(f.datetime);
    return t > now && t.getTime() < localMidnight(addDays(now, 1)).getTime() + 8 * 3600000;
  });
  const stormy = nightHours.some(f => STORMY.has(f.condition));
  const rainy = nightHours.some(f => RAINY.has(f.condition));
  const snowy = nightHours.some(f => SNOWY.has(f.condition));
  const cond = stormy ? L.nightStorms : snowy ? L.nightSnow : rainy ? L.nightRain
    : conditionWord(nightHours[0]?.condition ?? d?.condition);
  const main = Number.isFinite(low) ? L.overnightLow(cond, low) : cond;
  let sub = '';
  if (rainy || stormy) sub = L.windowsClose;
  else if (Number.isFinite(low) && low >= T(55) && low <= T(68)) sub = L.windowsOpen;
  else if (Number.isFinite(low) && low < T(45)) sub = L.coldNight;
  else if (Number.isFinite(low) && low > T(68)) sub = L.warmNight;
  return { main, sub, alert: stormy };
}

function tomorrowCard() {
  const tom = tomorrowDaily();
  if (!tom) return { main: '—', sub: '' };
  const lo = Math.round(numeric(tom.templow) ?? NaN);
  const hi = Math.round(numeric(tom.temperature) ?? NaN);
  const prob = Math.round(numeric(tom.precipitation_probability) ?? 0);
  const uv = numeric(tom.uv_index);
  const bits = [conditionWord(tom.condition).toLowerCase()];
  if (prob >= 20) bits.push(L.pctRain(prob));
  else if (uv !== null) bits.push(L.uv(Math.round(uv)));
  return {
    main: (Number.isFinite(lo) && Number.isFinite(hi)) ? `${lo}° → ${hi}°` : '—',
    sub: bits.join(' · '),
  };
}

// Things to do before bed — and only those. Tomorrow's agenda is printed
// directly above this box, so a line that merely restates the first event
// there earns nothing; it is left out even when the box ends up empty.
function eveningPrep() {
  const lines = [];
  // An open door at bedtime outranks everything else here.
  const shut = closure();
  if (shut?.open) lines.push(L.stillOpen(shut.names));
  if (binsLine()) lines.push(L.binsGoOut());
  const tom = tomorrowDaily();
  if ((numeric(tom?.precipitation_probability) ?? 0) >= CONFIG.rainProbThreshold) {
    lines.push(L.rainTomorrow());
  }
  return lines.length ? lines.slice(0, 2).join('\n') : null;
}

function nightCondition() {
  const now = Date.now();
  const horizon = now + 8 * 3600000;
  const hours = S.hourly.filter(f => {
    const t = new Date(f.datetime).getTime();
    return t >= now - 3600000 && t <= horizon;
  });
  let runType = null, runEnd = null;
  for (const f of hours) {
    const type = STORMY.has(f.condition) ? 'storms' : SNOWY.has(f.condition) ? 'snow' : RAINY.has(f.condition) ? 'rain' : null;
    if (type && !runType) runType = type;
    if (runType) {
      if (type) runEnd = new Date(new Date(f.datetime).getTime() + 3600000);
      else break;
    }
  }
  if (runType && runEnd) {
    const startSoon = hours[0] && (STORMY.has(hours[0].condition) || RAINY.has(hours[0].condition) || SNOWY.has(hours[0].condition));
    const verb = runType === 'storms' ? L.nightStorms : runType === 'snow' ? L.nightSnow : L.nightRain;
    return startSoon ? L.nightUntil(verb, fmtHourBare(zonedParts(runEnd).h)) : L.nightLater(verb);
  }
  const gust = numeric(ent(CONFIG.entities.weather)?.attributes?.wind_gust_speed);
  const gustLimit = WIND_UNIT === 'mph' ? 30 : WIND_UNIT === 'm/s' ? 13 : 48;
  if (gust !== null && gust >= gustLimit) return L.nightWindy(Math.round(gust));
  return null;
}

// Warnings that earn the band: anything named a Warning, or Severe/Extreme.
function warningWorthy(event, severity) {
  return /warning/i.test(event || '') || ['Severe', 'Extreme'].includes(severity);
}

function activeNwsAlerts() {
  const id = CONFIG.entities.nwsAlertEntity;
  if (!id) return S.nwsAlerts;
  const alerts = ent(id)?.attributes?.Alerts;
  if (!Array.isArray(alerts)) return [];
  return alerts
    .filter(a => (a.Status ?? 'Actual') === 'Actual' && warningWorthy(a.Event, a.Severity))
    .map(a => ({ event: a.Event, headline: a.Headline, ends: a.Ends || a.Expires, severity: a.Severity }));
}

// Radon meters report either pCi/L (US) or Bq/m³; thresholds are authored in
// pCi/L against the EPA action level, so normalize on the way in.
function radonPciL() {
  const e = ent(CONFIG.entities.radonSensor);
  const v = numeric(e?.state);
  if (v === null) return null;
  const unit = String(e.attributes?.unit_of_measurement || '').toLowerCase();
  return unit.includes('bq') ? v / 37 : v;
}

// Every alert currently active, most severe first. The band stacks them, so
// this returns all of them rather than winning a priority contest.
function alerts() {
  const out = [];

  // Life safety first.
  for (const id of CONFIG.entities.coSensors) {
    const e = ent(id);
    const ppm = numeric(e?.state);
    if (ppm === null || ppm < CONFIG.coAlertPpm) continue;
    const name = cleanName(e.attributes?.friendly_name || id);
    out.push({
      text: L.coAlert(name, Math.round(ppm)), tile: null,
      // Bucket the id so a drifting reading re-chimes on real escalation only.
      id: `co:${id}:${Math.round(ppm / 10)}`,
    });
  }

  for (const id of CONFIG.entities.leakSensors) {
    if (ent(id)?.state !== 'on') continue;
    const name = cleanName(ent(id).attributes?.friendly_name || id);
    out.push({ text: L.waterLeak(name), tile: null, id: `leak:${id}` });
  }

  for (const a of activeNwsAlerts()) {
    let text = a.event;
    if (a.ends) {
      const end = new Date(a.ends);
      const mer = HOUR12 ? (zonedParts(end).h >= 12 ? ' PM' : ' AM') : '';
      text = L.alertUntil(text, fmtClock(end) + mer);
    }
    const tile = /freeze|frost|cold|winter|heat/i.test(a.event) ? 'temperature' : null;
    out.push({ text, tile, id: `nws:${a.event}:${a.ends || ''}` });
  }

  const radon = radonPciL();
  if (radon !== null && radon >= CONFIG.radonAlertPciL) {
    out.push({
      text: L.radonAlert(radon.toFixed(1)), tile: null,
      id: `radon:${Math.round(radon)}`,
    });
  }

  const aqi = entNum(CONFIG.entities.outdoorAqi);
  if (aqi !== null && aqi >= CONFIG.aqiAlertThreshold) {
    const label = aqi >= 200 ? L.aqiVeryUnhealthy : aqi >= 150 ? L.aqiUnhealthy : L.aqiPoor;
    out.push({ text: L.aqiAlert(label, Math.round(aqi)), tile: 'aqi', id: `aqi:${Math.round(aqi / 25)}` });
  }

  return out;
}

// Doors and garage covers as one list. A cover mid-travel counts as open;
// unavailable counts as closed, because a dead radio is not evidence of a
// door standing open and a false alarm at bedtime is worse than a miss.
function openings() {
  const out = [];
  for (const id of CONFIG.entities.doorSensors) {
    const e = ent(id);
    if (!e || e.state === 'unavailable' || e.state === 'unknown') continue;
    out.push({ name: cleanName(e.attributes?.friendly_name || id), open: e.state === 'on' });
  }
  for (const id of CONFIG.entities.garageDoors) {
    const e = ent(id);
    if (!e || e.state === 'unavailable' || e.state === 'unknown') continue;
    out.push({ name: cleanName(e.attributes?.friendly_name || id), open: e.state !== 'closed' });
  }
  return out;
}

function closure() {
  const all = openings();
  if (!all.length) return null;
  const open = all.filter(o => o.open);
  if (!open.length) return { text: L.allClosed(), open: false, names: null };
  const names = listJoin(open.map(o => o.name));
  return { text: L.openList(names), open: true, names };
}

function commute() {
  const e = ent(CONFIG.entities.commuteSensor);
  const min = numeric(e?.state);
  if (min === null) return null;
  // Only when it is actually a commute: a workday, and someone home to leave.
  const wd = CONFIG.entities.workdaySensor;
  if (wd && ent(wd)?.state !== 'on') return null;
  const who = CONFIG.entities.commutePresence;
  if (who && ent(who)?.state !== 'home') return null;
  // Whatever icon the entity carries in HA travels with it, so the place a
  // sensor points at is labelled the way its owner already labelled it.
  const icon = String(e.attributes?.icon || '').replace(/^mdi:/, '') || null;
  return {
    text: L.commuteTo(Math.round(min), cleanName(e.attributes?.friendly_name || '')),
    route: e.attributes?.route || null,
    icon,
  };
}

function bird() {
  const e = ent(CONFIG.entities.birdnetSensor);
  if (!e) return null;
  const a = e.attributes || {};
  const when = new Date(e.state);
  if (!Number.isFinite(when.getTime()) || !a.CommonName) return null;
  // Yesterday's bird is not news; stop showing it once it goes stale.
  const ageH = (Date.now() - when.getTime()) / 3600000;
  if (ageH > CONFIG.birdMaxAgeHours || ageH < -1) return null;
  // Confidence arrives as a 0–1 fraction on the attribute, a percent elsewhere.
  const conf = numeric(a.Confidence);
  const mer = HOUR12 ? (zonedParts(when).h >= 12 ? ' PM' : ' AM') : '';
  return {
    name: a.CommonName,
    sci: a.ScientificName || null,
    when: fmtClock(when) + mer,
    source: a.sourceName ? cleanName(a.sourceName) : null,
    image: a.BirdImage?.URL || null,
    confidence: conf === null ? null : Math.round(conf <= 1 ? conf * 100 : conf),
  };
}

function buildViewmodel() {
  const sun = ent(CONFIG.entities.sun);
  const outdoorTemp = outdoorNow().temp;
  const indoorTemp = entNum(CONFIG.entities.indoorTemp);
  const rain = rainToday();
  const cd = countdown();

  const sunTimes = {};
  if (sun) {
    sunTimes.sunrise = fmtClock(new Date(sun.attributes.next_rising));
    sunTimes.sunset = fmtClock(new Date(sun.attributes.next_setting));
  }

  const powerTotal = entNum(CONFIG.entities.energyToday);
  const waterTotal = entNum(CONFIG.entities.waterToday);
  const powerUnit = ent(CONFIG.entities.energyToday)?.attributes?.unit_of_measurement || 'kWh';
  const waterUnit = ent(CONFIG.entities.waterToday)?.attributes?.unit_of_measurement || 'gal';

  const firstUpTomorrow = timedEvents(S.calTomorrow)[0];
  const birdCard = bird();
  const tomorrowName = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, weekday: 'long' })
    .format(addDays(new Date(), 1)).toUpperCase();

  return {
    generatedAt: new Date().toISOString(),
    tz: TZ,
    haOk: S.haOk,
    locale: LOCALE,
    hour12: HOUR12,
    strings: CLIENT_STRINGS,
    dayparts: CONFIG.dayparts,
    alerts: alerts(),
    maxAlerts: CONFIG.maxAlerts,
    rail: {
      sunrise: sunTimes.sunrise || null,
      sunset: sunTimes.sunset || null,
      tempIn: indoorTemp !== null ? Math.round(indoorTemp) : null,
      tempOut: outdoorTemp !== null ? Math.round(outdoorTemp) : null,
    },
    morning: {
      countdown: cd,
      agenda: agendaToday(cd.name),
      advice: adviceSentence(),
      temperature: {
        out: outdoorTemp !== null ? Math.round(outdoorTemp) : null,
        in: indoorTemp !== null ? Math.round(indoorTemp) : null,
      },
      aqi: {
        out: entNum(CONFIG.entities.outdoorAqi),
        in: entNum(CONFIG.entities.indoorAqi),
      },
      rain: { prob: rain.prob, peak: rain.peak },
      power: {
        total: powerTotal,
        unit: powerUnit,
        nowKw: S.powerNowKw,
        hours: S.powerHours,
      },
      bins: binsLine(),
      commute: commute(),
      bird: birdCard,
    },
    evening: {
      tomorrowName,
      agenda: agendaTomorrow(),
      prep: eveningPrep(),
      bird: birdCard,
      overnight: overnight(),
      tomorrow: tomorrowCard(),
      power: { total: powerTotal, unit: powerUnit, hours: S.powerHours },
      water: { total: waterTotal, unit: waterUnit, hours: S.waterHours },
      gas: S.gasToday,
    },
    night: {
      tempIn: indoorTemp !== null ? Math.round(indoorTemp) : null,
      tempOut: outdoorTemp !== null ? Math.round(outdoorTemp) : null,
      condition: nightCondition(),
      closure: closure(),
      bird: birdCard,
      firstUp: firstUpTomorrow
        ? `${L.firstUp} ${fmtClock(firstUpTomorrow.start)} · ${firstUpTomorrow.summary.toUpperCase()}`
        : null,
    },
  };
}

// ------------------------------------------------------------------ SSE hub

const clients = new Set();
let lastVmJson = '{}';

function broadcast() {
  try {
    lastVmJson = JSON.stringify(buildViewmodel());
  } catch (err) {
    console.error('viewmodel build failed:', err);
    return;
  }
  for (const res of clients) res.write(`data: ${lastVmJson}\n\n`);
}

// ------------------------------------------------------------------- server

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.woff2': 'font/woff2', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/api/stream') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`data: ${lastVmJson}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (u.pathname === '/api/viewmodel') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(lastVmJson);
    return;
  }
  let file = u.pathname === '/' ? '/index.html' : u.pathname;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, 'public', file);
  if (!full.startsWith(path.join(ROOT, 'public'))) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

// -------------------------------------------------------------------- loops

function loop(fn, ms, name) {
  const run = async () => {
    try {
      await fn();
      S.lastError = null;
    } catch (err) {
      S.lastError = `${name}: ${err.message}`;
      console.error(new Date().toISOString(), name, err.message);
    }
    broadcast();
  };
  run();
  setInterval(run, ms);
}

async function start() {
  try {
    const cfg = await ha('/api/config');
    TZ = cfg.time_zone || TZ;
    IS_METRIC = cfg.unit_system?.temperature === '°C';
    WIND_UNIT = cfg.unit_system?.wind_speed || 'mph';
    resolveLocale(cfg.language);
    if (cfg.latitude && cfg.longitude) {
      NWS_POINT = `${cfg.latitude.toFixed(4)},${cfg.longitude.toFixed(4)}`;
    }
    console.log(`HA ok — tz=${TZ} locale=${LOCALE} hour12=${HOUR12} metric=${IS_METRIC} point=${NWS_POINT}`);
  } catch (err) {
    console.error('Could not reach HA at startup:', err.message);
  }

  loop(pollStates, 20000, 'states');
  loop(pollCalendar, 5 * 60000, 'calendar');
  loop(pollBins, 5 * 60000, 'bins');
  loop(pollForecast, 15 * 60000, 'forecast');
  loop(pollHistory, 5 * 60000, 'history');
  loop(pollNws, 10 * 60000, 'nws');

  server.listen(CONFIG.port, () => {
    console.log(`Sideboard on http://0.0.0.0:${CONFIG.port}`);
  });
}

start();

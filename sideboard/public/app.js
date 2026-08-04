// Day Board frontend — renders the server viewmodel, keeps its own clock,
// and switches screens by time of day.

'use strict';

let vm = null;
let currentScreen = null;   // 'morning' | 'evening' | 'night'
let activeEl = document.getElementById('screenA');
let idleEl = document.getElementById('screenB');
let lastDataAt = 0;

const params = new URLSearchParams(location.search);
const FORCE_SCREEN = params.get('screen');
// ?alert=demo, or demo2/demo3/demo4 to stack that many.
const FORCE_ALERT = /^demo\d*$/.test(params.get('alert') || '') ? params.get('alert') : null;

// ------------------------------------------------------------ scale to fit

function viewportSize() {
  // Kiosk WebViews (Fully on Fire tablets especially) can disagree between
  // layout viewport, visual viewport, and window size. Trust the smallest
  // credible answer so the stage always fits what is actually visible.
  const candidates = [
    [document.documentElement.clientWidth, document.documentElement.clientHeight],
    [window.visualViewport?.width, window.visualViewport?.height],
    [innerWidth, innerHeight],
  ];
  let w = Infinity, h = Infinity;
  for (const [cw, ch] of candidates) {
    if (cw > 0) w = Math.min(w, cw);
    if (ch > 0) h = Math.min(h, ch);
  }
  return Number.isFinite(w) && Number.isFinite(h) ? { w, h } : { w: 1920, h: 1200 };
}

function fitStage() {
  const { w, h } = viewportSize();
  const s = Math.min(w / 1920, h / 1200);
  const stage = document.getElementById('stage');
  stage.style.transform =
    `translate(-50%, -50%) scale(${s}) translate(${burnShift.x}px, ${burnShift.y}px)`;
}
let burnShift = { x: 0, y: 0 };
addEventListener('resize', fitStage);
addEventListener('orientationchange', fitStage);
window.visualViewport?.addEventListener('resize', fitStage);

function updateBurnShift() {
  const h = new Date().getHours();
  const seq = [[0, 0], [3, 1], [0, 3], [-3, 1]];
  [burnShift.x, burnShift.y] = seq[h % 4];
  fitStage();
}

// ---------------------------------------------------------------- helpers

const esc = s => String(s ?? '').replace(/[&<>"]/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function now() { return new Date(); }

// Server-provided strings with English fallbacks for first paint.
const FALLBACK = {
  thenToday: 'THEN TODAY', takeWithYou: 'TAKE WITH YOU', tomorrow: 'TOMORROW',
  overnight: 'OVERNIGHT', powerToday: 'POWER TODAY', waterToday: 'WATER TODAY',
  gasToday: 'GAS TODAY',
  rainToday: 'RAIN TODAY', temperature: 'TEMPERATURE', airQuality: 'AIR QUALITY',
  outside: 'outside', inside: 'inside', sunrise: 'SUNRISE', sunset: 'SUNSET',
  railIn: 'IN', railOut: 'OUT', allDay: 'ALL DAY', now: 'NOW', today: 'TODAY',
  insideWord: 'INSIDE', outsideWord: 'OUTSIDE',
  nothingElse: 'Nothing else today', nothingScheduled: 'Nothing scheduled',
  chanceOfRain: 'chance of rain', peaks: 'peaks',
  inMinTpl: 'in {m} min', inHmTpl: 'in {h} h {m} min', dataOldTpl: 'data {m} min old',
  moreAlertsTpl: '+{n} more', latestBird: 'LATEST BIRD', beforeBed: 'BEFORE BED',
};
function S(key) { return vm?.strings?.[key] ?? FALLBACK[key] ?? key; }
function hour12() { return vm?.hour12 ?? true; }
function locale() { return vm?.locale ?? 'en-US'; }

function fmtTime(d, withMeridiem) {
  let h = d.getHours();
  const m = String(d.getMinutes()).padStart(2, '0');
  if (!hour12()) return `${h}:${m}`;
  const mer = h < 12 ? 'AM' : 'PM';
  h = h % 12; if (h === 0) h = 12;
  return withMeridiem ? `${h}:${m} ${mer}` : `${h}:${m}`;
}

function fmtDateLine(d) {
  return new Intl.DateTimeFormat(locale(), {
    weekday: 'long', day: 'numeric', month: 'long',
  }).format(d).replace(/,/g, '').toUpperCase();
}

function minsUntil(iso) {
  return Math.round((new Date(iso).getTime() - Date.now()) / 60000);
}

function tpl(key, vars) {
  let s = S(key);
  for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

function hhmmToMin(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function daypart() {
  if (FORCE_SCREEN) return FORCE_SCREEN;
  const dp = vm?.dayparts || {
    morningStart: '05:30', morningEnd: '09:30',
    eveningStart: '16:30', eveningEnd: '22:30', dayShows: 'evening',
  };
  const d = now();
  const t = d.getHours() * 60 + d.getMinutes();
  if (t >= hhmmToMin(dp.morningStart) && t < hhmmToMin(dp.morningEnd)) return 'morning';
  if (t >= hhmmToMin(dp.eveningStart) && t < hhmmToMin(dp.eveningEnd)) return 'evening';
  if (t >= hhmmToMin(dp.morningEnd) && t < hhmmToMin(dp.eveningStart)) return dp.dayShows;
  return 'night';
}

const DEMO_ALERTS = [
  { text: 'Carbon monoxide — Emmie Air Quality 42 ppm', tile: null, id: 'demo1' },
  { text: 'Water leak — Basement Sensor', tile: null, id: 'demo2' },
  { text: 'Severe Thunderstorm Warning until 9:15 PM', tile: 'temperature', id: 'demo3' },
  { text: 'Air quality poor — AQI 156, wildfire smoke', tile: 'aqi', id: 'demo4' },
];

// ?alert=demo shows one; ?alert=demo3 / demo4 stack that many, so the band's
// effect on the layout can be checked without waiting for a bad day.
function activeAlerts() {
  if (FORCE_ALERT) {
    const n = Number(FORCE_ALERT.replace(/\D/g, '')) || 1;
    return DEMO_ALERTS.slice(0, Math.min(n, DEMO_ALERTS.length));
  }
  return vm?.alerts || [];
}

// ------------------------------------------------------------------- icons

// Material Design Icons path data (MDI v7.4.47, Apache-2.0), inlined so the
// kiosk needs no icon font and no network. Whatever mdi: name an entity
// carries in Home Assistant is looked up here; anything unlisted falls back to
// a map pin, so an unknown icon degrades instead of disappearing.
const MDI = {
  'briefcase': 'M10,2H14A2,2 0 0,1 16,4V6H20A2,2 0 0,1 22,8V19A2,2 0 0,1 20,21H4C2.89,21 2,20.1 2,19V8C2,6.89 2.89,6 4,6H8V4C8,2.89 8.89,2 10,2M14,6V4H10V6H14Z',
  'briefcase-outline': 'M20,6C20.58,6 21.05,6.2 21.42,6.59C21.8,7 22,7.45 22,8V19C22,19.55 21.8,20 21.42,20.41C21.05,20.8 20.58,21 20,21H4C3.42,21 2.95,20.8 2.58,20.41C2.2,20 2,19.55 2,19V8C2,7.45 2.2,7 2.58,6.59C2.95,6.2 3.42,6 4,6H8V4C8,3.42 8.2,2.95 8.58,2.58C8.95,2.2 9.42,2 10,2H14C14.58,2 15.05,2.2 15.42,2.58C15.8,2.95 16,3.42 16,4V6H20M4,8V19H20V8H4M14,6V4H10V6H14Z',
  'office-building': 'M5,3V21H11V17.5H13V21H19V3H5M7,5H9V7H7V5M11,5H13V7H11V5M15,5H17V7H15V5M7,9H9V11H7V9M11,9H13V11H11V9M15,9H17V11H15V9M7,13H9V15H7V13M11,13H13V15H11V13M15,13H17V15H15V13M7,17H9V19H7V17M15,17H17V19H15V17Z',
  'home': 'M10,20V14H14V20H19V12H22L12,3L2,12H5V20H10Z',
  'home-outline': 'M12 5.69L17 10.19V18H15V12H9V18H7V10.19L12 5.69M12 3L2 12H5V20H11V14H13V20H19V12H22',
  'school': 'M12,3L1,9L12,15L21,10.09V17H23V9M5,13.18V17.18L12,21L19,17.18V13.18L12,17L5,13.18Z',
  'ski': 'M17.92 13.32C17.67 13.28 16.71 13 16.46 12.89L14.39 19.37L11.3 18.24L13.5 12.47L10.45 9L13 7.54C13.45 8.67 14.17 9.62 15.12 10.4S17.16 11.67 18.38 11.86L19.5 8.43L18.06 7.96L17.54 9.56C16.88 9.28 16.3 8.86 15.8 8.32C15.3 7.77 14.94 7.13 14.72 6.41L14.39 5.33C14.27 4.93 14.04 4.61 13.71 4.37C13.38 4.14 13 4 12.63 3.97C12.24 3.94 11.86 4 11.5 4.21L8 6.23C7.63 6.44 7.36 6.74 7.19 7.12C7 7.5 6.96 7.88 7 8.29S7.26 9.06 7.54 9.37L11.11 13.08L9.42 17.54L2.47 15.05L2 16.46L16.04 21.58C16.82 21.86 17.65 22 18.53 22C19.15 22 19.76 21.92 20.36 21.77C20.95 21.61 21.5 21.39 22 21.11L20.87 20C20.12 20.33 19.34 20.5 18.53 20.5C17.87 20.5 17.21 20.39 16.55 20.17L15.8 19.89L17.92 13.32M19 3C19 4.11 18.11 5 17 5S15 4.11 15 3 15.9 1 17 1 19 1.9 19 3Z',
  'snowboard': 'M21.87 20.37C21.76 20.2 21.62 20.09 21.43 20.06C21.18 20 20.96 20.05 20.78 20.2C20.43 20.5 20.04 20.73 19.58 20.86C19.13 21 18.66 21 18.16 20.9L17.04 20.62L16 14.46L12.74 11.79L14.5 8.94C15.08 9.85 15.85 10.58 16.83 11.14C17.81 11.7 18.88 12 20.03 12V9.97C19.09 9.97 18.26 9.72 17.53 9.22S16.26 8.07 15.92 7.26L15.36 6.05C15.26 5.86 15.08 5.64 14.82 5.39C14.55 5.14 14.19 5 13.72 5H8.07L5.54 9L7.27 10.06L9.14 7H11.5L9 10.95C8.69 11.42 8.6 11.93 8.72 12.5L9.56 15.95L6.06 18.29L5.59 18.19C5.13 18.1 4.7 17.91 4.33 17.61C3.96 17.31 3.68 16.96 3.5 16.56C3.4 16.31 3.23 16.17 3 16.14C2.76 16.08 2.56 16.11 2.39 16.23S2.12 16.5 2.09 16.7C2.06 16.85 2.07 17 2.13 17.17C2.42 17.79 2.83 18.33 3.37 18.78C3.92 19.23 4.55 19.5 5.27 19.64L17.88 22.35C18.6 22.5 19.29 22.5 19.96 22.3C20.63 22.12 21.23 21.79 21.76 21.32C21.88 21.23 21.96 21.11 22 20.95C22 20.73 22 20.54 21.87 20.37M8.77 18.89L11.81 16.89L11.34 13.57L14.19 15.58L14.94 20.2L8.77 18.89M18 3C18 4.11 17.11 5 16 5S14 4.11 14 3 14.9 1 16 1 18 1.9 18 3Z',
  'car': 'M5,11L6.5,6.5H17.5L19,11M17.5,16A1.5,1.5 0 0,1 16,14.5A1.5,1.5 0 0,1 17.5,13A1.5,1.5 0 0,1 19,14.5A1.5,1.5 0 0,1 17.5,16M6.5,16A1.5,1.5 0 0,1 5,14.5A1.5,1.5 0 0,1 6.5,13A1.5,1.5 0 0,1 8,14.5A1.5,1.5 0 0,1 6.5,16M18.92,6C18.72,5.42 18.16,5 17.5,5H6.5C5.84,5 5.28,5.42 5.08,6L3,12V20A1,1 0 0,0 4,21H5A1,1 0 0,0 6,20V19H18V20A1,1 0 0,0 19,21H20A1,1 0 0,0 21,20V12L18.92,6Z',
  'car-outline': 'M18.9 6C18.7 5.4 18.1 5 17.5 5H6.5C5.8 5 5.3 5.4 5.1 6L3 12V20C3 20.5 3.5 21 4 21H5C5.6 21 6 20.5 6 20V19H18V20C18 20.5 18.5 21 19 21H20C20.5 21 21 20.5 21 20V12L18.9 6M6.8 7H17.1L18.2 10H5.8L6.8 7M19 17H5V12H19V17M7.5 13C8.3 13 9 13.7 9 14.5S8.3 16 7.5 16 6 15.3 6 14.5 6.7 13 7.5 13M16.5 13C17.3 13 18 13.7 18 14.5S17.3 16 16.5 16C15.7 16 15 15.3 15 14.5S15.7 13 16.5 13Z',
  'map-marker': 'M12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5M12,2A7,7 0 0,0 5,9C5,14.25 12,22 12,22C12,22 19,14.25 19,9A7,7 0 0,0 12,2Z',
  'map-marker-outline': 'M12,6.5A2.5,2.5 0 0,1 14.5,9A2.5,2.5 0 0,1 12,11.5A2.5,2.5 0 0,1 9.5,9A2.5,2.5 0 0,1 12,6.5M12,2A7,7 0 0,1 19,9C19,14.25 12,22 12,22C12,22 5,14.25 5,9A7,7 0 0,1 12,2M12,4A5,5 0 0,0 7,9C7,10 7,12 12,18.71C17,12 17,10 17,9A5,5 0 0,0 12,4Z',
  'airplane': 'M20.56 3.91C21.15 4.5 21.15 5.45 20.56 6.03L16.67 9.92L18.79 19.11L17.38 20.53L13.5 13.1L9.6 17L9.96 19.47L8.89 20.53L7.13 17.35L3.94 15.58L5 14.5L7.5 14.87L11.37 11L3.94 7.09L5.36 5.68L14.55 7.8L18.44 3.91C19 3.33 20 3.33 20.56 3.91Z',
  'train': 'M12,2C8,2 4,2.5 4,6V15.5A3.5,3.5 0 0,0 7.5,19L6,20.5V21H8.23L10.23,19H14L16,21H18V20.5L16.5,19A3.5,3.5 0 0,0 20,15.5V6C20,2.5 16.42,2 12,2M7.5,17A1.5,1.5 0 0,1 6,15.5A1.5,1.5 0 0,1 7.5,14A1.5,1.5 0 0,1 9,15.5A1.5,1.5 0 0,1 7.5,17M11,10H6V6H11V10M13,10V6H18V10H13M16.5,17A1.5,1.5 0 0,1 15,15.5A1.5,1.5 0 0,1 16.5,14A1.5,1.5 0 0,1 18,15.5A1.5,1.5 0 0,1 16.5,17Z',
  'bus': 'M18,11H6V6H18M16.5,17A1.5,1.5 0 0,1 15,15.5A1.5,1.5 0 0,1 16.5,14A1.5,1.5 0 0,1 18,15.5A1.5,1.5 0 0,1 16.5,17M7.5,17A1.5,1.5 0 0,1 6,15.5A1.5,1.5 0 0,1 7.5,14A1.5,1.5 0 0,1 9,15.5A1.5,1.5 0 0,1 7.5,17M4,16C4,16.88 4.39,17.67 5,18.22V20A1,1 0 0,0 6,21H7A1,1 0 0,0 8,20V19H16V20A1,1 0 0,0 17,21H18A1,1 0 0,0 19,20V18.22C19.61,17.67 20,16.88 20,16V6C20,2.5 16.42,2 12,2C7.58,2 4,2.5 4,6V16Z',
  'bike': 'M5,20.5A3.5,3.5 0 0,1 1.5,17A3.5,3.5 0 0,1 5,13.5A3.5,3.5 0 0,1 8.5,17A3.5,3.5 0 0,1 5,20.5M5,12A5,5 0 0,0 0,17A5,5 0 0,0 5,22A5,5 0 0,0 10,17A5,5 0 0,0 5,12M14.8,10H19V8.2H15.8L13.86,4.93C13.57,4.43 13,4.1 12.4,4.1C11.93,4.1 11.5,4.29 11.2,4.6L7.5,8.29C7.19,8.6 7,9 7,9.5C7,10.13 7.33,10.66 7.85,10.97L11.2,13V18H13V11.5L10.75,9.85L13.07,7.5M19,20.5A3.5,3.5 0 0,1 15.5,17A3.5,3.5 0 0,1 19,13.5A3.5,3.5 0 0,1 22.5,17A3.5,3.5 0 0,1 19,20.5M19,12A5,5 0 0,0 14,17A5,5 0 0,0 19,22A5,5 0 0,0 24,17A5,5 0 0,0 19,12M16,4.8C17,4.8 17.8,4 17.8,3C17.8,2 17,1.2 16,1.2C15,1.2 14.2,2 14.2,3C14.2,4 15,4.8 16,4.8Z',
  'walk': 'M14.12,10H19V8.2H15.38L13.38,4.87C13.08,4.37 12.54,4.03 11.92,4.03C11.74,4.03 11.58,4.06 11.42,4.11L6,5.8V11H7.8V7.33L9.91,6.67L6,22H7.8L10.67,13.89L13,17V22H14.8V15.59L12.31,11.05L13.04,8.18M14,3.8C15,3.8 15.8,3 15.8,2C15.8,1 15,0.2 14,0.2C13,0.2 12.2,1 12.2,2C12.2,3 13,3.8 14,3.8Z',
  'hospital-building': 'M2,22V7A1,1 0 0,1 3,6H7V2H17V6H21A1,1 0 0,1 22,7V22H14V17H10V22H2M9,4V10H11V8H13V10H15V4H13V6H11V4H9M4,20H8V17H4V20M4,15H8V12H4V15M16,20H20V17H16V20M16,15H20V12H16V15M10,15H14V12H10V15Z',
  'store': 'M12,18H6V14H12M21,14V12L20,7H4L3,12V14H4V20H14V14H18V20H20V14M20,4H4V6H20V4Z',
  'cart': 'M17,18C15.89,18 15,18.89 15,20A2,2 0 0,0 17,22A2,2 0 0,0 19,20C19,18.89 18.1,18 17,18M1,2V4H3L6.6,11.59L5.24,14.04C5.09,14.32 5,14.65 5,15A2,2 0 0,0 7,17H19V15H7.42A0.25,0.25 0 0,1 7.17,14.75C7.17,14.7 7.18,14.66 7.2,14.63L8.1,13H15.55C16.3,13 16.96,12.58 17.3,11.97L20.88,5.5C20.95,5.34 21,5.17 21,5A1,1 0 0,0 20,4H5.21L4.27,2M7,18C5.89,18 5,18.89 5,20A2,2 0 0,0 7,22A2,2 0 0,0 9,20C9,18.89 8.1,18 7,18Z',
  'dumbbell': 'M20.57,14.86L22,13.43L20.57,12L17,15.57L8.43,7L12,3.43L10.57,2L9.14,3.43L7.71,2L5.57,4.14L4.14,2.71L2.71,4.14L4.14,5.57L2,7.71L3.43,9.14L2,10.57L3.43,12L7,8.43L15.57,17L12,20.57L13.43,22L14.86,20.57L16.29,22L18.43,19.86L19.86,21.29L21.29,19.86L19.86,18.43L22,16.29L20.57,14.86Z',
  'coffee': 'M2,21H20V19H2M20,8H18V5H20M20,3H4V13A4,4 0 0,0 8,17H14A4,4 0 0,0 18,13V10H20A2,2 0 0,0 22,8V5C22,3.89 21.1,3 20,3Z',
  'silverware-fork-knife': 'M11,9H9V2H7V9H5V2H3V9C3,11.12 4.66,12.84 6.75,12.97V22H9.25V12.97C11.34,12.84 13,11.12 13,9V2H11V9M16,6V14H18.5V22H21V2C18.24,2 16,4.24 16,6Z',
  'church': 'M18 12.22V9L13 6.5V5H15V3H13V1H11V3H9V5H11V6.5L6 9V12.22L2 14V22H10V19C10 17.9 10.9 17 12 17S14 17.9 14 19V22H22V14L18 12.22M12 13.5C11.17 13.5 10.5 12.83 10.5 12S11.17 10.5 12 10.5 13.5 11.17 13.5 12 12.83 13.5 12 13.5Z',
  'gas-station': 'M18,10A1,1 0 0,1 17,9A1,1 0 0,1 18,8A1,1 0 0,1 19,9A1,1 0 0,1 18,10M12,10H6V5H12M19.77,7.23L19.78,7.22L16.06,3.5L15,4.56L17.11,6.67C16.17,7 15.5,7.93 15.5,9A2.5,2.5 0 0,0 18,11.5C18.36,11.5 18.69,11.42 19,11.29V18.5A1,1 0 0,1 18,19.5A1,1 0 0,1 17,18.5V14C17,12.89 16.1,12 15,12H14V5C14,3.89 13.1,3 12,3H6C4.89,3 4,3.89 4,5V21H14V13.5H15.5V18.5A2.5,2.5 0 0,0 18,21A2.5,2.5 0 0,0 20.5,18.5V9C20.5,8.31 20.22,7.68 19.77,7.23Z',
  'swim': 'M2,18C4.22,17 6.44,16 8.67,16C10.89,16 13.11,18 15.33,18C17.56,18 19.78,16 22,16V19C19.78,19 17.56,21 15.33,21C13.11,21 10.89,19 8.67,19C6.44,19 4.22,20 2,21V18M8.67,13C7.89,13 7.12,13.12 6.35,13.32L11.27,9.88L10.23,8.64C10.09,8.47 10,8.24 10,8C10,7.66 10.17,7.35 10.44,7.17L16.16,3.17L17.31,4.8L12.47,8.19L17.7,14.42C16.91,14.75 16.12,15 15.33,15C13.11,15 10.89,13 8.67,13M18,7A2,2 0 0,1 20,9A2,2 0 0,1 18,11A2,2 0 0,1 16,9A2,2 0 0,1 18,7Z',
  'golf': 'M19.5,18A1.5,1.5 0 0,1 21,19.5A1.5,1.5 0 0,1 19.5,21A1.5,1.5 0 0,1 18,19.5A1.5,1.5 0 0,1 19.5,18M17,5.92L11,9V18.03C13.84,18.19 16,19 16,20C16,21.1 13.31,22 10,22C6.69,22 4,21.1 4,20C4,19.26 5.21,18.62 7,18.27V20H9V2L17,5.92Z',
  'bank': 'M11.5,1L2,6V8H21V6M16,10V17H19V10M2,22H21V19H2M10,10V17H13V10M4,10V17H7V10H4Z',
  'library': 'M12,8A3,3 0 0,0 15,5A3,3 0 0,0 12,2A3,3 0 0,0 9,5A3,3 0 0,0 12,8M12,11.54C9.64,9.35 6.5,8 3,8V19C6.5,19 9.64,20.35 12,22.54C14.36,20.35 17.5,19 21,19V8C17.5,8 14.36,9.35 12,11.54Z',
  'baby-carriage': 'M13,2V10H21A8,8 0 0,0 13,2M19.32,15.89C20.37,14.54 21,12.84 21,11H6.44L5.5,9H2V11H4.22C4.22,11 6.11,15.07 6.34,15.42C5.24,16 4.5,17.17 4.5,18.5A3.5,3.5 0 0,0 8,22C9.76,22 11.22,20.7 11.46,19H13.54C13.78,20.7 15.24,22 17,22A3.5,3.5 0 0,0 20.5,18.5C20.5,17.46 20.04,16.53 19.32,15.89M8,20A1.5,1.5 0 0,1 6.5,18.5A1.5,1.5 0 0,1 8,17A1.5,1.5 0 0,1 9.5,18.5A1.5,1.5 0 0,1 8,20M17,20A1.5,1.5 0 0,1 15.5,18.5A1.5,1.5 0 0,1 17,17A1.5,1.5 0 0,1 18.5,18.5A1.5,1.5 0 0,1 17,20Z',
  'medical-bag': 'M10,3L8,5V7H5C3.85,7 3.12,8 3,9L2,19C1.88,20 2.54,21 4,21H20C21.46,21 22.12,20 22,19L21,9C20.88,8 20.06,7 19,7H16V5L14,3H10M10,5H14V7H10V5M11,10H13V13H16V15H13V18H11V15H8V13H11V10Z',
  'clock-outline': 'M12,20A8,8 0 0,0 20,12A8,8 0 0,0 12,4A8,8 0 0,0 4,12A8,8 0 0,0 12,20M12,2A10,10 0 0,1 22,12A10,10 0 0,1 12,22C6.47,22 2,17.5 2,12A10,10 0 0,1 12,2M12.5,7V12.25L17,14.92L16.25,16.15L11,13V7H12.5Z',
};

function iconHtml(name, cls) {
  const d = MDI[String(name || '').replace(/^mdi:/, '')] || MDI['map-marker'];
  return `<svg class="icon ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
}

// ------------------------------------------------------------ alert chime

// One chime per alert that is genuinely new. Rotating or re-rendering the same
// set stays silent; an alert clearing and returning later chimes again.
let chimedIds = new Set(JSON.parse(localStorage.getItem('chimedAlertIds') || '[]'));

function maybeChime(list) {
  const ids = list.map(a => a.id);
  if (!ids.length) {
    if (chimedIds.size) { chimedIds = new Set(); localStorage.removeItem('chimedAlertIds'); }
    return;
  }
  const fresh = ids.some(id => !chimedIds.has(id));
  chimedIds = new Set(ids);
  localStorage.setItem('chimedAlertIds', JSON.stringify(ids));
  if (fresh) playChime();
}

function playChime() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const master = ctx.createGain();
    master.gain.value = 0.22;
    master.connect(ctx.destination);
    // Two warm notes, a soft major third — polite, not alarming.
    const notes = [[523.25, 0], [659.25, 0.28]];
    for (const [freq, at] of notes) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0, ctx.currentTime + at);
      g.gain.linearRampToValueAtTime(1, ctx.currentTime + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + at + 1.1);
      o.connect(g); g.connect(master);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 1.2);
    }
    setTimeout(() => ctx.close(), 2000);
  } catch { /* audio unavailable — fine */ }
}

// ------------------------------------------------------------- bar charts

function barsHtml(hours, cls, upToHour) {
  const vals = (hours || []).slice(0, upToHour + 1).map(v => v ?? 0);
  const max = Math.max(...vals, 0.001);
  return `<div class="bars ${cls}">` + vals.map((v, i) => {
    const pct = Math.max(6, Math.round((v / max) * 100));
    const nowCls = i === upToHour ? ' now' : '';
    return `<div class="b${nowCls}" style="height:${pct}%"></div>`;
  }).join('') + '</div>';
}

// --------------------------------------------------------------- renderers

function railHtml(right) {
  return `<div class="rail"><div class="left">${fmtDateLine(now())}</div>
    <div class="right">${right}</div></div>`;
}

// The band stacks one row per alert. It is capped so a truly bad day cannot
// push the screen's own content off the stage; the overflow becomes a count.
function alertBandHtml(list) {
  if (!list.length) return '';
  const max = vm?.maxAlerts || 3;
  const shown = list.slice(0, max);
  const more = list.length - shown.length;
  const rows = shown.map(a => `<div class="alert-row">${esc(a.text)}</div>`).join('');
  const extra = more > 0 ? `<div class="alert-row more">${esc(tpl('moreAlertsTpl', { n: more }))}</div>` : '';
  return `<div class="alert-band rows-${shown.length + (more > 0 ? 1 : 0)}">${rows}${extra}</div>`;
}

// Each band row steals height from the body below it. The compact tier that
// matches the row count pays for that out of type size, rather than letting
// cards collide — the stage is a fixed 1920×1200 with nowhere to scroll.
function screenClass(list, base = 'screen') {
  const rows = Math.min(list.length, (vm?.maxAlerts || 3) + 1);
  return rows ? `${base} compact compact-${rows}` : base;
}

// Two shapes for the same card. Night stacks it under a heading, so the label
// sits above the photo; morning reads right-to-left along the footer, so the
// whole text block leads and the photo closes the line.
function birdHtml(b, cls) {
  if (!b) return '';
  const img = b.image
    ? `<img class="bird-img" src="${esc(b.image)}" alt="" onerror="this.remove()">`
    : '';
  const label = `<div class="bird-label">${S('latestBird')}</div>`;
  const meta = [b.when, b.source].filter(Boolean).join(' · ');
  const body = `<div class="bird-name">${esc(b.name)}</div>
    <div class="bird-meta">${esc(meta)}</div>`;
  if (cls === 'night') {
    return `<div class="bird night">${label}${img}<div class="bird-text">${body}</div></div>`;
  }
  return `<div class="bird ${cls}">
    <div class="bird-text">${label}${body}</div>${img}</div>`;
}

function renderMorning(el) {
  const m = vm?.morning || {};
  const alertList = activeAlerts();
  const cd = m.countdown || { label: S('today'), clock: '—', name: '' };
  const mins = cd.leaveISO ? minsUntil(cd.leaveISO) : null;
  const inTxt = mins !== null && mins >= 0
    ? (mins >= 90
      ? tpl('inHmTpl', { h: Math.floor(mins / 60), m: mins % 60 })
      : tpl('inMinTpl', { m: mins }))
    : '';
  const sun = vm?.rail || {};
  const right = `${fmtTime(now(), true)}${sun.sunrise ? ` &nbsp;·&nbsp; ${S('sunrise')} ${sun.sunrise}` : ''}${sun.sunset ? ` &nbsp;·&nbsp; ${S('sunset')} ${sun.sunset}` : ''}`;

  const agenda = (m.agenda || []).map(r => `
    <div class="agenda-row">
      <div class="t num ${r.time === 'all day' ? 'allday' : ''}">${esc(r.time === 'all day' ? S('allDay') : r.time)}</div>
      <div class="n">${esc(r.name)}</div>
    </div>`).join('');

  const t = m.temperature || {};
  const aqi = m.aqi || {};
  const alerting = tile => alertList.some(a => a.tile === tile) ? ' alerting' : '';
  const aqiAlerting = alerting('aqi');
  const tempAlerting = alerting('temperature');
  const rain = m.rain || {};
  const p = m.power || {};
  const hourNow = now().getHours();
  const nowKw = p.nowKw != null ? `${S('now')} ${p.nowKw.toFixed(1)} KW` : '';
  // Bottom strip: one "on your way out" line on the left, the bird on the
  // right. Bins outranks the commute there — it is the line you cannot recover
  // from if you miss it.
  const footLeft = m.bins
    ? `<div class="dot"></div><div>${esc(m.bins)}</div>`
    : m.commute
      ? `<div class="m-commute">${iconHtml(m.commute.icon)}<span class="m-commute-text">${esc(m.commute.text)}${m.commute.route ? ` <span class="route">${esc(m.commute.route)}</span>` : ''}</span></div>`
      : '';

  el.className = screenClass(alertList);
  el.innerHTML = `
    ${railHtml(right)}
    ${alertBandHtml(alertList)}
    <div class="m-body">
      <div class="m-countdown">
        <div class="sec-label">${esc(cd.label)}</div>
        <div class="clock num">${esc(cd.clock)}</div>
        <div class="sub"><div class="who">${esc(cd.name)}</div><div class="in">${inTxt}</div></div>
      </div>
      <div class="card m-agenda">
        <div class="sec-label">${S('thenToday')}</div>
        <div class="rows">${agenda || `<div class="agenda-row"><div class="n" style="color:var(--label)">${S('nothingElse')}</div></div>`}</div>
      </div>
      <div class="m-advice">
        <div class="sec-label">${S('takeWithYou')}</div>
        <div class="text">${esc(m.advice || '')}</div>
      </div>
      <div class="m-stats">
        <div class="tile${tempAlerting}">
          <div class="cap" style="margin-bottom:auto">${S('temperature')}</div>
          <div class="pair">
            <div class="stack"><div class="v num">${t.out ?? '—'}°</div><div class="cap">${S('outside')}</div></div>
            <div class="stack"><div class="v num dim">${t.in ?? '—'}°</div><div class="cap">${S('inside')}</div></div>
          </div>
        </div>
        <div class="tile${aqiAlerting}">
          <div class="cap" style="margin-bottom:auto">${S('airQuality')}</div>
          <div class="pair">
            <div class="stack"><div class="v num">${aqi.out != null ? Math.round(aqi.out) : '—'}</div><div class="cap">${S('outside')}</div></div>
            <div class="stack"><div class="v num dim">${aqi.in != null ? Math.round(aqi.in) : '—'}</div><div class="cap">${S('inside')}</div></div>
          </div>
        </div>
        <div class="tile">
          <div class="cap" style="margin-bottom:auto">${S('rainToday')}</div>
          <div class="stack"><div class="v num">${rain.prob != null ? rain.prob + '%' : '—'}</div>
          <div class="cap">${rain.peak ? S('peaks') + ' ' + esc(rain.peak) : S('chanceOfRain')}</div></div>
        </div>
        <div class="tile power">
          <div class="head">
            <div class="cap">${S('powerToday').replace(' ', '<br>')}</div>
            <div class="total num">${fmtTotal(p.total)}<small>${esc(p.unit || 'kWh')}</small></div>
          </div>
          ${barsHtml(p.hours, '', hourNow)}
          <div class="axis"><span>${fmtHourShort(0)}</span><span>${nowKw}</span></div>
        </div>
      </div>
    </div>
    <div class="m-footer${footLeft || m.bird ? '' : ' empty'}">
      <div class="m-foot-left">${footLeft}</div>
      <div class="m-foot-right">${m.bird ? birdHtml(m.bird, 'small') : ''}</div>
    </div>`;
}

function renderEvening(el) {
  const e = vm?.evening || {};
  const alertList = activeAlerts();
  const rail = vm?.rail || {};
  const right = `${fmtTime(now(), true)}${rail.tempIn != null ? ` &nbsp;·&nbsp; ${rail.tempIn}° ${S('railIn')}` : ''}${rail.tempOut != null ? ` &nbsp;·&nbsp; ${rail.tempOut}° ${S('railOut')}` : ''}`;

  const agenda = (e.agenda || []).map(r => `
    <div class="agenda-row">
      <div class="t num ${r.time === 'all day' ? 'allday' : ''}">${esc(r.time === 'all day' ? S('allDay') : r.time)}</div>
      <div class="n">${esc(r.name)}</div>
    </div>`).join('');

  const on = e.overnight || {};
  const tc = e.tomorrow || {};
  const hourNow = now().getHours();
  const onAlerting = (alertList.length && on.alert) ? ' alerting' : '';

  el.className = screenClass(alertList);
  el.innerHTML = `
    ${railHtml(right)}
    ${alertBandHtml(alertList)}
    <div class="e-body">
      <div class="e-left">
        <div class="sec-label">${S('tomorrow')} — ${esc(e.tomorrowName || '')}</div>
        <div class="rows">${agenda || `<div class="agenda-row"><div class="n" style="color:var(--label)">${S('nothingScheduled')}</div></div>`}</div>
        ${e.prep
          ? `<div class="e-prep">
              <div class="sec-label">${S('beforeBed')}</div>
              <div class="prep-text">${esc(e.prep)}</div>
            </div>`
          : e.bird
            ? `<div class="e-prep bird-card">${birdHtml(e.bird, 'evening')}</div>`
            : ''}
      </div>
      <div class="e-right">
        <div class="card e-card${onAlerting}">
          <div class="sec-label">${S('overnight')}</div>
          <div class="big">${esc(on.main || '—')}</div>
          ${on.sub ? `<div class="sub">${esc(on.sub)}</div>` : ''}
        </div>
        <div class="card e-card">
          <div class="sec-label">${S('tomorrow')}</div>
          <div class="big">${esc(tc.main || '—')}</div>
          ${tc.sub ? `<div class="sub">${esc(tc.sub)}</div>` : ''}
        </div>
        <div class="card e-usage">
          <div class="chart">
            <div class="head"><div class="sec-label">${S('powerToday')}</div>
              <div class="total num">${fmtTotal(e.power?.total)}<small>${esc(e.power?.unit || 'kWh')}</small></div></div>
            ${barsHtml(e.power?.hours, '', hourNow)}
          </div>
          <div class="chart">
            <div class="head"><div class="sec-label">${S('waterToday')}</div>
              <div class="total num">${fmtTotal(e.water?.total)}<small>${esc(e.water?.unit || 'gal')}</small></div></div>
            ${barsHtml(e.water?.hours, 'water', hourNow)}
            <div class="axis"><span>${fmtHourShort(0)}</span><span>${fmtHourShort(hourNow)}</span></div>
          </div>
          ${e.gas != null ? `
          <div class="chart gas">
            <div class="head"><div class="sec-label">${S('gasToday')}</div>
              <div class="total num">${fmtTotal(e.gas.value)}<small>${esc(e.gas.unit)}</small></div></div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
}

// One display rule for meter totals in any unit: whole numbers when large,
// one decimal when small.
function fmtTotal(v) {
  if (v == null) return '—';
  return v >= 100 ? String(Math.round(v)) : v.toFixed(1);
}

function fmtHourShort(h) {
  if (!hour12()) return String(h).padStart(2, '0');
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve}${h < 12 ? 'A' : 'P'}`;
}

function renderNight(el) {
  const n = vm?.night || {};
  const alertList = activeAlerts();
  el.className = screenClass(alertList, 'screen night');
  el.innerHTML = `
    ${alertBandHtml(alertList)}
    <div class="n-body">
      <div class="n-clock num">${fmtTime(now(), false)}</div>
      <div class="n-temps">${n.tempIn != null ? `${n.tempIn}° ${S('insideWord')}` : ''}${n.tempIn != null && n.tempOut != null ? ' &nbsp;·&nbsp; ' : ''}${n.tempOut != null ? `${n.tempOut}° ${S('outsideWord')}` : ''}</div>
      ${n.condition ? `<div class="n-cond">${esc(n.condition)}</div>` : ''}
      ${n.closure ? `<div class="n-closure${n.closure.open ? ' open' : ''}">${esc(n.closure.text)}</div>` : ''}
      ${n.bird ? birdHtml(n.bird, 'night') : ''}
      ${n.firstUp ? `<div class="n-first">${esc(n.firstUp)}</div>` : ''}
    </div>`;
}

const RENDERERS = { morning: renderMorning, evening: renderEvening, night: renderNight };

// ------------------------------------------------------------- main loop

function render() {
  fitStage(); // some kiosk WebViews never fire resize — refit each tick
  const target = daypart();
  document.body.style.background = target === 'night' ? '#191512' : '#FAF7F0';
  const renderer = RENDERERS[target] || renderNight;
  if (target !== currentScreen) {
    // Crossfade: draw into the idle layer, then swap.
    renderer(idleEl);
    idleEl.classList.remove('hidden');
    activeEl.classList.add('hidden');
    [activeEl, idleEl] = [idleEl, activeEl];
    currentScreen = target;
  } else {
    renderer(activeEl);
    activeEl.classList.remove('hidden');
  }
  staleBadge();
  maybeChime(activeAlerts());
}

function staleBadge() {
  document.querySelector('.stale')?.remove();
  const ageMin = (Date.now() - lastDataAt) / 60000;
  if (lastDataAt && ageMin > 15) {
    const d = document.createElement('div');
    d.className = 'stale';
    d.textContent = tpl('dataOldTpl', { m: Math.round(ageMin) });
    activeEl.appendChild(d);
  }
}

function connect() {
  const es = new EventSource('/api/stream');
  es.onmessage = ev => {
    try {
      const next = JSON.parse(ev.data);
      if (next && next.generatedAt) {
        vm = next;
        lastDataAt = Date.now();
        render();
      }
    } catch { /* ignore malformed frame */ }
  };
  es.onerror = () => { /* EventSource retries automatically */ };
}

// Reload nightly at 04:10 for kiosk hygiene.
function scheduleNightlyReload() {
  const d = now();
  const target = new Date(d);
  target.setHours(4, 10, 0, 0);
  if (target <= d) target.setDate(target.getDate() + 1);
  setTimeout(() => location.reload(), target - d);
}

fitStage();
updateBurnShift();
setInterval(updateBurnShift, 3600000);
setInterval(render, 15000);
scheduleNightlyReload();
connect();
render();

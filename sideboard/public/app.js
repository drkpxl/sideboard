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
const FORCE_ALERT = params.get('alert') === 'demo';

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
  rainToday: 'RAIN TODAY', temperature: 'TEMPERATURE', airQuality: 'AIR QUALITY',
  outside: 'outside', inside: 'inside', sunrise: 'SUNRISE', sunset: 'SUNSET',
  railIn: 'IN', railOut: 'OUT', allDay: 'ALL DAY', now: 'NOW', today: 'TODAY',
  insideWord: 'INSIDE', outsideWord: 'OUTSIDE',
  nothingElse: 'Nothing else today', nothingScheduled: 'Nothing scheduled',
  chanceOfRain: 'chance of rain', peaks: 'peaks',
  inMinTpl: 'in {m} min', inHmTpl: 'in {h} h {m} min', dataOldTpl: 'data {m} min old',
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

function activeAlert() {
  if (FORCE_ALERT) {
    return { text: 'Air quality poor — AQI 156, wildfire smoke', tile: 'aqi', id: 'demo' };
  }
  return vm?.alert || null;
}

// ------------------------------------------------------------ alert chime

let chimedAlertId = localStorage.getItem('chimedAlertId') || null;

function maybeChime(alert) {
  if (!alert) { chimedAlertId = null; localStorage.removeItem('chimedAlertId'); return; }
  if (alert.id === chimedAlertId) return;
  chimedAlertId = alert.id;
  localStorage.setItem('chimedAlertId', alert.id);
  playChime();
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

function alertBandHtml(alert) {
  return alert ? `<div class="alert-band">${esc(alert.text)}</div>` : '';
}

function renderMorning(el) {
  const m = vm?.morning || {};
  const alert = activeAlert();
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
  const aqiAlerting = alert && alert.tile === 'aqi' ? ' alerting' : '';
  const tempAlerting = alert && alert.tile === 'temperature' ? ' alerting' : '';
  const rain = m.rain || {};
  const p = m.power || {};
  const hourNow = now().getHours();
  const nowKw = p.nowKw != null ? `${S('now')} ${p.nowKw.toFixed(1)} KW` : '';

  el.className = `screen${alert ? ' compact' : ''}`;
  el.innerHTML = `
    ${railHtml(right)}
    ${alertBandHtml(alert)}
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
    <div class="m-footer${m.bins ? '' : ' empty'}"><div class="dot"></div><div>${esc(m.bins || '')}</div></div>`;
}

function renderEvening(el) {
  const e = vm?.evening || {};
  const alert = activeAlert();
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
  const onAlerting = (alert && on.alert) ? ' alerting' : '';

  el.className = 'screen';
  el.innerHTML = `
    ${railHtml(right)}
    ${alertBandHtml(alert)}
    <div class="e-body">
      <div class="e-left">
        <div class="sec-label">${S('tomorrow')} — ${esc(e.tomorrowName || '')}</div>
        <div class="rows">${agenda || `<div class="agenda-row"><div class="n" style="color:var(--label)">${S('nothingScheduled')}</div></div>`}</div>
        <div class="e-prep">${esc(e.prep || '')}</div>
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
        </div>
      </div>
    </div>
    <div class="e-footer">
      <div class="lbl">${S('today')}</div>
      <div class="val num">${e.power?.total != null ? `${fmtTotal(e.power.total)} ${esc(e.power.unit || 'kWh')}` : '—'}</div>
      <div class="val num">${e.water?.total != null ? `${fmtTotal(e.water.total)} ${esc(e.water.unit || 'gal')}` : '—'}</div>
      ${e.gas != null ? `<div class="val num">${fmtTotal(e.gas.value)} ${esc(e.gas.unit)}</div>` : ''}
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
  const alert = activeAlert();
  el.className = 'screen night';
  el.innerHTML = `
    ${alert ? alertBandHtml(alert) : ''}
    <div class="n-body">
      <div class="n-clock num">${fmtTime(now(), false)}</div>
      <div class="n-temps">${n.tempIn != null ? `${n.tempIn}° ${S('insideWord')}` : ''}${n.tempIn != null && n.tempOut != null ? ' &nbsp;·&nbsp; ' : ''}${n.tempOut != null ? `${n.tempOut}° ${S('outsideWord')}` : ''}</div>
      ${n.condition ? `<div class="n-cond">${esc(n.condition)}</div>` : ''}
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
  maybeChime(activeAlert());
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

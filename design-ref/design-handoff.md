# Handoff: Home Assistant day-part wall display

## Overview
A non-interactive glanceable dashboard for an Amazon Fire HD 10 (1920×1200, landscape) sitting on a kitchen counter. It answers "what is my day" rather than exposing controls. Three states, switched automatically by time of day:

- **Morning** — when do I need to leave, what do I wear, what's the rest of today
- **Evening** — what's tomorrow, what happens overnight, what did the house use today
- **Night** — dimmed clock, nothing else unless something is happening

Plus an **alert band** that any state can show above its content.

There is no touch interaction. Nothing is tappable. Everything on screen is read at 2–4 feet.

## About the design files
`Day Part Screens.dc.html` in this bundle is a **design reference created in HTML** — a prototype of the intended look, not production code to copy. The real implementation target is Home Assistant: most likely a Lovelace dashboard in panel mode built from custom cards (`button-card`, `apexcharts-card`, `atomic-calendar-revive` or similar) plus a `card-mod`/theme layer, or a standalone custom card. Recreate the layouts using whatever card stack the HA install already uses; do not embed this HTML.

Open the file in a browser. It contains two turns stacked vertically, newest at top:
- **Turn 2 (`2a`–`2d`)** — the designed screens. This is what to build.
- **Turn 1 (`1a`–`1g`)** — earlier wireframes, kept for context only. Ignore for implementation.

## Fidelity
**High-fidelity for visual direction, low-fidelity for scale.** Colors, typography choices, hierarchy, and copy tone are final. Sizes are not literal: every screen in the file is drawn at **880×550**, a 1:2.1818 scale model of 1920×1200. **Multiply every px value in this document by 2.1818 to get device pixels**, or better, rebuild the layout in relative units and use the ratios below.

Reference conversions:

| in the file | on the tablet |
|---|---|
| 124px clock | ~270px |
| 30px event text | ~65px |
| 26px advice text | ~57px |
| 11px uppercase label | ~24px |
| 30px screen padding | ~65px |

Nothing should render below ~24px on the device.

## Design tokens

### Color
| Token | Hex | Use |
|---|---|---|
| `ground` | `#FAF7F0` | Screen background (warm white plaster) |
| `card` | `#FFFDF8` | Card surfaces |
| `walnut` | `#543824` | Header/footer rails, current-hour bar |
| `walnut-alt` | `#5E4029` / `#4E3421` | Grain stripe companions |
| `walnut-text` | `#EFE4D4` | Text on walnut |
| `walnut-text-dim` | `#E2D5C2` | Footer values on walnut |
| `ink` | `#2B2723` | Primary text |
| `ink-mid` | `#6B5E4D` | Secondary text |
| `label` | `#8A7A66` | Uppercase labels, secondary values |
| `caption` | `#9A8B76` / `#A6977F` | Tile captions, chart axis |
| `teak` | `#B87F4A` | Event times, accent dot |
| `teak-light` | `#C79A6B` | Power bars |
| `olive` | `#40624F` | "Take with you" advice block |
| `olive-label` | `#A8C0AE` | Label inside the olive block |
| `sage` | `#8FA9A0` | Water bars |
| `alert` | `#C0561F` | Alert band, alerting tile |
| `alert-text` | `#FBF3E9` | Text on alert |
| Night `bg` | `#191512` | Night screen |
| Night `clock` | `#C3B49E` | Night clock |
| Night `label` | `#6E6252`, `#4E463C` | Night secondary / tertiary |
| Night `warm` | `#B0703C` | Night active-event line |

The walnut rail is a fake grain, not an image:
```css
background: repeating-linear-gradient(92deg,
  #543824 0 3px, #5E4029 3px 6px, #4E3421 6px 9px);
```
On the real screen scale the stripe up proportionally (~7px/13px/20px stops) or it will alias.

### Type
- **Jost** (300/400/500) — all numbers, times, event names, advice sentences. Chosen as a Futura relative; substitute Futura if the target has it licensed.
- **Work Sans** (400/500/600) — uppercase labels, captions, secondary text.

Recurring styles:
- Section label: 11px / 600 / `letter-spacing:.18em` / uppercase / `label`
- Rail text: 13px / 500 / `letter-spacing:.22em` / uppercase / `walnut-text`
- Big clock: Jost 400, `line-height:.84`, `letter-spacing:-.03em`
- Stat value: Jost 400, `line-height:1`, `white-space:nowrap`
- Tile caption: 11px / `letter-spacing:.14em` / uppercase / `caption`

### Other
- Radius: `3px` everywhere (≈7px on device). Only the accent dot is round (8px circle, `teak`).
- Shadow (cards only): `0 1px 0 rgba(43,39,35,.10)`. No blur, no elevation stack.
- Gaps: 26px between columns, 14px between grid rows, 11px between stat tiles, 10px between event rows.
- No borders on cards. Separation comes from surface tone.

## Screens

### 2a — Morning
Shown from wake time until you leave for the office.

**Layout**, top to bottom:
1. **Walnut rail** (`flex:none`, padding `13px 30px`, `justify-content:space-between`) — left: `MONDAY 3 AUGUST`; right: `6:52 AM · SUNRISE 6:14 · SUNSET 8:21` at 72% opacity.
2. **Body grid** — `display:grid; grid-template-columns:1.3fr 1fr; grid-template-rows:auto 1fr; gap:14px 26px; padding:24px 30px; flex:1`. The shared rows are the whole point: the left advice block and the right stats module start and end on the same lines.
   - **Row 1 left — countdown.** Label `NEXT OUT THE DOOR`; clock `7:40` at 124px Jost 400; below it a baseline-aligned row: `Sam — school run` (29px) and `in 48 min` (21px, 300, `label`), gap 12px.
   - **Row 1 right — agenda card.** Label `THEN TODAY`, then rows of `time` (21px, 500, `teak`, fixed 62px column) + `name` (22px). Three events shown; design for 3, degrade gracefully at 4.
   - **Row 2 left — advice block.** `olive` fill, `FAF7F0` text, padding `18px 20px`, contents vertically centered. Label `TAKE WITH YOU` in `olive-label`, then a two-line sentence at 26px / `line-height:1.28`.
   - **Row 2 right — stats.** `grid-template-columns:1fr 1fr; grid-template-rows:1fr 1fr; gap:11px`.
     - **Temperature** — paired tile: two value+caption stacks in a row, gap 22px. First value `ink`, second value `label`, captions `outside` / `inside`.
     - **Air quality** — same paired pattern, AQI numbers.
     - **Rain today** — single value `70%`, caption `peaks 3pm`.
     - **Power today** — label row with the day total right-aligned (`5.6 kWh`), then an **hourly bar chart since midnight**: `display:flex; align-items:flex-end; gap:2px; height:30px`, bars `flex:1`, height as % of the day's max, `border-radius:1px 1px 0 0`, fill `teak-light`, **the most recent hour filled `walnut`**. Under it an axis row: `12A` left, `NOW 1.4 KW` right, 10px uppercase `caption`.
3. **Footer line** (`padding:0 30px 16px`) — 8px `teak` dot + `Bins out tonight — recycling` at 14px `ink-mid`. Hidden on days with no bin event.

### 2b — Morning with alert band
Identical to 2a with one row inserted and everything scaled down a notch (clock 100px, advice 24px, stats 27px, agenda 21px, body padding 18px).

- **Alert band** sits directly under the walnut rail: `alert` fill, `alert-text`, padding `13px 30px`, single Jost 28px sentence, e.g. `Air quality poor — AQI 156, wildfire smoke`. No icon, no secondary instruction — the sentence carries it.
- The **tile the alert is about** flips to `alert` fill with `alert-text` (here the Air quality tile shows `156 / 22`) so band and tile read as one object. Only ever one tile at a time.

Trigger examples: severe weather warning, AQI above threshold, water running abnormally long, freeze warning. Severity is not tiered — either it earns the band or it doesn't appear.

### 2c — Evening
Shown from late afternoon until night.

1. **Walnut rail** — `MONDAY 3 AUGUST` / `9:04 PM · 71° IN · 63° OUT`.
2. **Body** — `display:flex; padding:26px 30px; gap:26px`.
   - **Left column** (`flex:1.4`): label `TOMORROW — TUESDAY`, then four event rows at 28px `teak` time (80px column) + 30px name, gap 14px. At the bottom (`margin-top:auto`) an `olive` block, padding `15px 18px`, 26px two-line prep sentence.
   - **Right column** (`flex:1`, gap 14px):
     - **Overnight** card — label, 36px value (`Clear, low 58°`), 14px sub (`windows can stay open`).
     - **Tomorrow** card — same shape, `61° → 79°`, `AQI 38 · pollen moderate`.
     - **Usage** card (`flex:1`) — two stacked mini charts, gap 14px. Each has a label row with the total right-aligned (`18.4 kWh`, `112 gal`) and a 26px bar row, 22 bars (hour 0 through current). Power bars `teak-light`, water bars `sage`, current hour `walnut` in both. Axis `12A` / `9P` under the second chart only.
3. **Walnut footer** — flat `#543824`, `padding:11px 30px`, `TODAY` label at 11px/.2em/60% then `18.4 kWh`, `112 gal`, `0.4 therm` at 14px, gap 44px.

If a storm is coming overnight, 2c takes the same alert band as 2b and the Overnight card flips to `alert`.

### 2d — Night
`#191512` ground, everything centered in a column, gap 16px.
- Clock `11:42` — Jost 300, 124px, `#C3B49E`.
- `71° INSIDE · 58° OUTSIDE` — 14px, `.24em`, uppercase, `#6E6252`.
- Active condition line only if something is happening — `Storms passing through until 2`, Jost 26px, `#B0703C`. Omit the row entirely when nothing is.
- Absolutely positioned 24px from the bottom: `FIRST UP 6:45 · SWIM`, 12px, `.22em`, `#4E463C`.

Screen brightness should drop with the state, not just the palette.

## Behavior

- **State machine, time-driven.** Morning / evening / night, boundaries configurable (suggest morning from alarm or 05:30 until 09:30; evening 16:30 until 22:30; night otherwise). Daytime hours can hold the evening screen or go to night — the display is unattended then.
- **No transitions needed** beyond a slow crossfade (400–600ms) on state change. Avoid anything that draws the eye; this sits in peripheral vision all day.
- **Refresh cadence:** clock and countdown every 30s (minute-accurate is fine); sensors on their own HA update; calendar every 5 min.
- **Burn-in:** the Fire HD is LCD so risk is low, but shift the whole layout by a few px hourly if you're leaving it on for years.
- **Fire HD specifics:** run it in a kiosk browser (Fully Kiosk Browser is the usual answer) pointed at the HA dashboard URL, screensaver off, screen-on-while-charging, and let Fully handle brightness by time of day.

## Data used

| Element | Source |
|---|---|
| Next event, countdown, today's list, tomorrow's list | Shared family Google Calendar via HA calendar integration |
| Countdown target | Start time of next event minus a configurable prep buffer |
| Advice sentence | Template sensor: outdoor temp + precip probability in the next N hours → jacket / umbrella phrasing |
| Out / in temperature | Weather integration + indoor thermostat sensor |
| AQI out / in | Outdoor AQI provider + indoor air quality sensor |
| Rain today, peak time | Hourly forecast |
| Power hourly, day total | Energy sensor, hourly statistics since midnight |
| Water hourly, day total | Water meter sensor, hourly statistics since midnight |
| Gas total | Gas meter, day total only |
| Bins line | Waste-collection calendar or scheduled helper |
| Sunrise / sunset | `sun` integration |
| Alert band | Weather warnings, AQI threshold, leak/runtime anomaly |

The advice sentence and the alert copy are the only generated text. Write them as short declaratives in the same voice as the mock: `Jacket — it's 54° out.` not `You may want to consider a jacket.`

## Files
- `Day Part Screens.dc.html` — the design. Turn 2 (`2a`–`2d`) is current; turn 1 is superseded wireframes.

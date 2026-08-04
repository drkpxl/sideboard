# Changelog

## 1.1.0

- **The alert band now stacks.** Every active alert gets its own line instead of only the most severe one showing. The band trades type size for rows and caps at `max_alerts` (default 3), with a "+N more" line beyond that; the screen below it shrinks to fit rather than clipping. The chime still sounds once per genuinely new alert, not on every redraw.
- **New: carbon monoxide alerts.** Point `co_sensors` at any ppm sensors; they band above everything else at `co_alert_ppm` (default 9).
- **New: radon alerts.** Set `radon_sensor` to an Airthings-style sensor. Reads pCi/L or Bq/m³ and alerts at `radon_alert_pci_l` (default 4, the EPA action level).
- **New: closed-up check.** List `door_sensors` and `garage_doors` to get "All doors closed" on the night screen, or the names of whatever is still open. An open door also becomes the first line of the evening prep block.
- **The evening prep box is now "Before bed", and only carries things to actually do** — an open door, bins going out, rain tomorrow. It used to repeat tomorrow's first calendar event, which is already printed directly above it. On a night with nothing to do, the box shows the latest bird instead of a restatement.
- **New: BirdNET-Go detections.** Set `birdnet_sensor` to show the last bird heard under a "Latest bird" heading — photo, name, time and source — large on the night screen, and small at the bottom right of the morning screen. Detections older than `bird_max_age_hours` (default 12) are hidden.
- **New: optional commute time.** Set `commute_sensor` to a Waze/Google travel-time sensor to show it at the bottom left of the morning screen, behind whatever `mdi:` icon that entity already carries in Home Assistant. Gate it with `workday_sensor` and `commute_presence` so it only appears on a workday when that person is home. A bins reminder takes that spot when there is one. Off unless configured.
- **The evening totals bar is gone.** It repeated the power and water figures printed in the charts directly above it. Gas — the one number that was only there — moved up into the usage card as "Gas today".
- Fixed: the evening screen overflowed whenever the alert band was showing — the tomorrow card overlapped the power chart. It now shrinks to fit like the morning screen does.
- Display names now drop repeated words, so "Side Door Door" reads "Side Door" without renaming anything in Home Assistant.

## 1.0.3

- **Fixed: display cropped on Fire tablets and other kiosk WebViews.** The screen now scales to the smallest truly-visible viewport (layout, visual, or window), re-fits continuously, and locks page zoom.
- Devices with a different aspect ratio than 16:10 now letterbox in the screen's own background color instead of black bars.

## 1.0.2

- **Fixed: add-on exited at startup with "No auth available".** The base image's s6-overlay scrubs the container environment before running the server; `S6_KEEP_ENV=1` keeps the Supervisor token visible.
- Auth now also accepts the older `HASSIO_TOKEN` name, and logs the available environment variable names (never values) if no token is found.

## 1.0.1

- **Fixed: install failed on aarch64 (and any non-amd64) machines.** Added `build.yaml` mapping each architecture to its Home Assistant base image — the Supervisor does not inject `BUILD_FROM` on its own.
- Added the store icon and logo.

## 1.0.0

- Initial release: morning / evening / night screens, alert band with chime, calendar countdown and agenda, weather advice sentences, hourly power/water bars with live kW, gas day total, bins reminders, NWS warnings (entity or direct), English/Spanish with auto-detection from Home Assistant, unit-aware display, Supervisor-proxy auth (no token configuration).

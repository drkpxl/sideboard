# Changelog

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

# GPX Preview

An Obsidian plugin that renders Apple-style map previews of GPX files embedded in your notes — designed for workout tracks.

```markdown
![Wednesday workout](Workout 2026-04-05.gpx)
```

…renders a rounded map card with the route drawn on it, an optional title (the embed's alt text), and workout stats. Wikilink embeds work too: `![[Workout 2026-04-05.gpx|Wednesday workout]]`.

## Features

- **Apple-like cards** — large rounded corners, light and dark mode aware, start/finish markers, blue route line.
- **Stats** — Distance, Duration and Average speed by default; Moving time, Average pace, Max speed and Elevation gain can be toggled on in settings.
- **Units** — metric (km, km/h) or imperial (mi, mph).
- **Offline-first** — the map is composed into a PNG on first load and cached in the plugin folder, so previews keep working with no network connection.
- **Map providers**:
  - **CARTO** (default) — free, clean Apple-esque basemap, light + dark variants.
  - **OpenStreetMap** — the classic OSM style.
  - **Apple Maps** — uses Apple's [Maps Web Snapshots](https://developer.apple.com/documentation/snapshots) API. Requires an Apple Developer account: create a key with MapKit JS enabled, then paste your Team ID, Key ID and the `.p8` private key into the plugin settings. Requests are signed locally; your key never leaves your device.

## Installation (manual)

1. Run `yarn install && yarn build`.
2. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/gpx-preview/`.
3. Enable **GPX Preview** in Settings → Community plugins.

> **Note:** if your GPX files don't show up in Obsidian, this plugin registers the `.gpx` extension, so they will after enabling it. Clicking a GPX file in the file explorer opens the same map preview as a pane.

## Development

```sh
yarn install
yarn dev     # watch mode
yarn build   # type-check + production build
```

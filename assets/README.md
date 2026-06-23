# Assets

This directory holds the visual assets shipped with the plugin tarball.

## App icon

The app icon is complete. The following files exist:

- `assets/icons/icon.svg` - source SVG
- `assets/icons/icon-72.png` - 72x72 PNG
- `assets/icons/icon-96.png` - 96x96 PNG
- `assets/icons/icon-192.png` - 192x192 PNG (referenced by `signalk.appIcon` in `package.json`)
- `assets/icons/icon-512.png` - 512x512 PNG

## Screenshots (not yet captured)

The following three screenshots need to be captured on a live server and placed under `assets/screenshots/` before the next release:

1. `assets/screenshots/config-form.png` - the plugin config form with at least one detected path opted in, showing the per-path options (method, outlier rejection, and so on).
2. `assets/screenshots/data-browser.png` - the Signal K data browser showing a path with its raw sources and the synthetic source (`signalk-synthetic-values`) listed alongside them.
3. `assets/screenshots/source-priority.png` - the Source Priorities panel mid-setup, with `signalk-synthetic-values` dragged to the top of a path's source list.

Once the screenshots exist, set `signalk.screenshots` in `package.json` to their shipped paths:

```json
"signalk": {
  "displayName": "Synthetic Values",
  "appIcon": "./assets/icons/icon-192.png",
  "screenshots": [
    "assets/screenshots/config-form.png",
    "assets/screenshots/data-browser.png",
    "assets/screenshots/source-priority.png"
  ]
}
```

Then verify the files are included in the tarball:

```bash
npm pack --dry-run
```

Confirm `assets/screenshots/config-form.png`, `assets/screenshots/data-browser.png`, and `assets/screenshots/source-priority.png` appear in the file list. The `files` field in `package.json` already includes `"assets"`, so any file placed under `assets/` is automatically included.

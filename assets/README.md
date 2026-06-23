# Assets

This directory holds the visual assets shipped with the plugin tarball.

## Required before publish

### App icon

`assets/appicon.png` - a square PNG, at least 512x512 pixels. Referenced by `signalk.appIcon` in `package.json`.

This file must exist before `npm publish`. The App Store and the admin UI both display it.

### Screenshots

Add these three screenshots under `assets/screenshots/` before publish:

1. `assets/screenshots/config-form.png` - the plugin config form with at least one detected path opted in, showing the per-path options.
2. `assets/screenshots/data-browser.png` - the Signal K data browser showing a path with its raw sources and the synthetic source (`signalk-synthetic-values`) listed alongside them.
3. `assets/screenshots/source-priority.png` - the Source Priorities panel mid-setup, with `signalk-synthetic-values` dragged to the top of a path's source list.

### Wiring the screenshots into package.json

Once the images exist, set `signalk.screenshots` in `package.json` to their shipped paths:

```json
"signalk": {
  "displayName": "Synthetic Values",
  "appIcon": "assets/appicon.png",
  "screenshots": [
    "assets/screenshots/config-form.png",
    "assets/screenshots/data-browser.png",
    "assets/screenshots/source-priority.png"
  ]
}
```

Then verify the files are included in the tarball:

```
npm pack --dry-run
```

Confirm `assets/screenshots/config-form.png`, `assets/screenshots/data-browser.png`, and `assets/screenshots/source-priority.png` appear in the file list. The `files` field in `package.json` already includes `"assets"`, so any file placed under `assets/` is automatically included.

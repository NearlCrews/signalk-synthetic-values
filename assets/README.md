# Assets

This directory holds the visual assets shipped with the plugin tarball.

## App icon

The app icon is complete. The following files exist:

- `assets/icons/icon.svg`: source SVG
- `assets/icons/icon-72.png`: 72x72 PNG
- `assets/icons/icon-96.png`: 96x96 PNG
- `assets/icons/icon-192.png`: 192x192 PNG (referenced by `signalk.appIcon` in `package.json`)
- `assets/icons/icon-512.png`: 512x512 PNG

## Screenshots

The package ships five App Store screenshots:

1. `assets/screenshots/00-admin-hero.png`: the panel inside current Signal K Admin chrome, and the App Store hero at 1280x800.
2. `assets/screenshots/01-config-panel.png`: detected paths, combined state, source metadata, and the priority reminder.
3. `assets/screenshots/02-not-recommended.png`: the expanded group for paths that should not be combined automatically.
4. `assets/screenshots/03-tune.png`: per-path tuning and advanced controls.
5. `assets/screenshots/04-data-browser.png`: live Signal K data with raw and synthetic sources.

Run `npm run screenshots` to refresh the first four images from the production
configuration remote. The data-browser image requires a live Signal K server
and should be updated manually when that UI changes. Refresh the four captured
images whenever the panel's appearance changes, including a shared UI release
that moves colors, type, or spacing.

Verify all declared files are included in the tarball:

```bash
npm pack --dry-run
```

`npm run package:check` also validates every `signalk.appIcon` and
`signalk.screenshots` path declared in `package.json`.

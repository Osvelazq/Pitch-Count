# Pitch Tracker

Phone-first softball pitch tracker PWA for logging from the stands. Static files only — drop on GitHub Pages.

## Use

1. Open `index.html` (or your Pages URL).
2. Tap **Ball / Called / Swing / Foul / In Play** (or **Unknown**).
3. Optionally pin a **zone** (catcher’s view) and pitch type when you saw it clearly — skip otherwise.
4. Confirm plate-appearance results when prompted (or use **End AB**).
5. **Undo** is one tap. Export summary CSV, detail CSV, or JSON from **Menu**.

## Data

- Append-only event log in `localStorage` (`pitchTracker.v2`).
- Innings pitched from outs: `0.0`, `0.1`, `0.2`, `1.0`, …
- Zone insights (e.g. “Most balls were low outside”) when locations are logged.
- Legacy v1 counter keys are migrated once into a v2 game.

## Develop

```bash
npm test
```

No build step. Service worker: `sw.js` (`pitch-tracker-v2`).

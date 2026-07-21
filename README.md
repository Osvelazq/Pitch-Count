# Pitch Tracker

Phone-first softball pitch tracker PWA for logging from the stands. Static files only — drop on GitHub Pages.

## Use

1. Open `index.html` (or your Pages URL).
2. Tap **Simple** for a pitch/at-bat focused layout (no zone popup).
3. Tap **Ball / Called / Swing / Foul / In Play / Missed**.
4. Optionally tap **Zone** (full mode) when you saw location clearly.
5. Confirm plate-appearance results when prompted (or enable auto-confirm K/BB in Menu).
6. Use **+ Out** / **DP** for defensive outs; **Set inning…** when your pitcher enters mid-game (does not pad IP).
7. **Undo** reverses the last event (a full pitch including zone). **Undo whole at-bat** lives under Stats. Delete individual events from the log with confirm.
8. Export summary CSV, detail CSV, or JSON from Menu.

## Data

- Append-only event log in `localStorage` (`pitchTracker.v2`).
- Settings (simple mode, auto K/BB) in `pitchTracker.settings`.
- Innings pitched from recorded outs only: `0.0`, `0.1`, `0.2`, `1.0`, …
- Setting game situation does not invent outs for IP.
- Legacy v1 counter keys are migrated once into a v2 game.

## Develop

```bash
npm test
```

No build step. Service worker: `sw.js` (`pitch-tracker-v3`).

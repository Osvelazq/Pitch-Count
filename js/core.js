/**
 * Pitch Tracker — pure state, stats, CSV, migration (no DOM).
 * Schema version 2: append-only event log as source of truth.
 */

export const SCHEMA_VERSION = 2;
export const STORAGE_KEY = 'pitchTracker.v2';
export const THEME_KEY = 'pitchTracker.theme';

/** Catcher's-view 3×3 zone grid (Inside / Middle / Outside × High / Mid / Low). */
export const ZONES = [
  { id: 'HI_IN', row: 'high', col: 'in', label: 'High In', short: 'HI' },
  { id: 'HI', row: 'high', col: 'middle', label: 'High', short: 'H' },
  { id: 'HI_OUT', row: 'high', col: 'out', label: 'High Out', short: 'HO' },
  { id: 'IN', row: 'middle', col: 'in', label: 'In', short: 'IN' },
  { id: 'MID', row: 'middle', col: 'middle', label: 'Middle', short: 'MID' },
  { id: 'OUT', row: 'middle', col: 'out', label: 'Out', short: 'OUT' },
  { id: 'LO_IN', row: 'low', col: 'in', label: 'Low In', short: 'LI' },
  { id: 'LO', row: 'low', col: 'middle', label: 'Low', short: 'LO' },
  { id: 'LO_OUT', row: 'low', col: 'out', label: 'Low Out', short: 'LOut' },
];

export const ZONE_BY_ID = Object.fromEntries(ZONES.map((z) => [z.id, z]));

export const PITCH_RESULTS = {
  ball: { id: 'ball', label: 'Ball', countsAs: 'ball' },
  called_strike: { id: 'called_strike', label: 'Called Strike', countsAs: 'strike' },
  swinging_strike: { id: 'swinging_strike', label: 'Swinging Strike', countsAs: 'strike' },
  foul: { id: 'foul', label: 'Foul', countsAs: 'foul' },
  in_play: { id: 'in_play', label: 'In Play', countsAs: 'in_play' },
  unknown: { id: 'unknown', label: 'Unknown', countsAs: 'unknown' },
};

export const PA_OUTCOMES = {
  strikeout: { id: 'strikeout', label: 'Strikeout', short: 'K', defaultOuts: 1, isHit: false },
  walk: { id: 'walk', label: 'Walk', short: 'BB', defaultOuts: 0, isHit: false },
  hbp: { id: 'hbp', label: 'Hit By Pitch', short: 'HBP', defaultOuts: 0, isHit: false },
  out: { id: 'out', label: 'Out', short: 'OUT', defaultOuts: 1, isHit: false },
  single: { id: 'single', label: 'Single', short: '1B', defaultOuts: 0, isHit: true },
  double: { id: 'double', label: 'Double', short: '2B', defaultOuts: 0, isHit: true },
  triple: { id: 'triple', label: 'Triple', short: '3B', defaultOuts: 0, isHit: true },
  home_run: { id: 'home_run', label: 'Home Run', short: 'HR', defaultOuts: 0, isHit: true },
  error: { id: 'error', label: 'Error', short: 'E', defaultOuts: 0, isHit: false },
  fielders_choice: { id: 'fielders_choice', label: "Fielder's Choice", short: 'FC', defaultOuts: 1, isHit: false },
  sacrifice: { id: 'sacrifice', label: 'Sacrifice', short: 'SAC', defaultOuts: 1, isHit: false },
};

export const PITCH_TYPES = [
  { id: 'fastball', label: 'Fastball' },
  { id: 'changeup', label: 'Changeup' },
  { id: 'drop', label: 'Drop' },
  { id: 'rise', label: 'Rise' },
  { id: 'curve', label: 'Curve' },
  { id: 'screw', label: 'Screw' },
  { id: 'other', label: 'Other' },
  { id: 'unknown', label: 'Unknown' },
];

function uid(prefix = 'id') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function formatInningsPitched(outsRecorded) {
  const outs = Math.max(0, outsRecorded | 0);
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  return `${whole}.${rem}`;
}

export function createGame(overrides = {}) {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid('game'),
    date: now.slice(0, 10),
    status: 'active',
    homeTeam: '',
    awayTeam: '',
    homeScore: 0,
    awayScore: 0,
    pitcher: '',
    ruleset: 'softball_standard',
    createdAt: now,
    updatedAt: now,
    events: [],
    ...overrides,
  };
}

/** Live count / inning derived by replaying events. */
export function deriveLiveState(game) {
  let balls = 0;
  let strikes = 0;
  let outs = 0;
  let inning = 1;
  let half = 'top'; // top = away bats, bottom = home bats
  let batterSequence = 1;
  let pendingPa = null; // 'strikeout' | 'walk' | 'in_play' | null
  let pitchesThisPa = 0;

  for (const ev of game.events || []) {
    if (ev.type === 'pitch') {
      pitchesThisPa += 1;
      const result = ev.pitchResult;
      if (result === 'ball') {
        balls += 1;
        if (balls >= 4) pendingPa = 'walk';
      } else if (result === 'called_strike' || result === 'swinging_strike') {
        strikes += 1;
        if (strikes >= 3) pendingPa = 'strikeout';
      } else if (result === 'foul') {
        if (strikes < 2) strikes += 1;
      } else if (result === 'in_play') {
        pendingPa = 'in_play';
      } else if (result === 'unknown') {
        // Unknown pitch: count unchanged; observer can still end PA manually.
      }
    } else if (ev.type === 'plate_appearance_result') {
      balls = 0;
      strikes = 0;
      pitchesThisPa = 0;
      pendingPa = null;
      batterSequence += 1;
      const addOuts = Math.max(0, Math.min(3, ev.outsOnPlay | 0));
      outs += addOuts;
      while (outs >= 3) {
        outs -= 3;
        if (half === 'top') half = 'bottom';
        else {
          half = 'top';
          inning += 1;
        }
      }
    } else if (ev.type === 'manual_adjustment') {
      if (typeof ev.addOuts === 'number' && ev.addOuts > 0) {
        outs += Math.min(3, ev.addOuts | 0);
        while (outs >= 3) {
          outs -= 3;
          if (half === 'top') half = 'bottom';
          else {
            half = 'top';
            inning += 1;
          }
        }
      }
      if (typeof ev.balls === 'number') balls = ev.balls;
      if (typeof ev.strikes === 'number') strikes = ev.strikes;
      // setOuts / setInning / setHalf change game situation only (no IP padding)
      if (typeof ev.setOuts === 'number') outs = Math.max(0, Math.min(2, ev.setOuts | 0));
      else if (typeof ev.outs === 'number') outs = ev.outs;
      if (typeof ev.setInning === 'number') inning = Math.max(1, ev.setInning | 0);
      else if (typeof ev.inning === 'number') inning = ev.inning;
      if (ev.setHalf === 'top' || ev.setHalf === 'bottom') half = ev.setHalf;
      else if (ev.half === 'top' || ev.half === 'bottom') half = ev.half;
      if (ev.clearPending) {
        pendingPa = null;
        balls = typeof ev.balls === 'number' ? ev.balls : 0;
        strikes = typeof ev.strikes === 'number' ? ev.strikes : 0;
        pitchesThisPa = 0;
      }
      if (ev.resetCount) {
        balls = 0;
        strikes = 0;
        pitchesThisPa = 0;
        pendingPa = null;
      }
    } else if (ev.type === 'pitcher_change') {
      // Live pitcher name is tracked separately; no count impact.
    }
  }

  return {
    balls,
    strikes,
    outs,
    inning,
    half,
    batterSequence,
    pendingPa,
    pitchesThisPa,
    outsRecorded: countOutsRecorded(game),
    currentPitcher: currentPitcherName(game),
  };
}

function currentPitcherName(game) {
  let name = game.pitcher || '';
  for (const ev of game.events || []) {
    if (ev.type === 'pitcher_change' && ev.pitcherName) name = ev.pitcherName;
  }
  return name;
}

function countOutsRecorded(game) {
  let total = 0;
  for (const ev of game.events || []) {
    if (ev.type === 'plate_appearance_result') {
      total += Math.max(0, Math.min(3, ev.outsOnPlay | 0));
    } else if (ev.type === 'manual_adjustment' && typeof ev.addOuts === 'number') {
      total += Math.max(0, Math.min(3, ev.addOuts | 0));
    }
  }
  return total;
}

export function deriveStats(game) {
  const live = deriveLiveState(game);
  const pitches = [];
  const paResults = [];

  for (const ev of game.events || []) {
    if (ev.type === 'pitch') pitches.push(ev);
    if (ev.type === 'plate_appearance_result') paResults.push(ev);
  }

  let balls = 0;
  let strikes = 0; // includes fouls that count + called + swinging
  let calledStrikes = 0;
  let swingingStrikes = 0;
  let fouls = 0;
  let inPlay = 0;
  let unknownPitches = 0;
  let firstPitchStrikes = 0;
  let firstPitches = 0;

  // First-pitch strike: first pitch of each PA that is strike/foul/in_play
  let paPitchIndex = 0;
  for (const ev of game.events || []) {
    if (ev.type === 'pitch') {
      paPitchIndex += 1;
      const r = ev.pitchResult;
      if (r === 'ball') balls += 1;
      else if (r === 'called_strike') {
        calledStrikes += 1;
        strikes += 1;
      } else if (r === 'swinging_strike') {
        swingingStrikes += 1;
        strikes += 1;
      } else if (r === 'foul') {
        fouls += 1;
        strikes += 1; // foul counts toward strike total for pitch stats
      } else if (r === 'in_play') {
        inPlay += 1;
        strikes += 1; // in-play often counted in strike% denominators as strike-ish; use total pitches for %
      } else if (r === 'unknown') unknownPitches += 1;

      if (paPitchIndex === 1) {
        firstPitches += 1;
        if (r === 'called_strike' || r === 'swinging_strike' || r === 'foul' || r === 'in_play') {
          firstPitchStrikes += 1;
        }
      }
    } else if (ev.type === 'plate_appearance_result') {
      paPitchIndex = 0;
    }
  }

  const totalPitches = pitches.length;
  const strikeLookingSwinging = calledStrikes + swingingStrikes + fouls;
  const strikePct =
    totalPitches > 0 ? Math.round((strikeLookingSwinging / totalPitches) * 1000) / 10 : null;
  const firstPitchStrikePct =
    firstPitches > 0 ? Math.round((firstPitchStrikes / firstPitches) * 1000) / 10 : null;

  let strikeouts = 0;
  let walks = 0;
  let hbp = 0;
  let hits = 0;
  let outsFromPa = 0;
  let runs = 0;
  let battersFaced = paResults.length;

  for (const pa of paResults) {
    const o = pa.paOutcome;
    if (o === 'strikeout') strikeouts += 1;
    if (o === 'walk') walks += 1;
    if (o === 'hbp') hbp += 1;
    if (PA_OUTCOMES[o]?.isHit) hits += 1;
    outsFromPa += Math.max(0, pa.outsOnPlay | 0);
    if (typeof pa.runsOnPlay === 'number' && pa.runsOnPlay > 0) runs += pa.runsOnPlay;
  }

  return {
    ...live,
    totalPitches,
    totalBalls: balls,
    totalStrikes: strikeLookingSwinging,
    calledStrikes,
    swingingStrikes,
    fouls,
    inPlay,
    unknownPitches,
    strikePct,
    firstPitchStrikePct,
    firstPitchStrikes,
    firstPitches,
    battersFaced,
    strikeouts,
    walks,
    hbp,
    hits,
    outsRecorded: live.outsRecorded,
    inningsPitched: formatInningsPitched(live.outsRecorded),
    runsAllowed: runs,
    hasAnyRunsLogged: paResults.some((p) => typeof p.runsOnPlay === 'number'),
  };
}

export function zoneInsights(game) {
  const byResult = {};
  const allLocated = [];

  for (const ev of game.events || []) {
    if (ev.type !== 'pitch' || !ev.location) continue;
    const zone = ZONE_BY_ID[ev.location];
    if (!zone) continue;
    const bucket = ev.pitchResult || 'unknown';
    if (!byResult[bucket]) byResult[bucket] = {};
    byResult[bucket][ev.location] = (byResult[bucket][ev.location] || 0) + 1;
    allLocated.push({ result: bucket, location: ev.location, zone });
  }

  function topFor(resultKey) {
    const counts = byResult[resultKey] || {};
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return null;
    const [id, count] = entries[0];
    const zone = ZONE_BY_ID[id];
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    return {
      location: id,
      label: zone?.label || id,
      row: zone?.row,
      col: zone?.col,
      count,
      total,
      phrase: phraseFor(zone, resultKey, count, total),
    };
  }

  function phraseFor(zone, resultKey, count, total) {
    if (!zone) return null;
    const where =
      zone.row === 'low' && zone.col === 'out'
        ? 'low outside'
        : zone.row === 'low' && zone.col === 'in'
          ? 'low inside'
          : zone.row === 'high' && zone.col === 'out'
            ? 'high outside'
            : zone.row === 'high' && zone.col === 'in'
              ? 'high inside'
              : zone.row === 'middle' && zone.col === 'out'
                ? 'outside'
                : zone.row === 'middle' && zone.col === 'in'
                  ? 'inside'
                  : zone.row === 'low'
                    ? 'low'
                    : zone.row === 'high'
                      ? 'high'
                      : zone.col === 'out'
                        ? 'outside'
                        : zone.col === 'in'
                          ? 'inside'
                          : 'middle';
    const kind =
      resultKey === 'ball'
        ? 'balls'
        : resultKey === 'called_strike'
          ? 'called strikes'
          : resultKey === 'swinging_strike'
            ? 'swinging strikes'
            : resultKey === 'foul'
              ? 'fouls'
              : 'pitches';
    return `Most ${kind} were ${where} (${count} of ${total} located)`;
  }

  const ballTop = topFor('ball');
  const strikeTop = topFor('called_strike');
  const swingTop = topFor('swinging_strike');

  // Row/col aggregates for balls (tangible summary)
  const ballZones = byResult.ball || {};
  let lowOutsideBalls = (ballZones.LO_OUT || 0);
  let lowBalls = (ballZones.LO_IN || 0) + (ballZones.LO || 0) + (ballZones.LO_OUT || 0);
  let outsideBalls =
    (ballZones.HI_OUT || 0) + (ballZones.OUT || 0) + (ballZones.LO_OUT || 0);

  const phrases = [];
  if (ballTop) phrases.push(ballTop.phrase);
  if (swingTop && (!ballTop || swingTop.count >= 3)) phrases.push(swingTop.phrase);
  if (strikeTop && (!ballTop || strikeTop.count >= 3)) phrases.push(strikeTop.phrase);

  return {
    locatedCount: allLocated.length,
    byResult,
    ballTop,
    strikeTop,
    swingTop,
    lowOutsideBalls,
    lowBalls,
    outsideBalls,
    phrases: phrases.filter(Boolean),
  };
}

export function lastEvent(game) {
  const events = game.events || [];
  return events.length ? events[events.length - 1] : null;
}

export function describeEvent(ev) {
  if (!ev) return '—';
  if (ev.type === 'pitch') {
    const pr = PITCH_RESULTS[ev.pitchResult]?.label || ev.pitchResult;
    const loc = ev.location ? ZONE_BY_ID[ev.location]?.label : null;
    const pt = ev.pitchType && ev.pitchType !== 'unknown' ? ev.pitchType : null;
    return [pr, loc, pt].filter(Boolean).join(' · ');
  }
  if (ev.type === 'plate_appearance_result') {
    const o = PA_OUTCOMES[ev.paOutcome]?.label || ev.paOutcome;
    const bits = [o];
    if (ev.outsOnPlay) bits.push(`${ev.outsOnPlay} out${ev.outsOnPlay === 1 ? '' : 's'}`);
    if (typeof ev.runsOnPlay === 'number' && ev.runsOnPlay > 0) bits.push(`${ev.runsOnPlay} R`);
    return bits.join(' · ');
  }
  if (ev.type === 'manual_adjustment') {
    if (ev.addOuts) return ev.notes || `+${ev.addOuts} out${ev.addOuts === 1 ? '' : 's'}`;
    if (ev.setInning || ev.setHalf || typeof ev.setOuts === 'number') {
      const inn = ev.setInning != null ? ev.setInning : '?';
      const hf = ev.setHalf === 'bottom' ? '▼' : ev.setHalf === 'top' ? '▲' : '';
      const o = typeof ev.setOuts === 'number' ? ` · ${ev.setOuts} out` : '';
      return ev.notes || `Set ${inn}${hf}${o}`;
    }
    return ev.notes || 'Adjustment';
  }
  if (ev.type === 'pitcher_change') return `Pitcher: ${ev.pitcherName || '—'}`;
  return ev.type;
}

function touchUpdated(game) {
  return { ...game, updatedAt: new Date().toISOString() };
}

function nextSequence(game) {
  return (game.events?.length || 0) + 1;
}

function baseEvent(game, live, type, extra = {}) {
  return {
    id: uid('ev'),
    sequence: nextSequence(game),
    timestamp: new Date().toISOString(),
    inning: live.inning,
    half: live.half,
    batterSequence: live.batterSequence,
    pitcherName: live.currentPitcher || game.pitcher || null,
    type,
    pitchResult: null,
    pitchType: null,
    location: null,
    paOutcome: null,
    outsOnPlay: null,
    runsOnPlay: null,
    notes: null,
    ...extra,
  };
}

export function appendPitch(game, { pitchResult, location = null, pitchType = null, notes = null }) {
  if (!PITCH_RESULTS[pitchResult]) throw new Error(`Invalid pitchResult: ${pitchResult}`);
  const live = deriveLiveState(game);
  if (live.pendingPa === 'walk' || live.pendingPa === 'strikeout') {
    throw new Error('Resolve the plate appearance before logging another pitch');
  }
  if (live.pendingPa === 'in_play') {
    throw new Error('Resolve the ball in play before logging another pitch');
  }

  const ev = baseEvent(game, live, 'pitch', {
    pitchResult,
    pitchType: pitchType || null,
    location: location || null,
    notes: notes || null,
  });

  return touchUpdated({ ...game, events: [...(game.events || []), ev] });
}

export function setLastPitchLocation(game, location) {
  const events = [...(game.events || [])];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'pitch') {
      if (location && !ZONE_BY_ID[location]) throw new Error(`Invalid location: ${location}`);
      events[i] = { ...events[i], location: location || null };
      return touchUpdated({ ...game, events });
    }
  }
  return game;
}

export function setLastPitchType(game, pitchType) {
  const events = [...(game.events || [])];
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].type === 'pitch') {
      events[i] = { ...events[i], pitchType: pitchType || null };
      return touchUpdated({ ...game, events });
    }
  }
  return game;
}

export function appendPaResult(
  game,
  { paOutcome, outsOnPlay = null, runsOnPlay = null, notes = null }
) {
  if (!PA_OUTCOMES[paOutcome]) throw new Error(`Invalid paOutcome: ${paOutcome}`);
  const meta = PA_OUTCOMES[paOutcome];
  const live = deriveLiveState(game);
  const outs = outsOnPlay == null ? meta.defaultOuts : Math.max(0, Math.min(3, outsOnPlay | 0));
  const runs =
    runsOnPlay == null || runsOnPlay === '' ? null : Math.max(0, Math.min(20, Number(runsOnPlay)));

  const ev = baseEvent(game, live, 'plate_appearance_result', {
    paOutcome,
    outsOnPlay: outs,
    runsOnPlay: Number.isFinite(runs) ? runs : null,
    notes: notes || null,
  });

  let next = touchUpdated({ ...game, events: [...(game.events || []), ev] });
  if (Number.isFinite(runs) && runs > 0) {
    if (live.half === 'top') {
      next = { ...next, awayScore: (next.awayScore | 0) + runs };
    } else {
      next = { ...next, homeScore: (next.homeScore | 0) + runs };
    }
  }
  return next;
}

/** Record outs that count toward IP (e.g. +Out, double play) without a full PA. */
export function addRecordedOuts(game, n, notes = null) {
  const count = Math.max(1, Math.min(3, n | 0));
  const live = deriveLiveState(game);
  const ev = baseEvent(game, live, 'manual_adjustment', {
    addOuts: count,
    notes: notes || (count === 2 ? 'Double play' : count === 3 ? 'Triple play' : '+1 out'),
    clearPending: true,
    resetCount: true,
  });
  return touchUpdated({ ...game, events: [...(game.events || []), ev] });
}

/**
 * Set inning / half / outs for when a pitcher enters mid-game.
 * Does NOT pad outsRecorded / IP.
 */
export function setGameSituation(game, { inning, half, outs, notes = null } = {}) {
  const live = deriveLiveState(game);
  const ev = baseEvent(game, live, 'manual_adjustment', {
    setInning: inning != null ? Math.max(1, inning | 0) : live.inning,
    setHalf: half === 'bottom' || half === 'top' ? half : live.half,
    setOuts: outs != null ? Math.max(0, Math.min(2, outs | 0)) : live.outs,
    notes: notes || 'Set game situation',
  });
  return touchUpdated({ ...game, events: [...(game.events || []), ev] });
}

export function changePitcher(game, pitcherName) {
  const name = String(pitcherName || '').trim();
  if (!name) throw new Error('Pitcher name required');
  const live = deriveLiveState(game);
  const ev = baseEvent(game, live, 'pitcher_change', {
    pitcherName: name,
    notes: `Pitching change: ${name}`,
  });
  return touchUpdated({
    ...game,
    pitcher: name,
    events: [...(game.events || []), ev],
  });
}

function reverseRunsForEvent(game, removed) {
  let next = game;
  if (
    removed.type === 'plate_appearance_result' &&
    typeof removed.runsOnPlay === 'number' &&
    removed.runsOnPlay > 0
  ) {
    if (removed.half === 'top') {
      next = { ...next, awayScore: Math.max(0, (next.awayScore | 0) - removed.runsOnPlay) };
    } else {
      next = { ...next, homeScore: Math.max(0, (next.homeScore | 0) - removed.runsOnPlay) };
    }
  }
  return next;
}

function resequence(events) {
  return events.map((ev, i) => ({ ...ev, sequence: i + 1 }));
}

/** Undo the tip of the log — a full pitch (incl. zone) or whatever last event was. */
export function undoLast(game) {
  const events = game.events || [];
  if (!events.length) return game;
  const removed = events[events.length - 1];
  let next = { ...game, events: events.slice(0, -1) };
  next = reverseRunsForEvent(next, removed);
  return touchUpdated(next);
}

/**
 * Undo the entire current/last at-bat: PA result (if any) plus its pitches.
 * Harder-to-reach corrective action.
 */
export function undoLastAtBat(game) {
  const events = [...(game.events || [])];
  if (!events.length) return game;

  let i = events.length - 1;
  // Skip trailing non-PA noise (outs / situation) only if we haven't hit PA/pitch yet? 
  // Prefer: find last PA or last pitch group.
  while (i >= 0 && events[i].type !== 'plate_appearance_result' && events[i].type !== 'pitch') {
    i -= 1;
  }
  if (i < 0) return undoLast(game);

  let removed = [];
  if (events[i].type === 'plate_appearance_result') {
    const batter = events[i].batterSequence;
    const cut = [];
    // remove PA and preceding pitches for same batterSequence
    let j = i;
    while (j >= 0) {
      const ev = events[j];
      if (ev.type === 'plate_appearance_result' && ev.batterSequence === batter && j === i) {
        cut.push(ev);
        j -= 1;
        continue;
      }
      if (ev.type === 'pitch' && ev.batterSequence === batter) {
        cut.push(ev);
        j -= 1;
        continue;
      }
      break;
    }
    removed = cut;
    const keep = [...events.slice(0, j + 1), ...events.slice(i + 1)];
    let next = { ...game, events: resequence(keep) };
    for (const r of removed) next = reverseRunsForEvent(next, r);
    return touchUpdated(next);
  }

  // No PA yet — remove pitches for current batterSequence only
  const batter = events[i].batterSequence;
  let j = i;
  const cut = [];
  while (j >= 0 && events[j].type === 'pitch' && events[j].batterSequence === batter) {
    cut.push(events[j]);
    j -= 1;
  }
  const keep = [...events.slice(0, j + 1), ...events.slice(i + 1)];
  return touchUpdated({ ...game, events: resequence(keep) });
}

/**
 * Delete a single event by id. Later events stay; live totals re-derive.
 * Does not rewrite other batters' stored outcomes.
 */
export function deleteEventById(game, eventId) {
  const events = game.events || [];
  const idx = events.findIndex((e) => e.id === eventId);
  if (idx < 0) return game;
  const removed = events[idx];
  const keep = events.filter((e) => e.id !== eventId);
  let next = { ...game, events: resequence(keep) };
  next = reverseRunsForEvent(next, removed);
  return touchUpdated(next);
}

export function updateMeta(game, patch) {
  const allowed = [
    'homeTeam',
    'awayTeam',
    'homeScore',
    'awayScore',
    'pitcher',
    'date',
    'status',
  ];
  const next = { ...game };
  for (const key of allowed) {
    if (key in patch) next[key] = patch[key];
  }
  return touchUpdated(next);
}

/** Migrate legacy flat localStorage keys into a v2 game, or return null. */
export function migrateLegacyLocalStorage(getItem) {
  const has =
    getItem('ts') != null ||
    getItem('tb') != null ||
    getItem('s') != null ||
    getItem('b') != null ||
    getItem('so') != null ||
    getItem('bb') != null;
  if (!has) return null;

  const ts = parseInt(getItem('ts'), 10) || 0;
  const tb = parseInt(getItem('tb'), 10) || 0;
  const h = parseInt(getItem('h'), 10) || 0;
  const so = parseInt(getItem('so'), 10) || 0;
  const bb = parseInt(getItem('bb'), 10) || 0;
  const ip = parseFloat(getItem('ip')) || 0;
  const homeTeam = getItem('homeTeam') || '';
  const awayTeam = getItem('awayTeam') || '';
  const homeScore = parseInt(getItem('homeScore'), 10) || 0;
  const awayScore = parseInt(getItem('awayScore'), 10) || 0;

  // Approximate outs from old float IP (0.33 ≈ 1 out)
  const outsRecorded = Math.round(ip / 0.33);

  const events = [];
  let seq = 0;
  const push = (partial) => {
    seq += 1;
    events.push({
      id: uid('legacy'),
      sequence: seq,
      timestamp: new Date().toISOString(),
      inning: 1,
      half: 'top',
      batterSequence: 1,
      pitchResult: null,
      pitchType: null,
      location: null,
      paOutcome: null,
      outsOnPlay: null,
      runsOnPlay: null,
      notes: 'Migrated from legacy totals (approximate)',
      ...partial,
    });
  };

  for (let i = 0; i < tb; i += 1) push({ type: 'pitch', pitchResult: 'ball' });
  for (let i = 0; i < ts; i += 1) push({ type: 'pitch', pitchResult: 'called_strike' });
  for (let i = 0; i < so; i += 1) {
    push({ type: 'plate_appearance_result', paOutcome: 'strikeout', outsOnPlay: 1 });
  }
  for (let i = 0; i < bb; i += 1) {
    push({ type: 'plate_appearance_result', paOutcome: 'walk', outsOnPlay: 0 });
  }
  for (let i = 0; i < h; i += 1) {
    push({ type: 'plate_appearance_result', paOutcome: 'single', outsOnPlay: 0 });
  }

  // Pad outs if IP implied more outs than strikeouts produced
  const outsFromSo = so;
  const missingOuts = Math.max(0, outsRecorded - outsFromSo);
  for (let i = 0; i < missingOuts; i += 1) {
    push({ type: 'plate_appearance_result', paOutcome: 'out', outsOnPlay: 1 });
  }

  return createGame({
    homeTeam,
    awayTeam,
    homeScore,
    awayScore,
    pitcher: '',
    events,
    notes: 'Imported from Pitch Tracker v1 aggregate counters',
  });
}

export function loadGameFromStorage(raw) {
  if (!raw) return null;
  let data;
  try {
    data = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (!Array.isArray(data.events)) data.events = [];
  data.schemaVersion = data.schemaVersion || SCHEMA_VERSION;
  return data;
}

/* ─── CSV helpers ─── */

export function escapeCsvCell(value) {
  if (value == null) return '';
  const s = String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function toCsv(rows) {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

/** Backward-compatible two-column summary (legacy concepts preserved). */
export function buildSummaryCsv(game) {
  const stats = deriveStats(game);
  const hTeam = game.homeTeam || 'Home';
  const aTeam = game.awayTeam || 'Away';
  const rows = [
    ['Teams', `${hTeam} vs ${aTeam}`],
    ['Score', `${game.homeScore | 0} - ${game.awayScore | 0}`],
    ['Stat', 'Value'],
    ['Total Strikes', stats.totalStrikes],
    ['Total Balls', stats.totalBalls],
    ['Hits', stats.hits],
    ['Innings', stats.inningsPitched],
    ['Strikeouts', stats.strikeouts],
    ['Walks', stats.walks],
    // Additive rows (safe for readers that only use known keys)
    ['Pitcher', game.pitcher || ''],
    ['Total Pitches', stats.totalPitches],
    ['Hit By Pitch', stats.hbp],
    ['Batters Faced', stats.battersFaced],
    ['Runs', stats.hasAnyRunsLogged ? stats.runsAllowed : ''],
    ['Date', game.date || ''],
  ];
  return toCsv(rows);
}

export const DETAIL_CSV_HEADERS = [
  'gameId',
  'date',
  'pitcher',
  'homeTeam',
  'awayTeam',
  'homeScore',
  'awayScore',
  'sequence',
  'timestamp',
  'inning',
  'half',
  'batterSequence',
  'eventPitcher',
  'type',
  'pitchResult',
  'pitchType',
  'location',
  'locationLabel',
  'paOutcome',
  'outsOnPlay',
  'runsOnPlay',
  'notes',
];

export function buildDetailCsv(game) {
  const rows = [DETAIL_CSV_HEADERS];
  for (const ev of game.events || []) {
    rows.push([
      game.id,
      game.date,
      game.pitcher,
      game.homeTeam,
      game.awayTeam,
      game.homeScore,
      game.awayScore,
      ev.sequence,
      ev.timestamp,
      ev.inning,
      ev.half,
      ev.batterSequence,
      ev.pitcherName || game.pitcher || '',
      ev.type,
      ev.pitchResult || '',
      ev.pitchType || '',
      ev.location || '',
      ev.location ? ZONE_BY_ID[ev.location]?.label || '' : '',
      ev.paOutcome || '',
      ev.outsOnPlay == null ? '' : ev.outsOnPlay,
      ev.runsOnPlay == null ? '' : ev.runsOnPlay,
      ev.notes || '',
    ]);
  }
  return toCsv(rows);
}

export function buildJsonBackup(game) {
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      exportedAt: new Date().toISOString(),
      game,
    },
    null,
    2
  );
}

export function parseJsonBackup(text) {
  const data = JSON.parse(text);
  const game = data.game || data;
  if (!game || !Array.isArray(game.events)) {
    throw new Error('Invalid backup: missing game.events');
  }
  if (game.schemaVersion && game.schemaVersion > SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version ${game.schemaVersion}`);
  }
  return game;
}

/** Per-inning pitch counts for a simple split view. */
export function perInningSplits(game) {
  const map = new Map();
  for (const ev of game.events || []) {
    if (ev.type !== 'pitch') continue;
    const key = `${ev.inning}-${ev.half}`;
    if (!map.has(key)) {
      map.set(key, {
        inning: ev.inning,
        half: ev.half,
        pitches: 0,
        balls: 0,
        strikes: 0,
      });
    }
    const row = map.get(key);
    row.pitches += 1;
    if (ev.pitchResult === 'ball') row.balls += 1;
    if (
      ev.pitchResult === 'called_strike' ||
      ev.pitchResult === 'swinging_strike' ||
      ev.pitchResult === 'foul'
    ) {
      row.strikes += 1;
    }
  }
  return [...map.values()];
}

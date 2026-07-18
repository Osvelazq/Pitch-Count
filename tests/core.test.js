import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createGame,
  appendPitch,
  appendPaResult,
  setLastPitchLocation,
  undoLast,
  deriveStats,
  deriveLiveState,
  formatInningsPitched,
  zoneInsights,
  escapeCsvCell,
  toCsv,
  buildSummaryCsv,
  buildDetailCsv,
  migrateLegacyLocalStorage,
  parseJsonBackup,
  buildJsonBackup,
} from '../js/core.js';

test('formatInningsPitched uses outs notation', () => {
  assert.equal(formatInningsPitched(0), '0.0');
  assert.equal(formatInningsPitched(1), '0.1');
  assert.equal(formatInningsPitched(2), '0.2');
  assert.equal(formatInningsPitched(3), '1.0');
  assert.equal(formatInningsPitched(5), '1.2');
});

test('count and two-strike foul', () => {
  let g = createGame();
  g = appendPitch(g, { pitchResult: 'called_strike' });
  g = appendPitch(g, { pitchResult: 'called_strike' });
  g = appendPitch(g, { pitchResult: 'foul' });
  let live = deriveLiveState(g);
  assert.equal(live.strikes, 2);
  assert.equal(live.balls, 0);
  g = appendPitch(g, { pitchResult: 'foul' });
  live = deriveLiveState(g);
  assert.equal(live.strikes, 2);
});

test('third strike suggests strikeout; PA must be explicit', () => {
  let g = createGame();
  g = appendPitch(g, { pitchResult: 'swinging_strike' });
  g = appendPitch(g, { pitchResult: 'swinging_strike' });
  g = appendPitch(g, { pitchResult: 'swinging_strike' });
  let live = deriveLiveState(g);
  assert.equal(live.pendingPa, 'strikeout');
  assert.throws(() => appendPitch(g, { pitchResult: 'ball' }));
  g = appendPaResult(g, { paOutcome: 'strikeout' });
  live = deriveLiveState(g);
  assert.equal(live.pendingPa, null);
  assert.equal(live.outs, 1);
  assert.equal(deriveStats(g).strikeouts, 1);
  assert.equal(deriveStats(g).inningsPitched, '0.1');
});

test('walk pending and ball count', () => {
  let g = createGame();
  for (let i = 0; i < 4; i += 1) g = appendPitch(g, { pitchResult: 'ball' });
  assert.equal(deriveLiveState(g).pendingPa, 'walk');
  g = appendPaResult(g, { paOutcome: 'walk' });
  assert.equal(deriveStats(g).walks, 1);
  assert.equal(deriveLiveState(g).balls, 0);
});

test('in play then hit; undo restores', () => {
  let g = createGame();
  g = appendPitch(g, { pitchResult: 'in_play' });
  assert.equal(deriveLiveState(g).pendingPa, 'in_play');
  g = appendPaResult(g, { paOutcome: 'single', runsOnPlay: 1 });
  assert.equal(deriveStats(g).hits, 1);
  assert.equal(g.awayScore, 1); // top of 1st
  g = undoLast(g);
  assert.equal(g.awayScore, 0);
  assert.equal(deriveLiveState(g).pendingPa, 'in_play');
});

test('zone insight phrase for low outside balls', () => {
  let g = createGame();
  g = appendPitch(g, { pitchResult: 'ball' });
  g = setLastPitchLocation(g, 'LO_OUT');
  g = appendPitch(g, { pitchResult: 'ball' });
  g = setLastPitchLocation(g, 'LO_OUT');
  g = appendPitch(g, { pitchResult: 'ball' });
  g = setLastPitchLocation(g, 'HI');
  const insights = zoneInsights(g);
  assert.ok(insights.ballTop);
  assert.equal(insights.ballTop.location, 'LO_OUT');
  assert.match(insights.ballTop.phrase, /low outside/i);
});

test('csv escaping', () => {
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
  assert.equal(escapeCsvCell('say "hi"'), '"say ""hi"""');
  assert.equal(toCsv([['a', 'b'], ['c', 'd']]), 'a,b\r\nc,d');
});

test('summary csv keeps legacy rows', () => {
  let g = createGame({ homeTeam: 'A', awayTeam: 'B, C', homeScore: 2, awayScore: 1 });
  g = appendPitch(g, { pitchResult: 'called_strike' });
  g = appendPitch(g, { pitchResult: 'ball' });
  const csv = buildSummaryCsv(g);
  assert.match(csv, /Teams,"A vs B, C"/);
  assert.match(csv, /Total Strikes,1/);
  assert.match(csv, /Total Balls,1/);
  assert.match(csv, /Strikeouts,0/);
  assert.match(csv, /Walks,0/);
});

test('detail csv one row per event', () => {
  let g = createGame({ pitcher: 'Sam' });
  g = appendPitch(g, { pitchResult: 'ball', location: 'LO_OUT' });
  const csv = buildDetailCsv(g);
  const lines = csv.trim().split(/\r?\n/);
  assert.equal(lines.length, 2);
  assert.match(lines[1], /ball/);
  assert.match(lines[1], /LO_OUT/);
  assert.match(lines[1], /Low Out/);
});

test('legacy migration and json roundtrip', () => {
  const store = {
    ts: '5',
    tb: '3',
    so: '1',
    bb: '1',
    h: '1',
    ip: '0.66',
    homeTeam: 'Home',
    awayTeam: 'Away',
    homeScore: '2',
    awayScore: '0',
  };
  const g = migrateLegacyLocalStorage((k) => store[k] ?? null);
  assert.ok(g);
  assert.equal(g.homeTeam, 'Home');
  const json = buildJsonBackup(g);
  const back = parseJsonBackup(json);
  assert.equal(back.events.length, g.events.length);
});

test('three outs advance half-inning', () => {
  let g = createGame();
  for (let i = 0; i < 3; i += 1) {
    g = appendPitch(g, { pitchResult: 'swinging_strike' });
    g = appendPitch(g, { pitchResult: 'swinging_strike' });
    g = appendPitch(g, { pitchResult: 'swinging_strike' });
    g = appendPaResult(g, { paOutcome: 'strikeout' });
  }
  const live = deriveLiveState(g);
  assert.equal(live.outs, 0);
  assert.equal(live.half, 'bottom');
  assert.equal(live.inning, 1);
  assert.equal(deriveStats(g).inningsPitched, '1.0');
});

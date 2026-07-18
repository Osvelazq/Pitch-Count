import {
  THEME_KEY,
  STORAGE_KEY,
  ZONES,
  PA_OUTCOMES,
  PITCH_TYPES,
  createGame,
  deriveStats,
  deriveLiveState,
  zoneInsights,
  lastEvent,
  describeEvent,
  appendPitch,
  setLastPitchLocation,
  setLastPitchType,
  appendPaResult,
  undoLast,
  updateMeta,
  migrateLegacyLocalStorage,
  loadGameFromStorage,
  buildSummaryCsv,
  buildDetailCsv,
  buildJsonBackup,
  parseJsonBackup,
  perInningSplits,
} from './core.js';

const DEFAULT_THEME = {
  accent: '#2f5d50',
  ball: '#2f6b3a',
  strike: '#8b3a2f',
};

let game = null;
let runsForNextPa = 0;
let detailPitchType = null;
let tapLockUntil = 0;

const $ = (id) => document.getElementById(id);

function applyTheme(theme) {
  const t = { ...DEFAULT_THEME, ...theme };
  document.documentElement.style.setProperty('--accent', t.accent);
  document.documentElement.style.setProperty('--ball', t.ball);
  document.documentElement.style.setProperty('--strike', t.strike);
  $('themeAccent').value = t.accent;
  $('themeBall').value = t.ball;
  $('themeStrike').value = t.strike;
}

function loadTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw) return { ...DEFAULT_THEME, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_THEME };
}

function saveTheme(theme) {
  localStorage.setItem(THEME_KEY, JSON.stringify(theme));
  applyTheme(theme);
}

function persist() {
  if (!game) return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(game));
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function flash(msg) {
  const el = $('flash');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(flash._t);
  flash._t = setTimeout(() => el.classList.remove('show'), 700);
}

function canTap() {
  return Date.now() >= tapLockUntil;
}

function lockTap(ms = 180) {
  tapLockUntil = Date.now() + ms;
}

function openSheet(id) {
  $(id).classList.add('open');
}

function closeSheet(id) {
  $(id).classList.remove('open');
}

function syncMetaInputs() {
  $('pitcher').value = game.pitcher || '';
  $('homeTeam').value = game.homeTeam || '';
  $('awayTeam').value = game.awayTeam || '';
  $('homeScore').value = game.homeScore ?? 0;
  $('awayScore').value = game.awayScore ?? 0;
}

function render() {
  const stats = deriveStats(game);
  const live = deriveLiveState(game);
  const last = lastEvent(game);

  $('countBalls').textContent = live.balls;
  $('countStrikes').textContent = live.strikes;
  $('inningVal').textContent = `${live.inning}${live.half === 'top' ? '▲' : '▼'}`;
  $('pitchTotal').textContent = stats.totalPitches;
  $('ipVal').textContent = stats.inningsPitched;

  const dots = $('outsDots');
  dots.innerHTML = '';
  for (let i = 0; i < 3; i += 1) {
    const s = document.createElement('span');
    if (i < live.outs) s.classList.add('on');
    dots.appendChild(s);
  }

  $('homeName').textContent = game.homeTeam || 'Home';
  $('awayName').textContent = game.awayTeam || 'Away';
  $('homeRuns').textContent = game.homeScore ?? 0;
  $('awayRuns').textContent = game.awayScore ?? 0;
  $('lastEvent').textContent = describeEvent(last);

  $('statPitches').textContent = stats.totalPitches;
  $('statStrikePct').textContent = stats.strikePct == null ? '—' : `${stats.strikePct}%`;
  $('statFpStrike').textContent =
    stats.firstPitchStrikePct == null ? '—' : `${stats.firstPitchStrikePct}%`;
  $('statK').textContent = stats.strikeouts;
  $('statBb').textContent = stats.walks;
  $('statHbp').textContent = stats.hbp;
  $('statHits').textContent = stats.hits;
  $('statBf').textContent = stats.battersFaced;
  $('statIp').textContent = stats.inningsPitched;
  $('statRuns').textContent = stats.hasAnyRunsLogged ? stats.runsAllowed : '— (optional)';

  const insights = zoneInsights(game);
  const box = $('insightBox');
  if (!insights.locatedCount) {
    box.innerHTML =
      '<div class="insight">No locations yet. After a pitch, tap a zone when you saw it clearly — skip when you didn’t.</div>';
  } else {
    const lines = insights.phrases.length
      ? insights.phrases
      : [`${insights.locatedCount} pitches located`];
    box.innerHTML = lines.map((p) => `<div class="insight">${p}</div>`).join('');
  }

  const splits = perInningSplits(game);
  $('inningSplits').innerHTML = splits.length
    ? splits
        .map(
          (s) =>
            `<div><span class="label">${s.inning}${s.half === 'top' ? '▲' : '▼'}</span><span>${s.pitches} P · ${s.balls} B · ${s.strikes} S</span></div>`
        )
        .join('')
    : '<div><span class="label">Innings</span><span>—</span></div>';

  const log = $('eventLog');
  const events = [...(game.events || [])].reverse().slice(0, 40);
  log.innerHTML = events.length
    ? `<ul>${events
        .map(
          (ev) =>
            `<li>#${ev.sequence} · ${ev.inning}${ev.half === 'top' ? '▲' : '▼'} · ${describeEvent(ev)}</li>`
        )
        .join('')}</ul>`
    : '<p class="hint">No events yet.</p>';

  const pending = live.pendingPa;
  const pendingEl = $('pendingPanel');
  const forceShow = pendingEl.dataset.force === '1';
  if (pending || forceShow) {
    pendingEl.classList.add('show');
    const titles = {
      strikeout: '3 strikes — confirm outcome',
      walk: '4 balls — confirm outcome',
      in_play: 'Ball in play — pick result',
    };
    $('pendingTitle').textContent = pending
      ? titles[pending] || 'Plate appearance result'
      : 'End plate appearance';
    highlightSuggested(pending);
  } else {
    pendingEl.classList.remove('show');
  }

  const blocked = Boolean(pending);
  document.querySelectorAll('[data-pitch]').forEach((btn) => {
    btn.disabled = blocked;
  });
  $('undoBtn').disabled = !(game.events && game.events.length);

  $('runsOut').textContent = String(runsForNextPa);
}

function highlightSuggested(pending) {
  document.querySelectorAll('[data-pa]').forEach((btn) => {
    btn.classList.toggle(
      'primary',
      (pending === 'strikeout' && btn.dataset.pa === 'strikeout') ||
        (pending === 'walk' && btn.dataset.pa === 'walk') ||
        (pending === 'in_play' && btn.dataset.pa === 'out')
    );
  });
}

function afterPitch(label) {
  flash(label);
  render();
  persist();
  openSheet('zoneSheet');
  detailPitchType = null;
  document.querySelectorAll('#typeRow button').forEach((b) => b.classList.remove('active'));
}

function onPitch(result) {
  if (!canTap()) return;
  lockTap();
  try {
    game = appendPitch(game, { pitchResult: result });
    const labels = {
      ball: 'Ball',
      called_strike: 'Called strike',
      swinging_strike: 'Swinging strike',
      foul: 'Foul',
      in_play: 'In play',
      unknown: 'Unknown pitch',
    };
    afterPitch(labels[result] || result);
  } catch (err) {
    flash(err.message || 'Could not log pitch');
  }
}

function onPa(outcome) {
  if (!canTap()) return;
  lockTap();
  try {
    const outsDefault = PA_OUTCOMES[outcome]?.defaultOuts ?? 0;
    game = appendPaResult(game, {
      paOutcome: outcome,
      outsOnPlay: outsDefault,
      runsOnPlay: runsForNextPa > 0 ? runsForNextPa : null,
    });
    runsForNextPa = 0;
    $('pendingPanel').dataset.force = '';
    flash(PA_OUTCOMES[outcome]?.short || outcome);
    render();
    persist();
  } catch (err) {
    flash(err.message || 'Could not log result');
  }
}

function wire() {
  document.querySelectorAll('[data-pitch]').forEach((btn) => {
    btn.addEventListener('click', () => onPitch(btn.dataset.pitch));
  });

  document.querySelectorAll('[data-pa]').forEach((btn) => {
    btn.addEventListener('click', () => onPa(btn.dataset.pa));
  });

  $('runsMinus').addEventListener('click', () => {
    runsForNextPa = Math.max(0, runsForNextPa - 1);
    $('runsOut').textContent = String(runsForNextPa);
  });
  $('runsPlus').addEventListener('click', () => {
    runsForNextPa = Math.min(20, runsForNextPa + 1);
    $('runsOut').textContent = String(runsForNextPa);
  });

  $('undoBtn').addEventListener('click', () => {
    if (!canTap()) return;
    lockTap();
    game = undoLast(game);
    flash('Undone');
    render();
    persist();
  });

  $('menuBtn').addEventListener('click', () => openSheet('menuSheet'));
  $('menuBtn2').addEventListener('click', () => openSheet('menuSheet'));
  $('statsBtn').addEventListener('click', () => {
    render();
    openSheet('statsSheet');
  });
  $('locateBtn').addEventListener('click', () => openSheet('zoneSheet'));
  $('endAbBtn').addEventListener('click', () => {
    $('pendingPanel').dataset.force = '1';
    render();
    $('pendingPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeSheet(btn.dataset.close));
  });

  const zoneGrid = $('zoneGrid');
  ZONES.forEach((z) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = z.label;
    b.className = z.id === 'MID' ? 'heart' : z.col !== 'middle' || z.row !== 'middle' ? 'edge' : '';
    b.addEventListener('click', () => {
      game = setLastPitchLocation(game, z.id);
      if (detailPitchType) game = setLastPitchType(game, detailPitchType);
      flash(z.label);
      closeSheet('zoneSheet');
      render();
      persist();
    });
    zoneGrid.appendChild(b);
  });

  $('zoneSkip').addEventListener('click', () => {
    if (detailPitchType) {
      game = setLastPitchType(game, detailPitchType);
      persist();
    }
    closeSheet('zoneSheet');
    render();
  });

  const typeRow = $('typeRow');
  PITCH_TYPES.forEach((t) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = t.label;
    b.dataset.type = t.id;
    b.addEventListener('click', () => {
      detailPitchType = t.id;
      typeRow.querySelectorAll('button').forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
    });
    typeRow.appendChild(b);
  });

  const metaIds = ['pitcher', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore'];
  metaIds.forEach((id) => {
    $(id).addEventListener('change', () => {
      const patch = {
        pitcher: $('pitcher').value,
        homeTeam: $('homeTeam').value,
        awayTeam: $('awayTeam').value,
        homeScore: parseInt($('homeScore').value, 10) || 0,
        awayScore: parseInt($('awayScore').value, 10) || 0,
      };
      game = updateMeta(game, patch);
      render();
      persist();
    });
  });

  $('exportSummary').addEventListener('click', () => {
    const name = `pitch_summary_${game.date || 'game'}.csv`;
    downloadText(name, buildSummaryCsv(game), 'text/csv;charset=utf-8');
    flash('Summary CSV');
  });
  $('exportDetail').addEventListener('click', () => {
    const name = `pitch_events_${game.date || 'game'}.csv`;
    downloadText(name, buildDetailCsv(game), 'text/csv;charset=utf-8');
    flash('Detail CSV');
  });
  $('exportJson').addEventListener('click', () => {
    const name = `pitch_backup_${game.date || 'game'}.json`;
    downloadText(name, buildJsonBackup(game), 'application/json;charset=utf-8');
    flash('JSON backup');
  });

  $('importJson').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const text = await file.text();
      const imported = parseJsonBackup(text);
      const ok = confirm(
        `Import game from ${imported.date || 'backup'} with ${imported.events?.length || 0} events? This replaces the current game.`
      );
      if (!ok) return;
      game = imported;
      syncMetaInputs();
      render();
      persist();
      flash('Imported');
      closeSheet('menuSheet');
    } catch (err) {
      alert(err.message || 'Import failed');
    }
  });

  $('resetGame').addEventListener('click', () => {
    if (!confirm('Reset this game? Export first if you need the data.')) return;
    if (!confirm('Really erase the active game?')) return;
    game = createGame();
    runsForNextPa = 0;
    syncMetaInputs();
    render();
    persist();
    flash('Reset');
    closeSheet('menuSheet');
  });

  $('themeAccent').addEventListener('input', () => {
    saveTheme({
      accent: $('themeAccent').value,
      ball: $('themeBall').value,
      strike: $('themeStrike').value,
    });
  });
  $('themeBall').addEventListener('input', () => {
    saveTheme({
      accent: $('themeAccent').value,
      ball: $('themeBall').value,
      strike: $('themeStrike').value,
    });
  });
  $('themeStrike').addEventListener('input', () => {
    saveTheme({
      accent: $('themeAccent').value,
      ball: $('themeBall').value,
      strike: $('themeStrike').value,
    });
  });
  $('themeReset').addEventListener('click', () => saveTheme({ ...DEFAULT_THEME }));
}

function boot() {
  applyTheme(loadTheme());

  const existing = loadGameFromStorage(localStorage.getItem(STORAGE_KEY));
  if (existing) {
    game = existing;
  } else {
    const legacy = migrateLegacyLocalStorage((k) => localStorage.getItem(k));
    if (legacy) {
      game = legacy;
      persist();
      // Clear legacy flat keys so we don't remigrate duplicates
      ['s', 'b', 'ts', 'tb', 'h', 'ip', 'so', 'bb', 'homeTeam', 'awayTeam', 'homeScore', 'awayScore'].forEach(
        (k) => localStorage.removeItem(k)
      );
    } else {
      game = createGame();
    }
  }

  wire();
  syncMetaInputs();
  render();
  persist();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}

boot();

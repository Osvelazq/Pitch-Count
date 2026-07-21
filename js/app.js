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
  addRecordedOuts,
  setGameSituation,
  changePitcher,
  undoLast,
  undoLastAtBat,
  deleteEventById,
  updateMeta,
  migrateLegacyLocalStorage,
  loadGameFromStorage,
  buildSummaryCsv,
  buildDetailCsv,
  buildJsonBackup,
  parseJsonBackup,
  perInningSplits,
} from './core.js';

const SETTINGS_KEY = 'pitchTracker.settings';

const DEFAULT_THEME = {
  accent: '#2f5d50',
  ball: '#2f6b3a',
  strike: '#8b3a2f',
};

const DEFAULT_SETTINGS = {
  simpleMode: false,
  autoConfirmKbb: false,
};

let game = null;
let settings = { ...DEFAULT_SETTINGS };
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

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(next) {
  settings = { ...settings, ...next };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  applySettingsUi();
}

function applySettingsUi() {
  document.body.classList.toggle('simple-mode', Boolean(settings.simpleMode));
  $('simpleToggle').setAttribute('aria-pressed', settings.simpleMode ? 'true' : 'false');
  $('simpleToggle').textContent = settings.simpleMode ? 'Simple ✓' : 'Simple';
  $('settingSimple').checked = Boolean(settings.simpleMode);
  $('settingAutoKbb').checked = Boolean(settings.autoConfirmKbb);
  $('modeHint').textContent = settings.simpleMode ? 'Simple mode' : 'Live track';
  $('locateBtn').hidden = Boolean(settings.simpleMode);
}

function updateSetupSummary() {
  const p = game.pitcher || 'No pitcher';
  const h = game.homeTeam || 'Home';
  const a = game.awayTeam || 'Away';
  $('setupSummary').textContent = `${p} · ${h} ${game.homeScore ?? 0}–${game.awayScore ?? 0} ${a}`;
}

function hideOutsChooser() {
  const chooser = $('outsChooser');
  if (chooser) chooser.hidden = true;
  const grid = $('paGrid');
  if (grid) grid.hidden = false;
}

function showOutsChooser() {
  $('outsChooser').hidden = false;
  $('paGrid').hidden = true;
  $('pendingHint').textContent = 'Out recorded on the play — choose how many outs.';
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

function renderEventLog() {
  const log = $('eventLog');
  const events = [...(game.events || [])].reverse().slice(0, 60);
  if (!events.length) {
    log.innerHTML = '<p class="hint">No events yet.</p>';
    return;
  }
  log.innerHTML = events
    .map(
      (ev) => `<div class="ev-row" data-id="${ev.id}">
        <div class="meta">#${ev.sequence} · ${ev.inning}${ev.half === 'top' ? '▲' : '▼'} · ${describeEvent(ev)}</div>
        <button type="button" data-delete="${ev.id}">Delete</button>
      </div>`
    )
    .join('');
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
  $('activePitcherLabel').textContent = live.currentPitcher || game.pitcher || '—';

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
  updateSetupSummary();

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
      '<div class="insight">No locations yet. Tap Zone after a pitch when you saw it clearly.</div>';
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

  renderEventLog();

  const pending = live.pendingPa;
  const pendingEl = $('pendingPanel');
  const forceShow = pendingEl.dataset.force === '1';
  const choosingOuts = !$('outsChooser').hidden;
  if (pending || forceShow || choosingOuts) {
    pendingEl.classList.add('show');
    const titles = {
      strikeout: '3 strikes — confirm',
      walk: '4 balls — confirm',
      in_play: 'Ball in play — result',
    };
    const hints = {
      strikeout: 'Usually a strikeout. Change if needed.',
      walk: 'Usually a walk. Change if needed.',
      in_play: 'Hit, out, error, or something else?',
    };
    if (choosingOuts) {
      $('pendingTitle').textContent = 'Outs on the play';
    } else {
      $('pendingTitle').textContent = pending
        ? titles[pending] || 'Result needed'
        : 'End at-bat';
      $('pendingHint').textContent = pending
        ? hints[pending] || 'Pick how the at-bat ended.'
        : 'Pick how the at-bat ended.';
    }
    if (!choosingOuts) highlightSuggested(pending);
  } else {
    pendingEl.classList.remove('show');
    hideOutsChooser();
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
  // Zone is opt-in only — never auto-open (especially not in simple mode)
  detailPitchType = null;
  document.querySelectorAll('#typeRow button').forEach((b) => b.classList.remove('active'));
}

function maybeAutoConfirm() {
  if (!settings.autoConfirmKbb) return false;
  const live = deriveLiveState(game);
  if (live.pendingPa === 'strikeout') {
    game = appendPaResult(game, { paOutcome: 'strikeout' });
    flash('K');
    return true;
  }
  if (live.pendingPa === 'walk') {
    game = appendPaResult(game, { paOutcome: 'walk' });
    flash('BB');
    return true;
  }
  return false;
}

function onPitch(result) {
  if (!canTap()) return;
  lockTap();
  try {
    game = appendPitch(game, { pitchResult: result });
    const labels = {
      ball: 'Ball',
      called_strike: 'Called',
      swinging_strike: 'Swing',
      foul: 'Foul',
      in_play: 'In play',
      unknown: "Didn't see",
    };
    if (maybeAutoConfirm()) {
      hideOutsChooser();
      render();
      persist();
      return;
    }
    afterPitch(labels[result] || result);
  } catch (err) {
    flash(err.message || 'Could not log pitch');
  }
}

function onPa(outcome, outsOverride = null) {
  if (!canTap()) return;

  // Out needs an outs-count step (1 / 2 / 3) instead of a cryptic DP button
  if (outcome === 'out' && outsOverride == null) {
    $('pendingPanel').dataset.force = '1';
    $('pendingPanel').classList.add('show');
    showOutsChooser();
    return;
  }

  lockTap();
  try {
    const outsDefault =
      outsOverride != null ? outsOverride : PA_OUTCOMES[outcome]?.defaultOuts ?? 0;
    game = appendPaResult(game, {
      paOutcome: outcome,
      outsOnPlay: outsDefault,
      runsOnPlay: runsForNextPa > 0 ? runsForNextPa : null,
    });
    runsForNextPa = 0;
    $('pendingPanel').dataset.force = '';
    hideOutsChooser();
    const flashLabel =
      outcome === 'out' && outsOverride
        ? `${outsOverride} out${outsOverride === 1 ? '' : 's'}`
        : PA_OUTCOMES[outcome]?.short || outcome;
    flash(flashLabel);
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
    btn.addEventListener('click', () => {
      const outs = btn.dataset.outs != null ? parseInt(btn.dataset.outs, 10) : null;
      onPa(btn.dataset.pa, outs);
    });
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
    closeSheet('zoneSheet');
    hideOutsChooser();
    $('pendingPanel').dataset.force = '';
    const prev = lastEvent(game);
    game = undoLast(game);
    flash(prev?.type === 'pitch' ? 'Pitch undone' : 'Undone');
    render();
    persist();
  });

  $('undoAtBatBtn').addEventListener('click', () => {
    if (!confirm('Undo the entire last at-bat (pitches + result)?')) return;
    hideOutsChooser();
    game = undoLastAtBat(game);
    flash('At-bat undone');
    render();
    persist();
  });

  $('plusOutBtn').addEventListener('click', () => {
    if (!canTap()) return;
    lockTap();
    game = addRecordedOuts(game, 1, '+1 out');
    flash('+1 out');
    render();
    persist();
  });

  $('plusTwoOutsBtn').addEventListener('click', () => {
    if (!canTap()) return;
    lockTap();
    game = addRecordedOuts(game, 2, '+2 outs');
    flash('+2 outs');
    render();
    persist();
  });

  document.querySelectorAll('[data-choose-outs]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const n = parseInt(btn.dataset.chooseOuts, 10);
      onPa('out', n);
    });
  });

  $('outsChooserCancel').addEventListener('click', () => {
    hideOutsChooser();
    const live = deriveLiveState(game);
    if (!live.pendingPa) $('pendingPanel').dataset.force = '';
    render();
  });

  $('situationBtn').addEventListener('click', () => {
    const live = deriveLiveState(game);
    $('sitInning').value = live.inning;
    $('sitHalf').value = live.half;
    $('sitOuts').value = String(live.outs);
    openSheet('situationSheet');
  });

  $('sitApply').addEventListener('click', () => {
    game = setGameSituation(game, {
      inning: parseInt($('sitInning').value, 10) || 1,
      half: $('sitHalf').value,
      outs: parseInt($('sitOuts').value, 10) || 0,
    });
    closeSheet('situationSheet');
    flash('Situation set');
    render();
    persist();
  });

  $('changePitcherBtn').addEventListener('click', () => {
    const name = prompt('New pitcher name', game.pitcher || '');
    if (name == null) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      game = changePitcher(game, trimmed);
      $('pitcher').value = trimmed;
      flash(`Now: ${trimmed}`);
      render();
      persist();
    } catch (err) {
      flash(err.message || 'Could not change pitcher');
    }
  });

  $('simpleToggle').addEventListener('click', () => {
    saveSettings({ simpleMode: !settings.simpleMode });
    flash(settings.simpleMode ? 'Simple on' : 'Full mode');
  });
  $('settingSimple').addEventListener('change', () => {
    saveSettings({ simpleMode: $('settingSimple').checked });
  });
  $('settingAutoKbb').addEventListener('change', () => {
    saveSettings({ autoConfirmKbb: $('settingAutoKbb').checked });
  });

  $('menuBtn').addEventListener('click', () => openSheet('menuSheet'));
  $('menuBtn2').addEventListener('click', () => openSheet('menuSheet'));
  $('statsBtn').addEventListener('click', () => {
    render();
    openSheet('statsSheet');
  });
  $('locateBtn').addEventListener('click', () => {
    if (settings.simpleMode) return;
    openSheet('zoneSheet');
  });
  $('endAbBtn').addEventListener('click', () => {
    $('pendingPanel').dataset.force = '1';
    render();
    $('pendingPanel').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => closeSheet(btn.dataset.close));
  });

  $('eventLog').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-delete]');
    if (!btn) return;
    const id = btn.getAttribute('data-delete');
    const ev = (game.events || []).find((x) => x.id === id);
    const label = ev ? describeEvent(ev) : 'this event';
    if (!confirm(`Delete ${label}? Later at-bats stay as logged.`)) return;
    game = deleteEventById(game, id);
    flash('Deleted');
    render();
    persist();
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
      // Name-only edit on pitcher field updates meta without a change event
      game = updateMeta(game, patch);
      render();
      persist();
    });
  });

  $('exportSummary').addEventListener('click', () => {
    downloadText(
      `pitch_summary_${game.date || 'game'}.csv`,
      buildSummaryCsv(game),
      'text/csv;charset=utf-8'
    );
    flash('Summary CSV');
  });
  $('exportDetail').addEventListener('click', () => {
    downloadText(
      `pitch_events_${game.date || 'game'}.csv`,
      buildDetailCsv(game),
      'text/csv;charset=utf-8'
    );
    flash('Detail CSV');
  });
  $('exportJson').addEventListener('click', () => {
    downloadText(
      `pitch_backup_${game.date || 'game'}.json`,
      buildJsonBackup(game),
      'application/json;charset=utf-8'
    );
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

  const themeSave = () =>
    saveTheme({
      accent: $('themeAccent').value,
      ball: $('themeBall').value,
      strike: $('themeStrike').value,
    });
  $('themeAccent').addEventListener('input', themeSave);
  $('themeBall').addEventListener('input', themeSave);
  $('themeStrike').addEventListener('input', themeSave);
  $('themeReset').addEventListener('click', () => saveTheme({ ...DEFAULT_THEME }));
}

function boot() {
  applyTheme(loadTheme());
  settings = loadSettings();
  applySettingsUi();

  const existing = loadGameFromStorage(localStorage.getItem(STORAGE_KEY));
  if (existing) {
    game = existing;
  } else {
    const legacy = migrateLegacyLocalStorage((k) => localStorage.getItem(k));
    if (legacy) {
      game = legacy;
      persist();
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

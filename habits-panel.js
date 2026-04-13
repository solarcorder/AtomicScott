/* ─────────────────────────────────────────
   Atomic Scott — Habit Panel  (Step 3)
   habits-panel.js → global HP object

   Owns everything inside #habitPanel.
   Reads data via AS.* and SE.*.
   No localStorage access. No left-column DOM.
   app.js calls HP.render() / HP.clearPanel().
   ───────────────────────────────────────── */

const HP = (function () {
  'use strict';

  if (typeof AS === 'undefined') throw new Error('[HP] data-layer.js must load first');
  if (typeof SE === 'undefined') throw new Error('[HP] scoring-engine.js must load first');

  /* ── Panel root ─────────────────────────────────────────────────────────── */
  const panel = document.getElementById('habitPanel');
  if (!panel) console.error('[HP] #habitPanel element not found in DOM.');


  /* ══ PUBLIC: clearPanel ════════════════════════════════════════════════════
     Show the empty state. Called on load and when selection is cleared.
  ═══════════════════════════════════════════════════════════════════════════ */
  function clearPanel() {
    panel.innerHTML = `
      <div class="hd-empty">
        <p class="hd-empty__msg">select a habit</p>
      </div>
    `;
  }


  /* ══ PUBLIC: renderUntracked ═══════════════════════════════════════════════
     Placeholder for DOM-only habits that have no AS id.
  ═══════════════════════════════════════════════════════════════════════════ */
  function renderUntracked(name) {
    panel.innerHTML = `
      <div class="hd-empty">
        <p class="hd-empty__msg">${_esc(name)}</p>
        <p class="hd-empty__msg" style="margin-top:6px;font-size:8px;">not tracked by system</p>
      </div>
    `;
  }


  /* ══ PUBLIC: render ════════════════════════════════════════════════════════
     Full detail panel for a given habit id.
     Called by app.js on click-to-select and after restoring UI state.
  ═══════════════════════════════════════════════════════════════════════════ */
  function render(habitId) {
    const habit = AS.getHabitById(habitId);
    if (!habit) { clearPanel(); return; }

    const todayStr = AS.today();
    const log      = AS.getDailyLog(todayStr, habitId);
    const score    = log ? log.score   : null;
    const outcome  = log ? log.outcome : null;

    const block    = _liveBlockPreview(habitId);
    const identity = AS.getHabitIdentityScore(habitId);
    const recovery = identity.recoveryState; // 'normal'|'drift'|'recovery'|'back_on_track'

    // system-core §13.2: hide streak counter during recovery mode
    const hideStreak = (recovery === 'recovery');
    const streak     = hideStreak ? null : AS.getStreak(habitId);

    // ── Score / outcome display ────────────────────────────────────────────
    const scoreText = score !== null
      ? (score > 0 ? '+' + score : String(score))
      : '—';

    const OUTCOME_LABELS = {
      perfect: 'perfect', good: 'good', okay: 'partial',
      poor: 'poor', bad: 'bad', missed: 'skipped', computed: 'logged',
    };
    const outcomeText = outcome ? (OUTCOME_LABELS[outcome] || outcome) : '';

    // ── Button active states ───────────────────────────────────────────────
    // system-core §4.1: Done → good (+7), Partial → okay (+4), Skip → missed (0)
    const doneActive    = outcome === 'good'   ? 'hd-btn--active' : '';
    const partialActive = outcome === 'okay'   ? 'hd-btn--active' : '';
    const skipActive    = outcome === 'missed' ? 'hd-btn--active' : '';

    // ── Recovery messages (system-core §13) ───────────────────────────────
    let recoveryHtml = '';
    if (recovery === 'back_on_track') {
      recoveryHtml = `<p class="hd-inactive-note" style="color:var(--c-text-main)">back on track.</p>`;
      AS.clearBackOnTrack(habitId); // one-time; clear immediately after showing
    } else if (recovery === 'recovery') {
      recoveryHtml = `<p class="hd-inactive-note">just hit growth zone once this block.</p>`;
    } else if (recovery === 'drift') {
      recoveryHtml = `<p class="hd-inactive-note">you're drifting.</p>`;
    }

    // ── Streak display ─────────────────────────────────────────────────────
    const streakText  = hideStreak
      ? '·'
      : (streak > 0 ? streak + (streak !== 1 ? ' days' : ' day') : '—');
    const streakClass = hideStreak ? 'hd-stat hd-stat--hidden' : 'hd-stat';

    // ── Render ─────────────────────────────────────────────────────────────
    panel.innerHTML = `
      <div class="hd-content">

        <div class="hd-meta">
          <span class="hd-pillar-tag">${_esc(habit.pillar)}${habit.subCategory ? ' · ' + _esc(habit.subCategory) : ''}</span>
          <span class="hd-badge ${habit.active ? 'hd-badge--active' : ''}">${habit.active ? 'active' : 'planned'}</span>
        </div>
        <h2 class="hd-name">${_esc(habit.name)}</h2>

        <div class="hd-divider"></div>

        <div>
          <span class="hd-label">today</span>
          <div class="hd-score-row">
            <span class="hd-score-num">${scoreText}</span>
            <span class="hd-outcome-label">${outcomeText}</span>
          </div>
          <div class="hd-btns">
            <button class="hd-btn ${doneActive}"    data-outcome="good">Done</button>
            <button class="hd-btn ${partialActive}" data-outcome="okay">Partial</button>
            <button class="hd-btn ${skipActive}"    data-outcome="missed">Skip</button>
          </div>
          ${!habit.active ? '<p class="hd-inactive-note">planned · not scoring yet</p>' : ''}
          ${recoveryHtml}
        </div>

        <div class="hd-divider"></div>

        <div class="hd-section--row">
          <div class="hd-stat-block">
            <span class="hd-label">streak</span>
            <span class="${streakClass}">${streakText}</span>
          </div>
          <div class="hd-stat-block">
            <span class="hd-label">identity</span>
            <span class="hd-stat">${identity.score.toFixed(1)}</span>
          </div>
          <div class="hd-stat-block">
            <span class="hd-label">rank</span>
            <span class="hd-stat">${identity.rank}</span>
          </div>
        </div>

        <div class="hd-divider"></div>

        <div>
          <span class="hd-label">block ${block.blockNumber} · day ${block.dayInBlock} of 5</span>
          <div class="hd-block-row">
            <span class="hd-stat" style="font-size:18px;">avg ${block.avg.toFixed(1)}</span>
            <span class="hd-zone hd-zone--${block.zone.name}">${_esc(block.zone.label)}</span>
          </div>
          <div class="hd-days">${_buildDayCells(block)}</div>
        </div>

      </div>
    `;

    // Bind log buttons after innerHTML is written
    panel.querySelectorAll('.hd-btn[data-outcome]').forEach(btn => {
      btn.addEventListener('click', () => _handleLog(habitId, btn.dataset.outcome));
    });
  }


  /* ══ PRIVATE HELPERS ═══════════════════════════════════════════════════════ */

  // system-core §5.2 — live preview, never writes identity score.
  // Missing days = 0. Always divides by 5.
  function _liveBlockPreview(habitId) {
    const { blockStartDate, dayInBlock, blockNumber } = AS.getCurrentBlockMeta();
    const dayScores = [];
    for (let i = 0; i < 5; i++) {
      dayScores.push(AS.getDailyScore(AS.addDays(blockStartDate, i), habitId));
    }
    const avg  = dayScores.reduce((a, b) => a + b, 0) / 5;
    const zone = SE.getEngagementZone(avg);
    return { dayScores, avg, zone, dayInBlock, blockNumber };
  }

  // Build the 5 day-cell <span> elements as an HTML string.
  function _buildDayCells(block) {
    return block.dayScores.map((s, i) => {
      const dayNum   = i + 1;
      const isToday  = dayNum === block.dayInBlock;
      const isFuture = dayNum >  block.dayInBlock;
      let cls = 'hd-day';
      if      (isFuture) cls += ' hd-day--future';
      else if (s > 0)    cls += ' hd-day--pos';
      else if (s < 0)    cls += ' hd-day--neg';
      else               cls += ' hd-day--zero';
      if (isToday)       cls += ' hd-day--today';
      const label = isFuture ? '·' : (s > 0 ? '+' + s : (s < 0 ? String(s) : '—'));
      return `<span class="${cls}">${label}</span>`;
    }).join('');
  }

  // system-core §4.1 mapping — write log, re-render panel.
  function _handleLog(habitId, outcome) {
    AS.setDailyOutcome(AS.today(), habitId, outcome);
    render(habitId);
  }

  // Minimal HTML escape for user-supplied strings.
  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }


  /* ══ INIT ══════════════════════════════════════════════════════════════════ */
  clearPanel();


  /* ══ PUBLIC API ════════════════════════════════════════════════════════════ */
  return Object.freeze({ render, clearPanel, renderUntracked });

})();

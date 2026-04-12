/* ─────────────────────────────────────────
   Atomic Scott — App Logic  v4  (Step 3)
   ───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

  /* ══ ELEMENTS ══════════════════════════ */
  const navBtns     = document.querySelectorAll('.nav__btn');
  const editToggle  = document.getElementById('editToggle');
  const addToggle   = document.getElementById('addToggle');
  const addPanel    = document.getElementById('addPanel');
  const addInput    = document.getElementById('addInput');
  const addConfirm  = document.getElementById('addConfirm');
  const addCancel   = document.getElementById('addCancel');
  const hlist       = document.getElementById('hlist');
  const indFill     = document.getElementById('indFill');
  const indDot      = document.getElementById('indDot');
  const indCur      = document.getElementById('indCur');
  const indTot      = document.getElementById('indTot');
  const habitDetail = document.getElementById('habitDetail');

  /* ══ STATE ═════════════════════════════ */
  let editMode      = false;
  let addOpen       = false;
  let hoveredN      = null;
  let activeHabitId = null;    // currently selected AS habit id

  /* ══ NAVIGATION ═══════════════════════ */
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });

  /* ══ INDICATOR ═════════════════════════ */
  function totalHabits() {
    return hlist.querySelectorAll('.hi:not(.removing)').length;
  }

  function updateTotal() {
    indTot.textContent = '/' + totalHabits();
  }

  function setIndicator(n) {
    const total = totalHabits();
    indTot.textContent = '/' + total;
    if (n === null) {
      indDot.classList.remove('on');
      indFill.style.height = '0%';
      indCur.textContent   = '—';
      return;
    }
    const pct = total <= 1 ? 0 : ((n - 1) / (total - 1)) * 100;
    indDot.style.top     = pct + '%';
    indFill.style.height = pct + '%';
    indDot.classList.add('on');
    indCur.textContent   = String(n).padStart(2, '0');
  }

  function renumber() {
    hlist.querySelectorAll('.hi:not(.removing)').forEach((el, i) => {
      el.dataset.n = i + 1;
    });
    updateTotal();
  }

  /* ══ MAKE ITEM ══════════════════════════ */
  // habitId: AS habit id (string) | undefined for user-added habits
  function makeItem(name, n, habitId) {
    const li = document.createElement('li');
    li.className = 'hi';
    li.dataset.n = n;
    if (habitId) li.dataset.habitId = habitId;
    li.innerHTML = `
      <span class="hi__sym">◇</span>
      <span class="hi__name">${escapeHtml(name)}</span>
      <button class="hi__del" tabindex="-1">×</button>
    `;
    return li;
  }

  /* ══ RENDER INITIAL LIST ═══════════════ */
  // Primary source: AS.getAllHabits() — the canonical AS habit definitions.
  // User-added habits (DOM-only) are not part of AS and won't appear here.
  function renderInitial() {
    const habits = AS.getAllHabits();
    habits.forEach((habit, i) => {
      hlist.appendChild(makeItem(habit.name, i + 1, habit.id));
    });
    updateTotal();
    bindHoverEvents();
    bindClickEvents();
    restoreUIState();
  }

  /* ══ HOVER ══════════════════════════════ */
  function bindHoverEvents() {
    const items = hlist.querySelectorAll('.hi');

    items.forEach(hi => {
      hi.addEventListener('mouseenter', () => {
        if (hi.classList.contains('removing')) return;

        // Reset all symbols, preserve selected item's ◆
        hlist.querySelectorAll('.hi').forEach(h => {
          h.classList.remove('lit');
          h.querySelector('.hi__sym').textContent =
            h.classList.contains('selected') ? '◆' : '◇';
        });

        hi.classList.add('lit');
        hi.querySelector('.hi__sym').textContent = '◆';
        hoveredN = parseInt(hi.dataset.n, 10);
        setIndicator(hoveredN);
      });
    });

    hlist.addEventListener('mouseleave', () => {
      // Restore: selected keeps ◆, rest get ◇
      hlist.querySelectorAll('.hi').forEach(h => {
        h.classList.remove('lit');
        h.querySelector('.hi__sym').textContent =
          h.classList.contains('selected') ? '◆' : '◇';
      });
      hoveredN = null;
      setIndicator(null);
    });
  }

  /* ══ CLICK TO SELECT ═══════════════════ */
  function bindClickEvents() {
    hlist.addEventListener('click', e => {
      if (editMode) return;

      // Delete button is handled by its own handler below
      const delBtn = e.target.closest('.hi__del');
      if (delBtn) return;

      const hi = e.target.closest('.hi');
      if (!hi || hi.classList.contains('removing')) return;

      const habitId = hi.dataset.habitId;

      if (!habitId) {
        // User-added habit — show placeholder, not tracked
        _selectItem(hi, null);
        _renderDetailUntracked(hi.querySelector('.hi__name').textContent);
        return;
      }

      if (activeHabitId === habitId) return; // already selected

      _selectItem(hi, habitId);
      renderDetail(habitId);
      AS.setUIState({ selectedHabitId: habitId });
    });
  }

  // Mark one <li> as selected, deselect all others.
  function _selectItem(hi, habitId) {
    hlist.querySelectorAll('.hi').forEach(h => {
      h.classList.remove('selected');
      if (!h.classList.contains('lit')) {
        h.querySelector('.hi__sym').textContent = '◇';
      }
    });
    hi.classList.add('selected');
    hi.querySelector('.hi__sym').textContent = '◆';
    activeHabitId = habitId;
  }

  /* ══ RESTORE UI STATE ══════════════════ */
  // Re-select and re-render the habit that was active last session.
  function restoreUIState() {
    const uiState = AS.getUIState();
    if (!uiState.selectedHabitId) return;
    const hi = hlist.querySelector(`[data-habit-id="${uiState.selectedHabitId}"]`);
    if (!hi) return;
    _selectItem(hi, uiState.selectedHabitId);
    renderDetail(uiState.selectedHabitId);
  }

  /* ══ EDIT MODE ═════════════════════════ */
  editToggle.addEventListener('click', () => {
    editMode = !editMode;
    hlist.classList.toggle('editing', editMode);
    editToggle.classList.toggle('active', editMode);
    if (editMode && addOpen) closeAdd();
  });

  /* ══ DELETE ════════════════════════════ */
  hlist.addEventListener('click', e => {
    const delBtn = e.target.closest('.hi__del');
    if (!delBtn || !editMode) return;

    const hi = delBtn.closest('.hi');
    hi.classList.add('removing');
    hi.addEventListener('animationend', () => {
      // If we deleted the selected habit, clear the detail panel
      if (hi.dataset.habitId && hi.dataset.habitId === activeHabitId) {
        activeHabitId = null;
        _renderDetailEmpty();
        AS.setUIState({ selectedHabitId: null });
      }
      hi.remove();
      renumber();
      setIndicator(null);
      bindHoverEvents();
      saveHabits();
    }, { once: true });
  });

  /* ══ ADD ════════════════════════════════ */
  function openAdd() {
    addOpen = true;
    addPanel.classList.add('open');
    addToggle.classList.add('active');
    if (editMode) {
      editMode = false;
      hlist.classList.remove('editing');
      editToggle.classList.remove('active');
    }
    requestAnimationFrame(() => addInput.focus());
  }

  function closeAdd() {
    addOpen = false;
    addPanel.classList.remove('open');
    addToggle.classList.remove('active');
    addInput.value = '';
  }

  function commitAdd() {
    const name = addInput.value.trim();
    if (!name) return;

    const newN = totalHabits() + 1;
    const li   = makeItem(name, newN, null); // no AS id
    li.style.opacity   = '0';
    li.style.transform = 'translateX(-6px)';
    hlist.appendChild(li);

    requestAnimationFrame(() => {
      li.style.transition = 'opacity .36s ease, transform .36s cubic-bezier(0.22,1,0.36,1)';
      li.style.opacity    = '1';
      li.style.transform  = 'translateX(0)';
      li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });

    renumber();
    bindHoverEvents();
    closeAdd();
    saveHabits();
  }

  addToggle.addEventListener('click', () => addOpen ? closeAdd() : openAdd());
  addCancel.addEventListener('click', closeAdd);
  addConfirm.addEventListener('click', commitAdd);
  addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  commitAdd();
    if (e.key === 'Escape') closeAdd();
  });

  /* ══ LEGACY STORAGE (for user-added DOM-only habits) ═════════════════════ */
  const STORAGE_KEY_LEGACY = 'atomicscott_habits';

  function saveHabits() {
    const names = [...hlist.querySelectorAll('.hi:not(.removing)')]
      .map(el => el.querySelector('.hi__name').textContent);
    localStorage.setItem(STORAGE_KEY_LEGACY, JSON.stringify(names));
  }

  /* ══ DETAIL PANEL ══════════════════════════════════════════════════════════
     All three render helpers follow the same pattern:
     replace habitDetail.innerHTML, then bind interactive elements.
  ═══════════════════════════════════════════════════════════════════════════ */

  function _renderDetailEmpty() {
    habitDetail.innerHTML = `
      <div class="hd-empty">
        <p class="hd-empty__msg">select a habit</p>
      </div>
    `;
  }

  function _renderDetailUntracked(name) {
    habitDetail.innerHTML = `
      <div class="hd-empty">
        <p class="hd-empty__msg">${escapeHtml(name)}</p>
        <p class="hd-empty__msg" style="margin-top:6px;font-size:8px;">not tracked by system</p>
      </div>
    `;
  }

  // ── Live 5-day block preview ───────────────────────────────────────────────
  // system-core §5.2: live preview — always divide by 5, missing = 0.
  // Identity score does NOT update until the block closes.
  function _getLiveBlockPreview(habitId) {
    const meta = AS.getCurrentBlockMeta();
    const { blockStartDate, dayInBlock, blockNumber } = meta;

    const dayScores = [];
    for (let i = 0; i < 5; i++) {
      dayScores.push(AS.getDailyScore(AS.addDays(blockStartDate, i), habitId));
    }

    const avg  = dayScores.reduce((a, b) => a + b, 0) / 5;
    const zone = SE.getEngagementZone(avg);

    return { dayScores, avg, zone, dayInBlock, blockNumber };
  }

  // ── Main habit detail render ───────────────────────────────────────────────
  function renderDetail(habitId) {
    const habit = AS.getHabitById(habitId);
    if (!habit) { _renderDetailEmpty(); return; }

    const todayStr = AS.today();
    const log      = AS.getDailyLog(todayStr, habitId);
    const score    = log ? log.score   : null;
    const outcome  = log ? log.outcome : null;
    const block    = _getLiveBlockPreview(habitId);
    const identity = AS.getHabitIdentityScore(habitId);
    const recovery = identity.recoveryState; // 'normal'|'drift'|'recovery'|'back_on_track'

    // system-core §13.2: hide streak during recovery mode
    const hideStreak = (recovery === 'recovery');
    const streak     = hideStreak ? null : AS.getStreak(habitId);

    // ── Score display ─────────────────────────────────────────────────────
    const scoreText = score !== null
      ? (score > 0 ? '+' + score : String(score))
      : '—';

    const OUTCOME_LABELS = {
      perfect: 'perfect', good: 'good', okay: 'partial',
      poor: 'poor', bad: 'bad', missed: 'skipped', computed: 'logged',
    };
    const outcomeText = outcome ? (OUTCOME_LABELS[outcome] || outcome) : '';

    // ── Button active states ──────────────────────────────────────────────
    const doneActive    = outcome === 'good'   ? 'hd-btn--active' : '';
    const partialActive = outcome === 'okay'   ? 'hd-btn--active' : '';
    const skipActive    = outcome === 'missed' ? 'hd-btn--active' : '';

    // ── Day cells ─────────────────────────────────────────────────────────
    const daysHtml = block.dayScores.map((s, i) => {
      const dayNum   = i + 1;
      const isToday  = dayNum === block.dayInBlock;
      const isFuture = dayNum > block.dayInBlock;
      let cls        = 'hd-day';
      if      (isFuture) cls += ' hd-day--future';
      else if (s > 0)    cls += ' hd-day--pos';
      else if (s < 0)    cls += ' hd-day--neg';
      else               cls += ' hd-day--zero';
      if (isToday)       cls += ' hd-day--today';
      const label = isFuture ? '·' : (s > 0 ? '+' + s : (s < 0 ? String(s) : '—'));
      return `<span class="${cls}">${label}</span>`;
    }).join('');

    // ── Recovery messages (system-core §13) ───────────────────────────────
    let recoveryHtml = '';
    if (recovery === 'back_on_track') {
      recoveryHtml = `<p class="hd-inactive-note" style="color:var(--c-text-main);letter-spacing:.14em;">back on track.</p>`;
      AS.clearBackOnTrack(habitId); // show once, then clear
    } else if (recovery === 'recovery') {
      recoveryHtml = `<p class="hd-inactive-note">just hit growth zone once this block.</p>`;
    } else if (recovery === 'drift') {
      recoveryHtml = `<p class="hd-inactive-note">you're drifting.</p>`;
    }

    // ── Streak display ────────────────────────────────────────────────────
    const streakText  = hideStreak
      ? '·'
      : (streak > 0 ? streak + (streak !== 1 ? ' days' : ' day') : '—');
    const streakClass = hideStreak ? 'hd-stat hd-stat--hidden' : 'hd-stat';

    // ── Final HTML ────────────────────────────────────────────────────────
    habitDetail.innerHTML = `
      <div class="hd-content">

        <div class="hd-header">
          <div class="hd-meta">
            <span class="hd-pillar-tag">${habit.pillar}${habit.subCategory ? ' · ' + habit.subCategory : ''}</span>
            <span class="hd-badge ${habit.active ? 'hd-badge--active' : ''}">${habit.active ? 'active' : 'planned'}</span>
          </div>
          <h2 class="hd-name">${escapeHtml(habit.name)}</h2>
        </div>

        <div class="hd-divider"></div>

        <div class="hd-section">
          <span class="hd-label">today</span>
          <div class="hd-score-row">
            <span class="hd-score-num">${scoreText}</span>
            <span class="hd-outcome-label">${outcomeText}</span>
          </div>
          <div class="hd-btns">
            <button class="hd-btn ${doneActive}"    data-log-habit="${habitId}" data-outcome="good">Done</button>
            <button class="hd-btn ${partialActive}" data-log-habit="${habitId}" data-outcome="okay">Partial</button>
            <button class="hd-btn ${skipActive}"    data-log-habit="${habitId}" data-outcome="missed">Skip</button>
          </div>
          ${!habit.active ? '<p class="hd-inactive-note">planned · not scoring yet</p>' : ''}
          ${recoveryHtml}
        </div>

        <div class="hd-divider"></div>

        <div class="hd-section hd-section--row">
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

        <div class="hd-section">
          <span class="hd-label">block ${block.blockNumber} · day ${block.dayInBlock} of 5</span>
          <div class="hd-block-row">
            <span class="hd-stat" style="font-size:18px;">avg ${block.avg.toFixed(1)}</span>
            <span class="hd-zone hd-zone--${block.zone.name}">${block.zone.label}</span>
          </div>
          <div class="hd-days">${daysHtml}</div>
        </div>

      </div>
    `;

    // Bind log buttons (after innerHTML — elements now exist in DOM)
    habitDetail.querySelectorAll('[data-log-habit]').forEach(btn => {
      btn.addEventListener('click', () => {
        _handleLog(btn.dataset.logHabit, btn.dataset.outcome);
      });
    });
  }

  // ── Log a daily outcome ────────────────────────────────────────────────────
  // system-core §4.1 mapping:
  //   Done    → 'good'   → +7
  //   Partial → 'okay'   → +4
  //   Skip    → 'missed' → 0
  function _handleLog(habitId, outcome) {
    AS.setDailyOutcome(AS.today(), habitId, outcome);
    renderDetail(habitId); // re-render to show updated score + active button
  }

  /* ══ UTILITY ════════════════════════════ */
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ══ INIT ════════════════════════════════ */
  renderInitial();
});

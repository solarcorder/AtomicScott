/* ─────────────────────────────────────────
   Atomic Scott — App Logic  v4  (Step 3)

   Owns: navigation, left habit list,
         hover/select, add/edit/delete.
   Panel:  delegates entirely to HP.*
   Data:   reads/writes via AS.*
   ───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {

  /* ══ GUARD ═════════════════════════════ */
  if (typeof AS === 'undefined') { console.error('[app] AS not loaded'); return; }
  if (typeof HP === 'undefined') { console.error('[app] HP not loaded'); return; }

  /* ══ ELEMENTS ══════════════════════════ */
  const navBtns    = document.querySelectorAll('.nav__btn');
  const editToggle = document.getElementById('editToggle');
  const addToggle  = document.getElementById('addToggle');
  const addPanel   = document.getElementById('addPanel');
  const addInput   = document.getElementById('addInput');
  const addConfirm = document.getElementById('addConfirm');
  const addCancel  = document.getElementById('addCancel');
  const hlist      = document.getElementById('hlist');
  const indFill    = document.getElementById('indFill');
  const indDot     = document.getElementById('indDot');
  const indCur     = document.getElementById('indCur');
  const indTot     = document.getElementById('indTot');

  /* ══ STATE ═════════════════════════════ */
  let editMode      = false;
  let addOpen       = false;
  let activeHabitId = null;

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
  function makeItem(name, n, habitId) {
    const li = document.createElement('li');
    li.className   = 'hi';
    li.dataset.n   = n;
    if (habitId) li.dataset.habitId = habitId;
    li.innerHTML = `
      <span class="hi__sym">◇</span>
      <span class="hi__name">${_esc(name)}</span>
      <button class="hi__del" tabindex="-1">×</button>
    `;
    return li;
  }

  /* ══ RENDER INITIAL LIST ═══════════════ */
  function renderInitial() {
    const habits = AS.getAllHabits();
    habits.forEach((h, i) => hlist.appendChild(makeItem(h.name, i + 1, h.id)));
    updateTotal();
    _bindHover();
    _bindClicks();
    _restoreUIState();
  }

  /* ══ HOVER ══════════════════════════════ */
  function _bindHover() {
    hlist.querySelectorAll('.hi').forEach(hi => {
      hi.addEventListener('mouseenter', () => {
        if (hi.classList.contains('removing')) return;
        hlist.querySelectorAll('.hi').forEach(h => {
          h.classList.remove('lit');
          h.querySelector('.hi__sym').textContent =
            h.classList.contains('selected') ? '◆' : '◇';
        });
        hi.classList.add('lit');
        hi.querySelector('.hi__sym').textContent = '◆';
        setIndicator(parseInt(hi.dataset.n, 10));
      });
    });

    hlist.addEventListener('mouseleave', () => {
      hlist.querySelectorAll('.hi').forEach(h => {
        h.classList.remove('lit');
        h.querySelector('.hi__sym').textContent =
          h.classList.contains('selected') ? '◆' : '◇';
      });
      setIndicator(null);
    });
  }

  /* ══ CLICK TO SELECT ═══════════════════ */
  function _bindClicks() {
    hlist.addEventListener('click', e => {
      if (editMode) return;
      if (e.target.closest('.hi__del')) return; // delete handler takes this

      const hi = e.target.closest('.hi');
      if (!hi || hi.classList.contains('removing')) return;

      const habitId = hi.dataset.habitId;

      if (!habitId) {
        _selectItem(hi, null);
        HP.renderUntracked(hi.querySelector('.hi__name').textContent);
        return;
      }

      if (activeHabitId === habitId) return; // already selected — no re-render

      _selectItem(hi, habitId);
      HP.render(habitId);
      AS.setUIState({ selectedHabitId: habitId });
    });
  }

  function _selectItem(hi, habitId) {
    hlist.querySelectorAll('.hi').forEach(h => {
      h.classList.remove('selected');
      if (!h.classList.contains('lit'))
        h.querySelector('.hi__sym').textContent = '◇';
    });
    hi.classList.add('selected');
    hi.querySelector('.hi__sym').textContent = '◆';
    activeHabitId = habitId;
  }

  /* ══ RESTORE UI STATE ══════════════════ */
  function _restoreUIState() {
    const { selectedHabitId } = AS.getUIState();
    if (!selectedHabitId) return;
    const hi = hlist.querySelector(`[data-habit-id="${selectedHabitId}"]`);
    if (!hi) return;
    _selectItem(hi, selectedHabitId);
    HP.render(selectedHabitId);
  }

  /* ══ EDIT MODE ═════════════════════════ */
  editToggle.addEventListener('click', () => {
    editMode = !editMode;
    hlist.classList.toggle('editing', editMode);
    editToggle.classList.toggle('active', editMode);
    if (editMode && addOpen) _closeAdd();
  });

  /* ══ DELETE ════════════════════════════ */
  hlist.addEventListener('click', e => {
    const delBtn = e.target.closest('.hi__del');
    if (!delBtn || !editMode) return;

    const hi = delBtn.closest('.hi');
    hi.classList.add('removing');
    hi.addEventListener('animationend', () => {
      if (hi.dataset.habitId && hi.dataset.habitId === activeHabitId) {
        activeHabitId = null;
        HP.clearPanel();
        AS.setUIState({ selectedHabitId: null });
      }
      hi.remove();
      renumber();
      setIndicator(null);
      _bindHover();
    }, { once: true });
  });

  /* ══ ADD ════════════════════════════════ */
  function _openAdd() {
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

  function _closeAdd() {
    addOpen = false;
    addPanel.classList.remove('open');
    addToggle.classList.remove('active');
    addInput.value = '';
  }

  function _commitAdd() {
    const name = addInput.value.trim();
    if (!name) return;
    const li = makeItem(name, totalHabits() + 1, null);
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
    _bindHover();
    _closeAdd();
  }

  addToggle.addEventListener('click', () => addOpen ? _closeAdd() : _openAdd());
  addCancel.addEventListener('click', _closeAdd);
  addConfirm.addEventListener('click', _commitAdd);
  addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter')  _commitAdd();
    if (e.key === 'Escape') _closeAdd();
  });

  /* ══ UTILITY ════════════════════════════ */
  function _esc(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ══ INIT ════════════════════════════════ */
  renderInitial();
});

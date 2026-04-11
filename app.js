/* ─────────────────────────────────────────
   Atomic Scott — Habit System  v3
   App Logic + LocalStorage persistence
   ───────────────────────────────────────── */

const DEFAULT_HABITS = [
  'Sleep 7–8 hours',
  'Eat healthy meals',
  'Social media ≤ 90 min',
  'No adult content',
  'Drink 2L water',
  'Study ≥ 2 hours',
  'Exercise 30 minutes',
  'Read 30 minutes',
  'Journal & reflect',
  'Plan tomorrow',
];

const STORAGE_KEY = 'atomicscott_habits';

document.addEventListener('DOMContentLoaded', () => {

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
  let editMode  = false;
  let addOpen   = false;
  let hoveredN  = null;

  /* ══ LOCALSTORAGE ══════════════════════ */
  function loadHabits() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }

  function saveHabits() {
    const names = [...hlist.querySelectorAll('.hi:not(.removing)')]
      .map(el => el.querySelector('.hi__name').textContent);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(names));
  }

  /* ══ RENDER INITIAL LIST ═══════════════ */
  function renderInitial() {
    const stored = loadHabits();
    const habits = stored ?? DEFAULT_HABITS;
    habits.forEach((name, i) => {
      hlist.appendChild(makeItem(name, i + 1));
    });
    updateTotal();
    bindHoverEvents();
  }

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
  function makeItem(name, n) {
    const li = document.createElement('li');
    li.className = 'hi';
    li.dataset.n = n;
    li.innerHTML = `
      <span class="hi__sym">◇</span>
      <span class="hi__name">${escapeHtml(name)}</span>
      <button class="hi__del" tabindex="-1">×</button>
    `;
    return li;
  }

  /* ══ HOVER ══════════════════════════════ */
  function bindHoverEvents() {
    const habits = hlist.querySelectorAll('.hi');
    habits.forEach(hi => {
      hi.addEventListener('mouseenter', () => {
        if (hi.classList.contains('removing')) return;
        habits.forEach(h => {
          h.classList.remove('lit');
          h.querySelector('.hi__sym').textContent = '◇';
        });
        hi.classList.add('lit');
        hi.querySelector('.hi__sym').textContent = '◆';
        hoveredN = parseInt(hi.dataset.n, 10);
        setIndicator(hoveredN);
      });
    });

    hlist.addEventListener('mouseleave', () => {
      habits.forEach(h => {
        h.classList.remove('lit');
        h.querySelector('.hi__sym').textContent = '◇';
      });
      hoveredN = null;
      setIndicator(null);
    });
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
    const li = makeItem(name, newN);
    li.style.opacity   = '0';
    li.style.transform = 'translateX(-6px)';
    hlist.appendChild(li);

    // Scroll new item into view inside the list container (not the page)
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

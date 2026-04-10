/* ─────────────────────────────────────────
   Atomic Scott — Habit System  v2
   App Logic
   ───────────────────────────────────────── */

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
  const indRail    = document.getElementById('indRail');
  const indFill    = document.getElementById('indFill');
  const indDot     = document.getElementById('indDot');
  const indCur     = document.getElementById('indCur');
  const indTot     = document.getElementById('indTot');


  /* ══ STATE ═════════════════════════════ */
  let editMode   = false;
  let addOpen    = false;


  /* ══ NAVIGATION ═══════════════════════ */
  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      navBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('view-' + btn.dataset.view).classList.add('active');
    });
  });


  /* ══ INDICATOR HELPERS ══════════════════ */
  function totalHabits() {
    return hlist.querySelectorAll('.hi:not(.removing)').length;
  }

  function syncRailHeight() {
    if (!indRail || !hlist) return;
    indRail.style.height = hlist.offsetHeight + 'px';
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
    const pct = total === 1 ? 0 : ((n - 1) / (total - 1)) * 100;
    indDot.style.top     = pct + '%';
    indFill.style.height = pct + '%';
    indDot.classList.add('on');
    indCur.textContent   = String(n).padStart(2, '0');
  }

  // Renumber all visible items sequentially
  function renumber() {
    const items = hlist.querySelectorAll('.hi:not(.removing)');
    items.forEach((el, i) => {
      el.dataset.n = i + 1;
    });
    syncRailHeight();
    indTot.textContent = '/' + items.length;
  }

  requestAnimationFrame(() => {
    syncRailHeight();
    indTot.textContent = '/' + totalHabits();
  });

  window.addEventListener('resize', syncRailHeight);


  /* ══ HABIT HOVER (indicator + enlarge) ═ */
  function bindHoverEvents() {
    const habits = hlist.querySelectorAll('.hi');

    habits.forEach(hi => {
      // Remove old listeners by cloning? No — we attach once, guard with class
      hi.addEventListener('mouseenter', () => {
        if (hi.classList.contains('removing')) return;
        habits.forEach(h => {
          h.classList.remove('lit');
          h.querySelector('.hi__sym').textContent = '◇';
        });
        hi.classList.add('lit');
        hi.querySelector('.hi__sym').textContent = '◆';
        setIndicator(parseInt(hi.dataset.n, 10));
      });
    });

    hlist.addEventListener('mouseleave', () => {
      habits.forEach(h => {
        h.classList.remove('lit');
        h.querySelector('.hi__sym').textContent = '◇';
      });
      setIndicator(null);
    });
  }

  bindHoverEvents();


  /* ══ EDIT MODE ═════════════════════════ */
  editToggle.addEventListener('click', () => {
    editMode = !editMode;
    hlist.classList.toggle('editing', editMode);
    editToggle.classList.toggle('active', editMode);

    // Close add panel if open
    if (editMode && addOpen) closeAdd();
  });


  /* ══ DELETE HABIT ══════════════════════ */
  hlist.addEventListener('click', e => {
    const delBtn = e.target.closest('.hi__del');
    if (!delBtn || !editMode) return;

    const hi = delBtn.closest('.hi');
    hi.classList.add('removing');

    // After animation, remove from DOM and renumber
    hi.addEventListener('animationend', () => {
      hi.remove();
      renumber();
      setIndicator(null);
    }, { once: true });
  });


  /* ══ ADD HABIT ══════════════════════════ */
  function openAdd() {
    addOpen = true;
    addPanel.classList.add('open');
    addToggle.classList.add('active');
    // Close edit mode
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

    const total = totalHabits();
    const newN  = total + 1;

    const li = document.createElement('li');
    li.className = 'hi';
    li.dataset.n = newN;
    li.innerHTML = `
      <span class="hi__sym">◇</span>
      <span class="hi__name">${escapeHtml(name)}</span>
      <button class="hi__del" tabindex="-1">×</button>
    `;

    // Animate in
    li.style.opacity   = '0';
    li.style.transform = 'translateX(-6px)';

    hlist.appendChild(li);

    requestAnimationFrame(() => {
      li.style.transition = 'opacity .36s ease, transform .36s cubic-bezier(0.22,1,0.36,1)';
      li.style.opacity    = '1';
      li.style.transform  = 'translateX(0)';
    });

    renumber();
    bindHoverEvents();
    closeAdd();
  }

  addToggle.addEventListener('click', () => addOpen ? closeAdd() : openAdd());
  addCancel.addEventListener('click', closeAdd);
  addConfirm.addEventListener('click', commitAdd);

  addInput.addEventListener('keydown', e => {
    if (e.key === 'Enter') commitAdd();
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

});

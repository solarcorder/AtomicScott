/* ─────────────────────────────────────────
   ritual — Habit System
   App Logic
   ───────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {


  /* ════════════════════════════════════════
     NAVIGATION
     ════════════════════════════════════════ */

  const navBtns = document.querySelectorAll('.nav__btn');

  navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.view;

      // Deactivate all buttons & views
      navBtns.forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));

      // Activate selected
      btn.classList.add('active');
      document.getElementById('view-' + target).classList.add('active');
    });
  });


  /* ════════════════════════════════════════
     POSITION INDICATOR
     ════════════════════════════════════════ */

  const habits  = document.querySelectorAll('.hi');
  const hlist   = document.getElementById('hlist');
  const indRail = document.getElementById('indRail');
  const indFill = document.getElementById('indFill');
  const indDot  = document.getElementById('indDot');
  const indCur  = document.getElementById('indCur');
  const TOTAL   = habits.length;

  /**
   * Sync the rail's height to the habit list's rendered height.
   * Called once on load and again if the window is resized.
   */
  function syncRailHeight() {
    if (!hlist || !indRail) return;
    indRail.style.height = hlist.offsetHeight + 'px';
  }

  // Run after layout settles
  requestAnimationFrame(() => {
    syncRailHeight();
  });

  window.addEventListener('resize', syncRailHeight);

  /**
   * Move the indicator to item n (1-based), or reset if n is null.
   */
  function setIndicator(n) {
    if (n === null) {
      indDot.classList.remove('on');
      indFill.style.height = '0%';
      indCur.textContent   = '—';
      return;
    }
    // Percentage along the rail: item 1 → 0%, item TOTAL → 100%
    const pct = TOTAL === 1 ? 0 : ((n - 1) / (TOTAL - 1)) * 100;

    indDot.style.top     = pct + '%';
    indFill.style.height = pct + '%';
    indDot.classList.add('on');
    indCur.textContent   = String(n).padStart(2, '0');
  }


  /* ── Habit item interactions ── */

  habits.forEach(hi => {
    const n   = parseInt(hi.dataset.n, 10);
    const sym = hi.querySelector('.hi__sym');

    hi.addEventListener('mouseenter', () => {
      // Reset all items
      habits.forEach(h => {
        h.classList.remove('lit');
        h.querySelector('.hi__sym').textContent = '◇';
      });

      // Activate hovered item
      hi.classList.add('lit');
      sym.textContent = '◆';

      setIndicator(n);
    });
  });

  // Reset everything when mouse leaves the list
  hlist.addEventListener('mouseleave', () => {
    habits.forEach(h => {
      h.classList.remove('lit');
      h.querySelector('.hi__sym').textContent = '◇';
    });
    setIndicator(null);
  });


});

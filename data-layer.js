/**
 * AtomicScott — Data Layer (Step 1)
 * ─────────────────────────────────────────────────────────────────────────────
 * Single source of truth for all localStorage reads and writes.
 * NO DOM access anywhere in this file. Pure data.
 *
 * Public API is exposed on the global `AS` object.
 * Every other file in the project calls AS.* — never localStorage directly.
 *
 * Architecture reminder (system-core §1):
 *   daily scores → 5-day block average → identity score → rank
 * ─────────────────────────────────────────────────────────────────────────────
 */

const AS = (function () {
  'use strict';

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1 — CONSTANTS (mirrors system-core exactly — do not drift)
  // ═══════════════════════════════════════════════════════════════════════════

  const VERSION     = '1.0';
  const STORAGE_KEY = 'atomicscott_v1';

  /**
   * Outcome → score map (system-core §4.1)
   * Missed = 0 intentionally: not logging is neutral, not negative.
   */
  const OUTCOME_SCORES = Object.freeze({
    perfect :  10,
    good    :   7,
    okay    :   4,
    poor    :  -3,
    bad     :  -7,
    missed  :   0,
  });

  /**
   * Engagement zones (system-core §6.1)
   * Checked AFTER a 5-day block closes.
   * Range is [min, max) — lower bound inclusive, upper bound exclusive,
   * except the final zone which extends to +10 inclusive.
   */
  const ENGAGEMENT_ZONES = Object.freeze([
    { name: 'crisis', label: 'Struggling',    min: -Infinity, max: -3,       multiplier: 0.50 },
    { name: 'below',  label: 'Below target',  min: -3,        max:  2,       multiplier: 0.80 },
    { name: 'growth', label: 'On track',      min:  2,        max:  6,       multiplier: 1.00 },
    { name: 'high',   label: 'Exceeding',     min:  6,        max:  8.5,     multiplier: 1.10 },
    { name: 'peak',   label: 'Peak',          min:  8.5,      max:  Infinity, multiplier: 1.15 },
  ]);

  /**
   * Per-habit rank thresholds (system-core §7.2)
   */
  const HABIT_RANKS = Object.freeze([
    { rank: 'Seed',   min:   0, max:  15 },
    { rank: 'Sprout', min:  15, max:  40 },
    { rank: 'Root',   min:  40, max:  85 },
    { rank: 'Branch', min:  85, max: 150 },
    { rank: 'Tree',   min: 150, max: 250 },
    { rank: 'Forest', min: 250, max: Infinity },
  ]);

  /**
   * Overall identity rank thresholds (system-core §8.4)
   */
  const OVERALL_RANKS = Object.freeze([
    { rank: 'Seed',   min:   0, max:  30 },
    { rank: 'Sprout', min:  30, max:  90 },
    { rank: 'Root',   min:  90, max: 200 },
    { rank: 'Branch', min: 200, max: 380 },
    { rank: 'Tree',   min: 380, max: 600 },
    { rank: 'Forest', min: 600, max: Infinity },
  ]);

  /**
   * Pillar weights (system-core §2)
   * Activation rule: active pillars share 100% equally.
   * Currently only Physical is active → effective weight = 100%.
   */
  const PILLAR_WEIGHTS = Object.freeze({
    Physical:  0.25,
    Mental:    0.25,
    Spiritual: 0.25,
    Financial: 0.25,
  });

  /**
   * Physical sub-category weights (system-core §3)
   * Activation rule same as pillars.
   * Currently only Diet active → effective weight = 100%.
   */
  const PHYSICAL_SUBCAT_WEIGHTS = Object.freeze({
    Diet:     0.35,
    Sleep:    0.30,
    Exercise: 0.20,
    Water:    0.15,
  });

  /**
   * Meal weights within the Diet sub-category (diet-skill §7.1)
   */
  const MEAL_WEIGHTS = Object.freeze({
    breakfast: 0.35,
    lunch:     0.30,
    dinner:    0.35,
  });

  /**
   * Proportion scaling bounds (diet-skill §5.3)
   */
  const PROPORTION_CAP   =  1.2;  // ceiling multiplier on portion size
  const PROPORTION_FLOOR = -2;    // absolute floor on scaled food score

  /**
   * Recovery thresholds (system-core §13.1)
   */
  const RECOVERY_THRESHOLDS = Object.freeze({
    drift:      2,
    recovery:   3,
    softReset:  5,
  });


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2 — HABIT DEFINITIONS
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Master habit list.
   * active:true  → scoring runs and contributes to identity score.
   * active:false → displayed in UI, tracked, but NOT included in scoring yet.
   * isDietHabit  → triggers 3-meal-slot UI instead of simple Done/Partial/Skipped.
   */
  const HABIT_DEFINITIONS = Object.freeze([

    // ── Physical / Diet ──────────────────────────────────────────────────────
    {
      id:          'diet',
      name:        'Eat healthy meals',
      pillar:      'Physical',
      subCategory: 'Diet',
      isDietHabit: true,
      active:      true,
      weight:      1.0,           // 100% of Diet sub-cat (only active habit here)
      subcatWeight: PHYSICAL_SUBCAT_WEIGHTS.Diet,
      targetZone:  { min: 2, max: 6 },
    },

    // ── Physical / planned ───────────────────────────────────────────────────
    {
      id:          'sleep',
      name:        'Sleep 7–8 hours',
      pillar:      'Physical',
      subCategory: 'Sleep',
      active:      false,
      weight:      1.0,
      subcatWeight: PHYSICAL_SUBCAT_WEIGHTS.Sleep,
      targetZone:  { min: 2, max: 6 },
    },
    {
      id:          'water',
      name:        'Drink 2L water',
      pillar:      'Physical',
      subCategory: 'Water',
      active:      false,
      weight:      1.0,
      subcatWeight: PHYSICAL_SUBCAT_WEIGHTS.Water,
      targetZone:  { min: 2, max: 6 },
    },
    {
      id:          'exercise',
      name:        'Exercise 30 minutes',
      pillar:      'Physical',
      subCategory: 'Exercise',
      active:      false,
      weight:      1.0,
      subcatWeight: PHYSICAL_SUBCAT_WEIGHTS.Exercise,
      targetZone:  { min: 2, max: 6 },
    },

    // ── Mental / planned ─────────────────────────────────────────────────────
    {
      id:          'social_media',
      name:        'Social media ≤ 90 min',
      pillar:      'Mental',
      subCategory: 'Screen',
      active:      false,
      weight:      1.0,
      targetZone:  { min: 2, max: 6 },
    },
    {
      id:          'no_adult_content',
      name:        'No adult content',
      pillar:      'Mental',
      subCategory: 'Discipline',
      active:      false,
      weight:      1.0,
      targetZone:  { min: 2, max: 6 },
    },
    {
      id:          'study',
      name:        'Study ≥ 2 hours',
      pillar:      'Mental',
      subCategory: 'Learning',
      active:      false,
      weight:      1.0,
      targetZone:  { min: 2, max: 6 },
    },
    {
      id:          'read',
      name:        'Read 30 minutes',
      pillar:      'Mental',
      subCategory: 'Learning',
      active:      false,
      weight:      1.0,
      targetZone:  { min: 2, max: 6 },
    },
    {
      id:          'journal',
      name:        'Journal & reflect',
      pillar:      'Mental',
      subCategory: 'Reflection',
      active:      false,
      weight:      1.0,
      targetZone:  { min: 2, max: 6 },
    },
    {
      id:          'plan_tomorrow',
      name:        'Plan tomorrow',
      pillar:      'Mental',
      subCategory: 'Reflection',
      active:      false,
      weight:      1.0,
      targetZone:  { min: 2, max: 6 },
    },
  ]);


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3 — FOOD DATABASE SEED (diet-skill §9, §4 example values)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Seeded from diet-skill §4 (rubric examples) and §9.5 (morning shake).
   * axis_impact:  0–4   axis_replace: 0–2
   * axis_compound:0–2   axis_harm:    0–2
   * base_score = sum of all 4 axes (max 10).
   *
   * Macros at base_amount for display only — scoring uses the axis rubric.
   */
  const SEED_FOOD_DATABASE = [
    {
      id:               'seeds_chana_mix',
      name:             'Seeds + Chana Mix',
      category:         'legume',
      base_amount:      40,
      base_amount_unit: 'g',
      axis_impact:       4,
      axis_replace:      2,
      axis_compound:     2,
      axis_harm:         2,
      base_score:       10,
      protein_g:        10,
      carb_g:           12,
      fat_g:             6,
      fiber_g:           4,
      kcal:            140,
      notes: 'Core protein + healthy fat for morning shake.',
    },
    {
      id:               'dates',
      name:             'Dates (Khajur)',
      category:         'fruit',
      base_amount:       5,
      base_amount_unit: 'pieces',
      axis_impact:       2,
      axis_replace:      1,
      axis_compound:     1,
      axis_harm:         0,
      base_score:        4,
      protein_g:         1.8,
      carb_g:           37,
      fat_g:             0.2,
      fiber_g:           3.5,
      kcal:            150,
      notes: 'Natural sugar + carbs for shake energy.',
    },
    {
      id:               'banana',
      name:             'Banana',
      category:         'fruit',
      base_amount:       1,
      base_amount_unit: 'pieces',
      axis_impact:       2,
      axis_replace:      1,
      axis_compound:     1,
      axis_harm:         1,
      base_score:        5,
      protein_g:         1.3,
      carb_g:           27,
      fat_g:             0.3,
      fiber_g:           3.1,
      kcal:            105,
      notes: 'Carbs + potassium.',
    },
    {
      id:               'chia_seeds',
      name:             'Chia Seeds',
      category:         'seed',
      base_amount:       1,
      base_amount_unit: 'tbsp',
      axis_impact:       2,
      axis_replace:      2,
      axis_compound:     2,
      axis_harm:         1,
      base_score:        7,
      protein_g:         2.5,
      carb_g:            6,
      fat_g:             4.5,
      fiber_g:           5,
      kcal:             60,
      notes: 'Omega-3, fiber, anti-inflammatory.',
    },
    {
      id:               'isabgol',
      name:             'Isabgol',
      category:         'supplement',
      base_amount:       1,
      base_amount_unit: 'tsp',
      axis_impact:       0,
      axis_replace:      1,
      axis_compound:     2,
      axis_harm:         0,
      base_score:        3,
      protein_g:         0,
      carb_g:            3,
      fat_g:             0,
      fiber_g:           3,
      kcal:             12,
      notes: 'Gut health fiber. Optional.',
    },
    {
      id:               'roti_whole_wheat',
      name:             'Roti (Whole Wheat)',
      category:         'grain',
      base_amount:       2,
      base_amount_unit: 'pieces',
      axis_impact:       3,
      axis_replace:      1,
      axis_compound:     1,
      axis_harm:         2,
      base_score:        7,
      protein_g:         5,
      carb_g:           30,
      fat_g:             1,
      fiber_g:           4,
      kcal:            160,
      notes: 'Primary carb for lunch/dinner.',
    },
    {
      id:               'sabzi',
      name:             'Sabzi (Vegetable dish)',
      category:         'vegetable',
      base_amount:       1,
      base_amount_unit: 'bowl',
      axis_impact:       1,
      axis_replace:      1,
      axis_compound:     2,
      axis_harm:         1,
      base_score:        5,
      protein_g:         3,
      carb_g:           10,
      fat_g:             3,
      fiber_g:           3,
      kcal:             80,
      notes: 'Micronutrient diversity — varies by vegetable.',
    },
    {
      id:               'chaach',
      name:             'Chaach (Buttermilk)',
      category:         'dairy',
      base_amount:       1,
      base_amount_unit: 'glass',
      axis_impact:       2,
      axis_replace:      2,
      axis_compound:     2,
      axis_harm:         1,
      base_score:        7,
      protein_g:         3.5,
      carb_g:            5,
      fat_g:             2,
      fiber_g:           0,
      kcal:             55,
      notes: 'Probiotics, calcium, protein.',
    },
    {
      id:               'dal',
      name:             'Dal (Lentils)',
      category:         'legume',
      base_amount:       1,
      base_amount_unit: 'bowl',
      axis_impact:       4,
      axis_replace:      2,
      axis_compound:     2,
      axis_harm:         2,
      base_score:       10,
      protein_g:         9,
      carb_g:           20,
      fat_g:             0.8,
      fiber_g:           8,
      kcal:            120,
      notes: 'Primary protein source for Indian meals.',
    },
    {
      id:               'soya',
      name:             'Soya',
      category:         'legume',
      base_amount:       1,
      base_amount_unit: 'bowl',
      axis_impact:       4,
      axis_replace:      2,
      axis_compound:     2,
      axis_harm:         2,
      base_score:       10,
      protein_g:        14,
      carb_g:           10,
      fat_g:             4,
      fiber_g:           4,
      kcal:            130,
      notes: 'High-protein rotating dinner option.',
    },
    {
      id:               'white_rice',
      name:             'White Rice',
      category:         'grain',
      base_amount:       1,
      base_amount_unit: 'bowl',
      axis_impact:       2,
      axis_replace:      0,
      axis_compound:     1,
      axis_harm:         1,
      base_score:        4,
      protein_g:         4,
      carb_g:           45,
      fat_g:             0.5,
      fiber_g:           0.6,
      kcal:            200,
      notes: 'Fast carbs. Good post-workout.',
    },
  ];


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4 — MEAL TEMPLATE SEED (diet-skill §9.2, §9.5)
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Each template defines the default foods and their weights within that meal.
   * food_weight values within a template MUST sum to 1.0.
   * base_amount here is the amount used in this meal (may differ from food's
   * global base_amount if the meal calls for a different default portion).
   */
  const SEED_MEAL_TEMPLATES = {
    breakfast_shake: {
      id:       'breakfast_shake',
      name:     'Morning Shake',
      mealSlot: 'breakfast',
      items: [
        { food_id: 'seeds_chana_mix', base_amount: 40, unit: 'g',      food_weight: 0.45 },
        { food_id: 'dates',           base_amount:  5, unit: 'pieces', food_weight: 0.20 },
        { food_id: 'banana',          base_amount:  1, unit: 'pieces', food_weight: 0.20 },
        { food_id: 'chia_seeds',      base_amount:  1, unit: 'tbsp',   food_weight: 0.10 },
        { food_id: 'isabgol',         base_amount:  1, unit: 'tsp',    food_weight: 0.05 },
      ],
    },
    lunch_standard: {
      id:       'lunch_standard',
      name:     'Roti + Sabzi + Chaach',
      mealSlot: 'lunch',
      items: [
        { food_id: 'roti_whole_wheat', base_amount: 2, unit: 'pieces', food_weight: 0.40 },
        { food_id: 'sabzi',            base_amount: 1, unit: 'bowl',   food_weight: 0.30 },
        { food_id: 'chaach',           base_amount: 1, unit: 'glass',  food_weight: 0.30 },
      ],
    },
    dinner_dal_roti: {
      id:       'dinner_dal_roti',
      name:     'Dal + Roti',
      mealSlot: 'dinner',
      items: [
        { food_id: 'dal',              base_amount: 1, unit: 'bowl',   food_weight: 0.50 },
        { food_id: 'roti_whole_wheat', base_amount: 2, unit: 'pieces', food_weight: 0.50 },
      ],
    },
    dinner_soya_roti: {
      id:       'dinner_soya_roti',
      name:     'Soya + Roti',
      mealSlot: 'dinner',
      items: [
        { food_id: 'soya',             base_amount: 1, unit: 'bowl',   food_weight: 0.55 },
        { food_id: 'roti_whole_wheat', base_amount: 2, unit: 'pieces', food_weight: 0.45 },
      ],
    },
    dinner_roti_sabzi: {
      id:       'dinner_roti_sabzi',
      name:     'Roti + Sabzi',
      mealSlot: 'dinner',
      items: [
        { food_id: 'roti_whole_wheat', base_amount: 2, unit: 'pieces', food_weight: 0.55 },
        { food_id: 'sabzi',            base_amount: 1, unit: 'bowl',   food_weight: 0.45 },
      ],
    },
  };


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5 — DATE UTILITIES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Returns "YYYY-MM-DD" for a given Date object (or today if omitted). */
  function dateToString(date) {
    const d = date instanceof Date ? date : new Date();
    // Use local date parts to avoid UTC-shift surprises
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  /** Today as "YYYY-MM-DD" */
  function today() {
    return dateToString(new Date());
  }

  /** Add/subtract n days from a "YYYY-MM-DD" string. Returns new string. */
  function addDays(dateStr, n) {
    const d = new Date(dateStr + 'T00:00:00'); // force local midnight
    d.setDate(d.getDate() + n);
    return dateToString(d);
  }

  /**
   * Integer number of days from dateStr1 to dateStr2.
   * Positive = dateStr2 is in the future.
   */
  function daysBetween(dateStr1, dateStr2) {
    const a = new Date(dateStr1 + 'T00:00:00');
    const b = new Date(dateStr2 + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  /**
   * Given the system start date and any reference date,
   * return { blockNumber (1-indexed), dayInBlock (1–5), blockStartDate, blockEndDate }.
   *
   * Blocks are fixed 5-day windows counting from startDate.
   * Block 1: day 0–4, Block 2: day 5–9, etc.
   */
  function getBlockMeta(systemStartDate, referenceDate) {
    const ref = referenceDate || today();
    const offset      = daysBetween(systemStartDate, ref);
    const blockIndex  = Math.floor(offset / 5);          // 0-indexed
    const dayInBlock  = (offset % 5) + 1;                // 1–5
    const blockNumber = blockIndex + 1;
    const blockStart  = addDays(systemStartDate, blockIndex * 5);
    const blockEnd    = addDays(blockStart, 4);
    return { blockNumber, dayInBlock, blockStartDate: blockStart, blockEndDate: blockEnd };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 6 — DEFAULT STATE FACTORY
  // ═══════════════════════════════════════════════════════════════════════════

  function _buildHabitIdentityDefault() {
    return {
      score:                0,
      rank:                 'Seed',
      consecutiveBadBlocks: 0,
      /**
       * recoveryState values:
       *   'normal'        — all good
       *   'drift'         — 2 consecutive bad blocks
       *   'recovery'      — 3+ consecutive bad blocks
       *   'back_on_track' — one good block after recovery (clears next session)
       */
      recoveryState:        'normal',
      recoveryBaseline:     null,    // set when soft reset is used (§13.3)
      rankHistory:          [],      // [{ date, fromRank, toRank, score }]
    };
  }

  function createDefaultState() {
    const t = today();

    // Build identity score records and block history for every habit
    const habitIdentityScores = {};
    const blockHistory        = {};

    HABIT_DEFINITIONS.forEach(h => {
      habitIdentityScores[h.id] = _buildHabitIdentityDefault();
      blockHistory[h.id]        = [];
    });

    return {
      _version:    VERSION,
      initialized: true,
      startDate:   t,     // day the user first opened the system

      // ── Habit definitions (frozen copy stored for introspection) ──────────
      habits: HABIT_DEFINITIONS.map(h => ({ ...h })),

      // ── Daily habit logs ─────────────────────────────────────────────────
      /**
       * Shape:
       * {
       *   "YYYY-MM-DD": {
       *     "habitId": {
       *       score:     number,   // -10 to +10
       *       outcome:   string,   // key from OUTCOME_SCORES or 'custom'
       *       note:      string,
       *       loggedAt:  ISO string,
       *     }
       *   }
       * }
       */
      dailyLogs: {},

      // ── Meal logs (diet habit only) ───────────────────────────────────────
      /**
       * Shape:
       * {
       *   "YYYY-MM-DD": {
       *     breakfast: MealEntry | null,
       *     lunch:     MealEntry | null,
       *     dinner:    MealEntry | null,
       *   }
       * }
       *
       * MealEntry = {
       *   templateId:      string | null,
       *   items: [
       *     { food_id, logged_amount, unit }
       *   ],
       *   junkReplacement: boolean,
       *   junkSeverity:    'moderate' | 'severe' | null,
       *   score:           number | null,   // computed by scoring engine
       *   loggedAt:        ISO string,
       *   isLate:          boolean,         // logged after the day ended
       *   notes:           string,
       * }
       */
      mealLogs: {},

      // ── 5-day block history ───────────────────────────────────────────────
      /**
       * Shape:
       * {
       *   "habitId": [
       *     {
       *       blockNumber:          number,
       *       blockStartDate:       "YYYY-MM-DD",
       *       blockEndDate:         "YYYY-MM-DD",
       *       dayScores:            number[5],   // score per day (0 if missed)
       *       rawAverage:           number,
       *       engagementZone:       string,      // zone.name
       *       multiplier:           number,
       *       adjustedContribution: number,      // what was added to identity score
       *       closedAt:             ISO string,
       *     }
       *   ]
       * }
       */
      blockHistory,

      // ── Identity scores ───────────────────────────────────────────────────
      habitIdentityScores,

      // ── Overall identity score ────────────────────────────────────────────
      overallIdentityScore: {
        score:       0,
        rank:        'Seed',
        lastUpdated: t,
      },

      // ── Food database ─────────────────────────────────────────────────────
      /**
       * Array of food item objects (see diet-skill §9 for schema).
       * Seeded with the items defined in the SKILL.md.
       */
      foodDatabase: SEED_FOOD_DATABASE.map(f => ({ ...f })),

      // ── Meal templates ────────────────────────────────────────────────────
      mealTemplates: { ...SEED_MEAL_TEMPLATES },

      // ── UI persistence ────────────────────────────────────────────────────
      /**
       * Persisted across sessions so the user lands where they left off.
       */
      ui: {
        selectedHabitId: null,
        activeTab:       'habits',
        lastVisited:     t,
      },
    };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 7 — STORAGE CORE (single read/write path)
  // ═══════════════════════════════════════════════════════════════════════════

  function _load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      console.error('[AS:data] Load failed:', e);
      return null;
    }
  }

  function _save(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return true;
    } catch (e) {
      console.error('[AS:data] Save failed:', e);
      return false;
    }
  }

  /**
   * Get the full state, initializing if it does not exist.
   * All public getters call this. It is the only entry point.
   */
  function getState() {
    let state = _load();
    if (!state || !state.initialized) {
      console.log('[AS:data] First run — building default state.');
      state = createDefaultState();
      _save(state);
    }
    return state;
  }

  /**
   * Immutable-style update pattern.
   * Pass an updater function that receives the current state,
   * mutates it, and returns it.
   * setState writes back and returns the updated state.
   */
  function setState(updater) {
    const current = getState();
    const next    = updater(current);
    _save(next);
    return next;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 8 — HABIT QUERIES
  // ═══════════════════════════════════════════════════════════════════════════

  /** Return all habits. */
  function getAllHabits() {
    return getState().habits;
  }

  /** Return only habits where active === true. */
  function getActiveHabits() {
    return getState().habits.filter(h => h.active);
  }

  /** Return a single habit by id, or null. */
  function getHabitById(id) {
    return getState().habits.find(h => h.id === id) || null;
  }

  /** Return all habits that are diet habits (isDietHabit = true). */
  function getDietHabits() {
    return getState().habits.filter(h => h.isDietHabit);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 9 — DAILY LOG CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Read the log entry for one habit on one day.
   * Returns null if no entry exists (treat as missed = score 0).
   */
  function getDailyLog(dateStr, habitId) {
    const state = getState();
    return ((state.dailyLogs[dateStr] || {})[habitId]) || null;
  }

  /**
   * Read all log entries for a given day.
   * Returns {} if nothing logged.
   */
  function getDayLogs(dateStr) {
    return getState().dailyLogs[dateStr] || {};
  }

  /**
   * Get the numeric score for one habit on one day.
   * Returns 0 (missed) if no entry exists.
   */
  function getDailyScore(dateStr, habitId) {
    const entry = getDailyLog(dateStr, habitId);
    return entry ? entry.score : 0;
  }

  /**
   * Write a log entry using a named outcome (perfect/good/okay/poor/bad/missed).
   * This is the standard logging path for non-diet habits.
   */
  function setDailyOutcome(dateStr, habitId, outcome, note) {
    if (!Object.prototype.hasOwnProperty.call(OUTCOME_SCORES, outcome)) {
      console.error('[AS:data] Unknown outcome:', outcome);
      return null;
    }
    return setState(state => {
      if (!state.dailyLogs[dateStr]) state.dailyLogs[dateStr] = {};
      state.dailyLogs[dateStr][habitId] = {
        score:    OUTCOME_SCORES[outcome],
        outcome,
        note:     note || '',
        loggedAt: new Date().toISOString(),
      };
      return state;
    });
  }

  /**
   * Write a log entry with a raw numeric score (for diet rollup computed
   * by the scoring engine, or any custom score).
   * Score is clamped to [-10, +10].
   */
  function setDailyScore(dateStr, habitId, score, note) {
    const clamped = Math.max(-10, Math.min(10, Number(score)));
    return setState(state => {
      if (!state.dailyLogs[dateStr]) state.dailyLogs[dateStr] = {};
      state.dailyLogs[dateStr][habitId] = {
        score:    clamped,
        outcome:  'computed',
        note:     note || '',
        loggedAt: new Date().toISOString(),
      };
      return state;
    });
  }

  /**
   * Collect daily scores for a habit across a date range [startStr, endStr] inclusive.
   * Days with no entry return 0 (missed).
   * Returns an array of { date, score }.
   */
  function getDailyScoreRange(habitId, startStr, endStr) {
    const results = [];
    let cursor    = startStr;
    while (cursor <= endStr) {
      results.push({ date: cursor, score: getDailyScore(cursor, habitId) });
      cursor = addDays(cursor, 1);
    }
    return results;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 10 — MEAL LOG CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Read a single meal log (breakfast / lunch / dinner) for a date.
   * Returns null if not logged.
   */
  function getMealLog(dateStr, mealSlot) {
    const state = getState();
    return ((state.mealLogs[dateStr] || {})[mealSlot]) || null;
  }

  /**
   * Read all three meal logs for a date.
   * Returns { breakfast: ..., lunch: ..., dinner: ... } with nulls for unlogged.
   */
  function getDayMealLogs(dateStr) {
    const state = getState();
    const day   = state.mealLogs[dateStr] || {};
    return {
      breakfast: day.breakfast || null,
      lunch:     day.lunch     || null,
      dinner:    day.dinner    || null,
    };
  }

  /**
   * Write a meal log entry.
   * mealData shape:
   * {
   *   templateId?:      string,
   *   items?:           [{ food_id, logged_amount, unit }],
   *   junkReplacement?: boolean,
   *   junkSeverity?:    'moderate' | 'severe',
   *   score?:           number,   // computed score, written by scoring engine
   *   notes?:           string,
   *   isLate?:          boolean,
   * }
   */
  function setMealLog(dateStr, mealSlot, mealData) {
    if (!['breakfast', 'lunch', 'dinner'].includes(mealSlot)) {
      console.error('[AS:data] Invalid mealSlot:', mealSlot);
      return null;
    }
    return setState(state => {
      if (!state.mealLogs[dateStr]) {
        state.mealLogs[dateStr] = { breakfast: null, lunch: null, dinner: null };
      }
      state.mealLogs[dateStr][mealSlot] = {
        templateId:      mealData.templateId      || null,
        items:           mealData.items           || [],
        junkReplacement: mealData.junkReplacement || false,
        junkSeverity:    mealData.junkSeverity    || null,
        score:           mealData.score           !== undefined ? mealData.score : null,
        loggedAt:        new Date().toISOString(),
        isLate:          mealData.isLate          || false,
        notes:           mealData.notes           || '',
      };
      return state;
    });
  }

  /**
   * Update only the computed score on an existing meal log.
   * Called by the scoring engine after meal items are logged.
   */
  function setMealScore(dateStr, mealSlot, score) {
    return setState(state => {
      if (state.mealLogs[dateStr] && state.mealLogs[dateStr][mealSlot]) {
        state.mealLogs[dateStr][mealSlot].score = Number(score);
      }
      return state;
    });
  }

  /**
   * Get the computed score for a meal (0 if not logged or not yet scored).
   */
  function getMealScore(dateStr, mealSlot) {
    const entry = getMealLog(dateStr, mealSlot);
    if (!entry)                    return 0;
    if (entry.score === null)      return 0;
    if (entry.junkReplacement) {
      return entry.junkSeverity === 'severe' ? -7 : -5;
    }
    return entry.score;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 11 — FOOD DATABASE CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function getFoodDatabase() {
    return getState().foodDatabase || [];
  }

  function getFoodById(id) {
    return getFoodDatabase().find(f => f.id === id) || null;
  }

  /**
   * Add or update a food item.
   * Validates all 4 axis values are present.
   * Recalculates base_score automatically.
   */
  function upsertFood(foodItem) {
    const required = ['id', 'name', 'category', 'base_amount', 'base_amount_unit',
                      'axis_impact', 'axis_replace', 'axis_compound', 'axis_harm'];
    for (const field of required) {
      if (foodItem[field] === undefined || foodItem[field] === null) {
        console.error(`[AS:data] upsertFood: missing field "${field}"`);
        return null;
      }
    }
    const item = {
      ...foodItem,
      base_score: foodItem.axis_impact + foodItem.axis_replace +
                  foodItem.axis_compound + foodItem.axis_harm,
    };
    return setState(state => {
      const idx = state.foodDatabase.findIndex(f => f.id === item.id);
      if (idx >= 0) {
        state.foodDatabase[idx] = item;
      } else {
        state.foodDatabase.push(item);
      }
      return state;
    });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 12 — MEAL TEMPLATE CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function getMealTemplates(mealSlot) {
    const templates = Object.values(getState().mealTemplates || {});
    return mealSlot ? templates.filter(t => t.mealSlot === mealSlot) : templates;
  }

  function getMealTemplateById(id) {
    return (getState().mealTemplates || {})[id] || null;
  }

  function upsertMealTemplate(template) {
    return setState(state => {
      if (!state.mealTemplates) state.mealTemplates = {};
      state.mealTemplates[template.id] = template;
      return state;
    });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 13 — 5-DAY BLOCK HISTORY CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  /** All closed blocks for a habit. Returns [] if none. */
  function getBlockHistory(habitId) {
    return getState().blockHistory[habitId] || [];
  }

  /** Most recently closed block for a habit, or null. */
  function getLatestBlock(habitId) {
    const history = getBlockHistory(habitId);
    return history.length > 0 ? history[history.length - 1] : null;
  }

  /**
   * Write a fully computed, closed block record.
   * Called by the scoring engine when a block closes.
   */
  function saveClosedBlock(habitId, blockRecord) {
    return setState(state => {
      if (!state.blockHistory[habitId]) state.blockHistory[habitId] = [];
      state.blockHistory[habitId].push(blockRecord);
      return state;
    });
  }

  /**
   * Return the block metadata (number, day-in-block, dates)
   * for today relative to the system start date.
   */
  function getCurrentBlockMeta() {
    const state = getState();
    return getBlockMeta(state.startDate, today());
  }

  /**
   * Return block metadata for an arbitrary date.
   */
  function getBlockMetaForDate(dateStr) {
    const state = getState();
    return getBlockMeta(state.startDate, dateStr);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 14 — IDENTITY SCORE CRUD
  // ═══════════════════════════════════════════════════════════════════════════

  function getHabitIdentityScore(habitId) {
    const state = getState();
    return state.habitIdentityScores[habitId] || _buildHabitIdentityDefault();
  }

  /**
   * Apply a delta to a habit's identity score and update rank.
   * Also handles rank-drop detection.
   * Called by the scoring engine after each block closes.
   *
   * @param {string} habitId
   * @param {number} delta — the adjusted contribution from the closed block
   * @param {string} rankThresholds — 'habit' | 'overall' (always 'habit' here)
   */
  function addToHabitIdentityScore(habitId, delta) {
    return setState(state => {
      if (!state.habitIdentityScores[habitId]) {
        state.habitIdentityScores[habitId] = _buildHabitIdentityDefault();
      }
      const record   = state.habitIdentityScores[habitId];
      const prevRank = record.rank;
      record.score   = Math.max(0, record.score + delta); // score never goes below 0

      // Recalculate rank
      const newRank = _rankFromScore(record.score, HABIT_RANKS);
      if (newRank !== prevRank) {
        record.rankHistory.push({
          date:     today(),
          fromRank: prevRank,
          toRank:   newRank,
          score:    record.score,
        });
        record.rank = newRank;
      }

      // Consecutive bad block tracking (for recovery logic)
      if (delta < 0) {
        record.consecutiveBadBlocks++;
      } else {
        // A positive block resets the counter
        record.consecutiveBadBlocks = 0;
        if (record.recoveryState === 'recovery') {
          record.recoveryState = 'back_on_track';
        }
      }

      // Set recovery state (system-core §13.1)
      if (record.recoveryState !== 'back_on_track') {
        if      (record.consecutiveBadBlocks >= RECOVERY_THRESHOLDS.softReset)  record.recoveryState = 'recovery';
        else if (record.consecutiveBadBlocks >= RECOVERY_THRESHOLDS.recovery)   record.recoveryState = 'recovery';
        else if (record.consecutiveBadBlocks >= RECOVERY_THRESHOLDS.drift)      record.recoveryState = 'drift';
        else                                                                      record.recoveryState = 'normal';
      }

      return state;
    });
  }

  /** Directly overwrite a habit identity record (used by scoring engine for full refresh). */
  function updateHabitIdentityRecord(habitId, updates) {
    return setState(state => {
      if (!state.habitIdentityScores[habitId]) {
        state.habitIdentityScores[habitId] = _buildHabitIdentityDefault();
      }
      Object.assign(state.habitIdentityScores[habitId], updates);
      return state;
    });
  }

  /** Soft reset: set recovery baseline but preserve history (system-core §13.3). */
  function softResetHabitScore(habitId) {
    return setState(state => {
      const record = state.habitIdentityScores[habitId];
      if (!record) return state;
      record.recoveryBaseline     = record.score;
      record.consecutiveBadBlocks = 0;
      record.recoveryState        = 'recovery';
      // Score itself is NOT changed — history is preserved.
      return state;
    });
  }

  /** Acknowledge back-on-track state (clears the special state after one session). */
  function clearBackOnTrack(habitId) {
    return setState(state => {
      if (state.habitIdentityScores[habitId] &&
          state.habitIdentityScores[habitId].recoveryState === 'back_on_track') {
        state.habitIdentityScores[habitId].recoveryState = 'normal';
      }
      return state;
    });
  }

  function getOverallIdentityScore() {
    return getState().overallIdentityScore || { score: 0, rank: 'Seed', lastUpdated: today() };
  }

  function updateOverallIdentityScore(score, rank) {
    return setState(state => {
      state.overallIdentityScore = { score, rank, lastUpdated: today() };
      return state;
    });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 15 — STREAK CALCULATION
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Count consecutive days ending at `endDate` (default today) where
   * the habit score > 0.
   *
   * Rule: if today has not been logged yet, we don't break the streak —
   * we check yesterday as the most recent confirmed day.
   */
  function getStreak(habitId, endDate) {
    const end   = endDate || today();
    let streak  = 0;
    let cursor  = end;
    let checked = 0;

    while (checked < 730) { // hard cap at 2 years
      const score = getDailyScore(cursor, habitId);

      if (score > 0) {
        streak++;
        cursor = addDays(cursor, -1);
        checked++;
      } else if (checked === 0 && score === 0) {
        // Today not yet logged — don't break streak, check yesterday
        cursor = addDays(cursor, -1);
        checked++;
      } else {
        break;
      }
    }
    return streak;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 16 — UI STATE PERSISTENCE
  // ═══════════════════════════════════════════════════════════════════════════

  function getUIState() {
    return getState().ui || {};
  }

  function setUIState(updates) {
    return setState(state => {
      state.ui = Object.assign(state.ui || {}, updates, { lastVisited: today() });
      return state;
    });
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 17 — HELPER: RANK FROM SCORE
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Given a numeric score and a rank-threshold array, return the matching rank name.
   * Used internally and exported for the scoring engine.
   */
  function _rankFromScore(score, thresholds) {
    for (let i = thresholds.length - 1; i >= 0; i--) {
      if (score >= thresholds[i].min) return thresholds[i].rank;
    }
    return thresholds[0].rank;
  }

  function habitRankFromScore(score) {
    return _rankFromScore(score, HABIT_RANKS);
  }

  function overallRankFromScore(score) {
    return _rankFromScore(score, OVERALL_RANKS);
  }

  /**
   * Progress percentage within the current rank band (§8.5).
   * Returns 0–100.
   */
  function progressPct(score, thresholds) {
    const currentRankThreshold = thresholds.find(r => score >= r.min && score < r.max)
                              || thresholds[thresholds.length - 1];
    const { min, max } = currentRankThreshold;
    if (!isFinite(max)) return 99; // Forest rank — never quite 100%
    return Math.min(100, Math.round(((score - min) / (max - min)) * 100));
  }

  function habitProgressPct(score) {
    return progressPct(score, HABIT_RANKS);
  }

  function overallProgressPct(score) {
    return progressPct(score, OVERALL_RANKS);
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 18 — DEBUG / ADMIN
  // ═══════════════════════════════════════════════════════════════════════════

  /** Hard wipe — removes all data. User must confirm before calling. */
  function resetAll() {
    localStorage.removeItem(STORAGE_KEY);
    console.warn('[AS:data] All data wiped. Reload to reinitialize.');
  }

  /** Export full state as a JSON string (for backup). */
  function exportJSON() {
    return JSON.stringify(getState(), null, 2);
  }

  /** Import a JSON string (for restore). Validates version field. */
  function importJSON(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.initialized) throw new Error('Not a valid AtomicScott state.');
      _save(parsed);
      console.log('[AS:data] Import successful.');
      return true;
    } catch (e) {
      console.error('[AS:data] Import failed:', e);
      return false;
    }
  }

  /**
   * Seed a handful of test log entries so the scoring engine has data to work with.
   * Only call this from the browser console during development.
   */
  function _devSeedTestData() {
    const t = today();
    // Seed 5 days of diet scores around the worked example (target result: 6.02)
    [
      { d: addDays(t, -4), score: 6.0  },
      { d: addDays(t, -3), score: 7.5  },
      { d: addDays(t, -2), score: 5.0  },
      { d: addDays(t, -1), score: 8.0  },
      { d: t,              score: 3.5  },
    ].forEach(({ d, score }) => setDailyScore(d, 'diet', score, 'dev seed'));
    console.log('[AS:data] Test data seeded. Check console for block preview in scoring engine.');
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  return Object.freeze({
    // ── Constants ────────────────────────────────────────────────────────────
    OUTCOME_SCORES,
    ENGAGEMENT_ZONES,
    HABIT_RANKS,
    OVERALL_RANKS,
    MEAL_WEIGHTS,
    PROPORTION_CAP,
    PROPORTION_FLOOR,
    RECOVERY_THRESHOLDS,

    // ── Date utilities ────────────────────────────────────────────────────────
    dateToString,
    today,
    addDays,
    daysBetween,
    getBlockMeta,
    getCurrentBlockMeta,
    getBlockMetaForDate,

    // ── Raw state (scoring engine needs this) ─────────────────────────────────
    getState,
    setState,

    // ── Habits ───────────────────────────────────────────────────────────────
    getAllHabits,
    getActiveHabits,
    getHabitById,
    getDietHabits,

    // ── Daily logs ────────────────────────────────────────────────────────────
    getDailyLog,
    getDayLogs,
    getDailyScore,
    setDailyOutcome,
    setDailyScore,
    getDailyScoreRange,

    // ── Meal logs ─────────────────────────────────────────────────────────────
    getMealLog,
    getDayMealLogs,
    setMealLog,
    setMealScore,
    getMealScore,

    // ── Food database ─────────────────────────────────────────────────────────
    getFoodDatabase,
    getFoodById,
    upsertFood,

    // ── Meal templates ────────────────────────────────────────────────────────
    getMealTemplates,
    getMealTemplateById,
    upsertMealTemplate,

    // ── Block history ─────────────────────────────────────────────────────────
    getBlockHistory,
    getLatestBlock,
    saveClosedBlock,

    // ── Identity scores ───────────────────────────────────────────────────────
    getHabitIdentityScore,
    addToHabitIdentityScore,
    updateHabitIdentityRecord,
    softResetHabitScore,
    clearBackOnTrack,
    getOverallIdentityScore,
    updateOverallIdentityScore,

    // ── Streak ────────────────────────────────────────────────────────────────
    getStreak,

    // ── Rank helpers ──────────────────────────────────────────────────────────
    habitRankFromScore,
    overallRankFromScore,
    habitProgressPct,
    overallProgressPct,

    // ── UI state ──────────────────────────────────────────────────────────────
    getUIState,
    setUIState,

    // ── Debug (dev only) ──────────────────────────────────────────────────────
    resetAll,
    exportJSON,
    importJSON,
    _devSeedTestData,
  });

})();

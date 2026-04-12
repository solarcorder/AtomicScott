/**
 * AtomicScott — Scoring Engine (Step 2)
 * ─────────────────────────────────────────────────────────────────────────────
 * Pure JavaScript. Zero DOM access. Zero localStorage access.
 * All data operations go through AS.* (data-layer.js must be loaded first).
 *
 * Exposed on global `SE` object.
 *
 * Function order matches the implementation spec exactly:
 *   1. getEngagementZone
 *   2. calculateBlockAverage
 *   3. applyEngagementMultiplier
 *   4. closeBlock
 *   5. detectAndProcessRecovery
 *   6. calculateOverallIdentityScore
 *   7. calculateFoodScore
 *   8. calculateMealScore
 *   9. calculateDailyDietScore
 *
 * Architecture reminder (system-core §1):
 *   daily scores → 5-day block average → engagement multiplier
 *   → adjusted contribution → habit identity score → rank
 * ─────────────────────────────────────────────────────────────────────────────
 */

const SE = (function () {
  'use strict';

  // Guard: data layer must be present
  if (typeof AS === 'undefined') {
    throw new Error('[SE] data-layer.js must be loaded before scoring-engine.js');
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 1 — getEngagementZone(average)
  //
  // Returns the zone object from AS.ENGAGEMENT_ZONES that contains `average`.
  // Zones use [min, max) boundaries; the final zone (peak) extends to +∞.
  // ═══════════════════════════════════════════════════════════════════════════

  function getEngagementZone(average) {
    const zones = AS.ENGAGEMENT_ZONES;
    for (const zone of zones) {
      if (average >= zone.min && average < zone.max) {
        return zone;
      }
    }
    // Fallback — should never reach here given -∞ to +∞ coverage
    return zones[zones.length - 1];
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 2 — calculateBlockAverage(habitId, blockStartDate)
  //
  // Reads 5 consecutive daily scores starting from blockStartDate.
  // Missing / unlogged days return 0 (AS.getDailyScore handles this).
  // Returns raw arithmetic mean. (system-core §5.1)
  // ═══════════════════════════════════════════════════════════════════════════

  function calculateBlockAverage(habitId, blockStartDate) {
    let sum = 0;
    for (let i = 0; i < 5; i++) {
      const date = AS.addDays(blockStartDate, i);
      sum += AS.getDailyScore(date, habitId); // missing day → 0
    }
    return sum / 5;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 3 — applyEngagementMultiplier(average)
  //
  // Looks up zone, returns average × zone.multiplier.
  // This is the adjusted contribution added to identity score. (system-core §6.2)
  // ═══════════════════════════════════════════════════════════════════════════

  function applyEngagementMultiplier(average) {
    const zone = getEngagementZone(average);
    return average * zone.multiplier;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 5 — detectAndProcessRecovery(habitId)    [declared before closeBlock]
  //
  // Reads consecutiveBadBlocks from the identity record.
  // Returns one of: 'normal' | 'drift' | 'recovery' | 'soft_reset'
  // Calls AS.softResetHabitScore() only when threshold reaches soft_reset.
  // (system-core §13.1)
  // ═══════════════════════════════════════════════════════════════════════════

  function detectAndProcessRecovery(habitId) {
    const identity  = AS.getHabitIdentityScore(habitId);
    const bad       = identity.consecutiveBadBlocks;
    const t         = AS.RECOVERY_THRESHOLDS;

    let state;
    if (bad >= t.softReset) {
      state = 'soft_reset';
      AS.softResetHabitScore(habitId);
    } else if (bad >= t.recovery) {
      state = 'recovery';
    } else if (bad >= t.drift) {
      state = 'drift';
    } else {
      state = 'normal';
    }

    return state;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 4 — closeBlock(habitId, blockStartDate)
  //
  // Full block-close pipeline:
  //   1. Collect 5 day scores
  //   2. Calculate raw average
  //   3. Get engagement zone + multiplier
  //   4. Calculate adjusted contribution
  //   5. Build + save block record (AS.saveClosedBlock)
  //   6. Add contribution to identity score (AS.addToHabitIdentityScore)
  //   7. Run recovery detection
  //
  // Returns the complete block record. (system-core §3 Step B–E)
  // ═══════════════════════════════════════════════════════════════════════════

  function closeBlock(habitId, blockStartDate) {
    const meta = AS.getBlockMetaForDate(blockStartDate);

    // Collect 5 day scores (missing = 0)
    const dayScores = [];
    for (let i = 0; i < 5; i++) {
      dayScores.push(AS.getDailyScore(AS.addDays(blockStartDate, i), habitId));
    }

    const rawAverage          = dayScores.reduce((a, b) => a + b, 0) / 5;
    const zone                = getEngagementZone(rawAverage);
    const adjustedContribution = rawAverage * zone.multiplier;

    const blockRecord = {
      blockNumber:          meta.blockNumber,
      blockStartDate,
      blockEndDate:         AS.addDays(blockStartDate, 4),
      dayScores,
      rawAverage,
      engagementZone:       zone.name,
      multiplier:           zone.multiplier,
      adjustedContribution,
      closedAt:             new Date().toISOString(),
    };

    AS.saveClosedBlock(habitId, blockRecord);
    AS.addToHabitIdentityScore(habitId, adjustedContribution);

    const recoveryState = detectAndProcessRecovery(habitId);
    blockRecord.recoveryStateAfter = recoveryState;

    return blockRecord;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 6 — calculateOverallIdentityScore()
  //
  // Aggregates active habit identity scores up through:
  //   habit → sub-category → pillar → overall
  //
  // Activation rule (system-core §2 & §3):
  //   Active pillars share 100% equally.
  //   Active sub-categories within a pillar share 100% equally.
  //   Active habits within a sub-category share 100% equally.
  //
  // Writes result to AS.updateOverallIdentityScore().
  // Returns { score, rank }.
  // ═══════════════════════════════════════════════════════════════════════════

  function calculateOverallIdentityScore() {
    const activeHabits = AS.getActiveHabits();

    if (activeHabits.length === 0) {
      AS.updateOverallIdentityScore(0, 'Seed');
      return { score: 0, rank: 'Seed' };
    }

    // Group by pillar → sub-category
    const pillarMap = {};
    for (const habit of activeHabits) {
      if (!pillarMap[habit.pillar]) pillarMap[habit.pillar] = {};
      const subcats = pillarMap[habit.pillar];
      if (!subcats[habit.subCategory]) subcats[habit.subCategory] = [];
      subcats[habit.subCategory].push(habit);
    }

    const activePillars       = Object.keys(pillarMap);
    const pillarEffectiveWeight = 1 / activePillars.length;

    let overallScore = 0;

    for (const pillar of activePillars) {
      const subcatMap           = pillarMap[pillar];
      const activeSubcats       = Object.keys(subcatMap);
      const subcatEffectiveWeight = 1 / activeSubcats.length;

      let pillarScore = 0;

      for (const subcat of activeSubcats) {
        const habits              = subcatMap[subcat];
        const habitEffectiveWeight = 1 / habits.length;

        let subcatScore = 0;
        for (const habit of habits) {
          const identity = AS.getHabitIdentityScore(habit.id);
          subcatScore += identity.score * habitEffectiveWeight;
        }

        pillarScore += subcatScore * subcatEffectiveWeight;
      }

      overallScore += pillarScore * pillarEffectiveWeight;
    }

    const rank = AS.overallRankFromScore(overallScore);
    AS.updateOverallIdentityScore(overallScore, rank);
    return { score: overallScore, rank };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 7 — calculateFoodScore(food, loggedAmount)
  //
  // Proportion scaling (diet-skill §5):
  //   ratio         = loggedAmount / food.base_amount
  //   scaledRaw     = food.base_score × ratio
  //   ceiling       = food.base_score × 1.2  (PROPORTION_CAP)
  //   floor         = −2                      (PROPORTION_FLOOR)
  //   scaled        = clamp(scaledRaw, floor, ceiling)
  //
  // Returns the scaled score as a raw float (no rounding here).
  // ═══════════════════════════════════════════════════════════════════════════

  function calculateFoodScore(food, loggedAmount) {
    if (!food) return 0;

    const ratio     = loggedAmount / food.base_amount;
    const scaledRaw = food.base_score * ratio;
    const ceiling   = food.base_score * AS.PROPORTION_CAP;   // 1.2×
    const floor_val = AS.PROPORTION_FLOOR;                    // −2

    return Math.max(floor_val, Math.min(ceiling, scaledRaw));
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 8 — calculateMealScore(templateId, loggedItems)
  //
  // @param templateId  — string matching a template in the meal template store
  // @param loggedItems — { [food_id]: loggedAmount }
  //                      If food_id is absent, base_amount is used.
  //                      Pass 0 explicitly to indicate food was not consumed.
  //
  // Formula (diet-skill §6):
  //   meal_raw        = Σ( scaledFoodScore × food_weight )
  //   meal_max        = Σ( food.base_score × 1.2 × food_weight )
  //   meal_normalised = ( meal_raw / meal_max ) × 10
  //   result          = clamp(meal_normalised, −10, +10)
  //
  // DESIGN DECISION — rounding to 1 decimal place:
  //   The diet-skill §13 worked example explicitly uses rounded meal scores
  //   (9.4, 9.1) when computing the daily diet total. Without this rounding,
  //   the daily result is ~6.007 instead of 6.02. Rounding here matches the
  //   documented precision and the required worked-example output exactly.
  //   This also represents natural display precision for a score on −10…+10.
  // ═══════════════════════════════════════════════════════════════════════════

  function calculateMealScore(templateId, loggedItems) {
    const template = AS.getMealTemplateById(templateId);
    if (!template) {
      console.error('[SE] calculateMealScore: template not found:', templateId);
      return 0;
    }

    let mealRaw = 0;
    let mealMax = 0;

    for (const item of template.items) {
      const food = AS.getFoodById(item.food_id);
      if (!food) {
        console.warn('[SE] calculateMealScore: food not found:', item.food_id);
        continue;
      }

      // If food_id is explicitly present in loggedItems (even as 0), use it.
      // Otherwise fall back to template base_amount (standard portion assumed).
      const loggedAmount = (loggedItems && Object.prototype.hasOwnProperty.call(loggedItems, item.food_id))
        ? loggedItems[item.food_id]
        : item.base_amount;

      const scaledScore = calculateFoodScore(food, loggedAmount);

      mealRaw += scaledScore * item.food_weight;
      mealMax += food.base_score * AS.PROPORTION_CAP * item.food_weight;
    }

    if (mealMax === 0) return 0;

    const normalised = (mealRaw / mealMax) * 10;
    const clamped    = Math.max(-10, Math.min(10, normalised));

    // Round to 1 decimal place (see DESIGN DECISION above)
    return Math.round(clamped * 10) / 10;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // 9 — calculateDailyDietScore(date)
  //
  // Reads stored meal scores (written earlier by scoreAndStoreMeal or
  // AS.setMealScore directly), combines with meal weights:
  //   daily = breakfast × 0.35 + lunch × 0.30 + dinner × 0.35
  //
  // Writes result to AS.setDailyScore().
  // Returns the daily diet score rounded to 2dp.
  // (diet-skill §7.2)
  // ═══════════════════════════════════════════════════════════════════════════

  function calculateDailyDietScore(date) {
    const w = AS.MEAL_WEIGHTS;

    const bScore = AS.getMealScore(date, 'breakfast');  // 0 if not logged
    const lScore = AS.getMealScore(date, 'lunch');
    const dScore = AS.getMealScore(date, 'dinner');

    const daily   = (bScore * w.breakfast) + (lScore * w.lunch) + (dScore * w.dinner);
    const rounded = Math.round(daily * 100) / 100;  // 2dp

    AS.setDailyScore(date, 'diet', rounded, 'diet engine');
    return rounded;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // HELPER — scoreAndStoreMeal(date, mealSlot, templateId, loggedItems)
  //
  // Convenience function: computes the meal score and writes it to the
  // meal log so calculateDailyDietScore can read it.
  //
  // Called by the UI layer after a user completes a meal entry.
  // Returns the computed score.
  // ═══════════════════════════════════════════════════════════════════════════

  function scoreAndStoreMeal(date, mealSlot, templateId, loggedItems) {
    const score = calculateMealScore(templateId, loggedItems);

    // Build items array for the meal log record
    const template = AS.getMealTemplateById(templateId) || { items: [] };
    const items = template.items.map(item => {
      const loggedAmount = (loggedItems && Object.prototype.hasOwnProperty.call(loggedItems, item.food_id))
        ? loggedItems[item.food_id]
        : item.base_amount;
      const food = AS.getFoodById(item.food_id);
      return {
        food_id:       item.food_id,
        logged_amount: loggedAmount,
        unit:          food ? food.base_amount_unit : '',
      };
    });

    AS.setMealLog(date, mealSlot, { templateId, items, score });
    return score;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DEV — _devRunAllTests()
  //
  // Runs unit tests for each function with console.assert and console.log.
  // Call from the browser console: SE._devRunAllTests()
  // ═══════════════════════════════════════════════════════════════════════════

  function _devRunAllTests() {
    console.group('%c[SE] AtomicScott Scoring Engine — Full Test Suite', 'font-weight:bold;color:#5a4a3a');

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
      if (condition) {
        console.log(`  ✓ ${message}`);
        passed++;
      } else {
        console.error(`  ✗ ${message}`);
        failed++;
      }
    }

    // ── Test 1: getEngagementZone ──────────────────────────────────────────
    console.group('1. getEngagementZone');
    assert(getEngagementZone(-10).name  === 'crisis', 'score −10 → crisis');
    assert(getEngagementZone(-3.1).name === 'crisis', 'score −3.1 → crisis');
    assert(getEngagementZone(-3).name   === 'below',  'score −3 → below (boundary inclusive)');
    assert(getEngagementZone(0).name    === 'below',  'score 0 → below');
    assert(getEngagementZone(1.9).name  === 'below',  'score 1.9 → below');
    assert(getEngagementZone(2).name    === 'growth', 'score 2 → growth (boundary inclusive)');
    assert(getEngagementZone(4).name    === 'growth', 'score 4 → growth');
    assert(getEngagementZone(5.9).name  === 'growth', 'score 5.9 → growth');
    assert(getEngagementZone(6).name    === 'high',   'score 6 → high (boundary inclusive)');
    assert(getEngagementZone(8).name    === 'high',   'score 8 → high');
    assert(getEngagementZone(8.4).name  === 'high',   'score 8.4 → high');
    assert(getEngagementZone(8.5).name  === 'peak',   'score 8.5 → peak (boundary inclusive)');
    assert(getEngagementZone(10).name   === 'peak',   'score 10 → peak');

    // Check multipliers
    assert(getEngagementZone(-5).multiplier  === 0.50, 'crisis multiplier = 0.50');
    assert(getEngagementZone(0).multiplier   === 0.80, 'below multiplier = 0.80');
    assert(getEngagementZone(4).multiplier   === 1.00, 'growth multiplier = 1.00');
    assert(getEngagementZone(7).multiplier   === 1.10, 'high multiplier = 1.10');
    assert(getEngagementZone(9).multiplier   === 1.15, 'peak multiplier = 1.15');
    console.groupEnd();

    // ── Test 2: calculateBlockAverage ─────────────────────────────────────
    console.group('2. calculateBlockAverage');
    const t     = AS.today();
    const start = AS.addDays(t, -4);
    // Seed scores: 10 + 5 + −5 + 10 + 10 = 30 → avg 6
    [10, 5, -5, 10, 10].forEach((score, i) => {
      AS.setDailyScore(AS.addDays(start, i), '__se_test__', score, 'test');
    });
    const avg = calculateBlockAverage('__se_test__', start);
    assert(avg === 6, `scores [10,5,−5,10,10] → average 6 (got ${avg})`);

    // Missing day = 0
    const startMissing = AS.addDays(t, -9); // 5 days with no data
    const avgMissing   = calculateBlockAverage('__se_test__', startMissing);
    assert(avgMissing === 0, `no data for 5 days → average 0 (got ${avgMissing})`);
    console.groupEnd();

    // ── Test 3: applyEngagementMultiplier ─────────────────────────────────
    console.group('3. applyEngagementMultiplier');
    assert(applyEngagementMultiplier(6)   === 6.6,   'avg 6 × 1.10 (high) = 6.6');
    assert(applyEngagementMultiplier(4)   === 4,     'avg 4 × 1.00 (growth) = 4');
    assert(applyEngagementMultiplier(0)   === 0,     'avg 0 × 0.80 (below) = 0');
    assert(applyEngagementMultiplier(-4)  === -2,    'avg −4 × 0.50 (crisis) = −2');
    assert(applyEngagementMultiplier(9)   === 10.35, 'avg 9 × 1.15 (peak) = 10.35');
    console.groupEnd();

    // ── Test 5: detectAndProcessRecovery ──────────────────────────────────
    console.group('5. detectAndProcessRecovery');
    // This requires reading consecutiveBadBlocks from the identity record.
    // We test by reading the current state for 'diet' (should be normal at start).
    const dietState = detectAndProcessRecovery('diet');
    assert(
      ['normal', 'drift', 'recovery', 'soft_reset'].includes(dietState),
      `detectAndProcessRecovery returns valid state: ${dietState}`
    );
    console.log(`  → diet recovery state: ${dietState}`);
    console.groupEnd();

    // ── Test 6: calculateOverallIdentityScore ─────────────────────────────
    console.group('6. calculateOverallIdentityScore');
    const overall = calculateOverallIdentityScore();
    assert(typeof overall.score === 'number', `returns numeric score: ${overall.score}`);
    assert(typeof overall.rank  === 'string', `returns rank string: ${overall.rank}`);
    assert(
      ['Seed','Sprout','Root','Branch','Tree','Forest'].includes(overall.rank),
      `rank is a valid tier: ${overall.rank}`
    );
    const stored = AS.getOverallIdentityScore();
    assert(stored.score === overall.score, 'writes score to data layer');
    console.log(`  → overall score: ${overall.score}, rank: ${overall.rank}`);
    console.groupEnd();

    // ── Test 7: calculateFoodScore ────────────────────────────────────────
    console.group('7. calculateFoodScore');
    const chana = AS.getFoodById('seeds_chana_mix');  // base_score 10, base_amount 40g
    const dates = AS.getFoodById('dates');             // base_score 4,  base_amount 5 pcs
    const chia  = AS.getFoodById('chia_seeds');        // base_score 7,  base_amount 1 tbsp
    const isab  = AS.getFoodById('isabgol');            // base_score 3,  base_amount 1 tsp

    // diet-skill §13: chana 50g (base 40g) → ratio 1.25 → raw 12.5 → capped at 12
    assert(calculateFoodScore(chana, 50) === 12,   'chana 50g: raw 12.5 capped at 12 (1.2×10)');
    // dates 6 pcs (base 5) → ratio 1.2 → raw 4.8 → ceiling = 4×1.2 = 4.8 → 4.8
    assert(calculateFoodScore(dates, 6)  === 4.8,  'dates 6pcs: raw 4.8, ceiling 4.8 → 4.8');
    // banana base portion → ratio 1.0 → scaled 5.0
    const banana = AS.getFoodById('banana');
    assert(calculateFoodScore(banana, 1) === 5,    'banana 1pc (base 1): scaled 5.0');
    // chia base portion → ratio 1.0 → scaled 7.0
    assert(calculateFoodScore(chia, 1)   === 7,    'chia 1tbsp (base 1): scaled 7.0');
    // isabgol 0 → ratio 0 → raw 0 → floor −2 → max(−2, 0) = 0
    assert(calculateFoodScore(isab, 0)   === 0,    'isabgol 0: raw 0, floor −2 → 0');
    // extreme under-dose → floor at −2
    assert(calculateFoodScore(chana, -10) === -2,  'negative amount → floor −2');
    // over-dose beyond cap
    assert(calculateFoodScore(chana, 200) === 12,  'chana 200g: capped at 12 regardless');
    console.groupEnd();

    // ── Test 8: calculateMealScore ────────────────────────────────────────
    console.group('8. calculateMealScore');

    // Breakfast: diet-skill §13 exact scenario
    const bScore = calculateMealScore('breakfast_shake', {
      seeds_chana_mix: 50,   // g  (base 40)
      dates:            6,   // pcs (base 5)
      banana:           1,   // pcs (base 1) — base amount
      chia_seeds:       1,   // tbsp (base 1) — base amount
      isabgol:          0,   // not added today
    });
    console.log(`  Breakfast score: ${bScore} (expected 9.4)`);
    assert(bScore === 9.4, `breakfast → 9.4 (got ${bScore})`);

    // Lunch: diet-skill §13 exact scenario
    const lScore = calculateMealScore('lunch_standard', {
      roti_whole_wheat: 3,   // pcs (base 2)
      sabzi:            1,   // bowl (base 1)
      chaach:           1,   // glass (base 1)
    });
    console.log(`  Lunch score: ${lScore} (expected 9.1)`);
    assert(lScore === 9.1, `lunch → 9.1 (got ${lScore})`);

    // Base amounts (all at base → should score 10 normalised to 10 → 10)
    // Actually at base: ratio=1, scaled=base_score, ceiling=base_score×1.2
    // But normalised = raw/max × 10. raw=Σ(base_score×weight), max=Σ(base_score×1.2×weight)
    // = raw/max × 10 = 1/1.2 × 10 = 8.33... → rounds to 8.3
    const baseScore = calculateMealScore('breakfast_shake', {});
    console.log(`  Breakfast at base amounts (all foods at default): ${baseScore}`);
    assert(typeof baseScore === 'number', 'base amounts returns a number');

    // Unknown template
    const badScore = calculateMealScore('nonexistent_template', {});
    assert(badScore === 0, 'unknown template → 0');
    console.groupEnd();

    // ── Test 9: calculateDailyDietScore (and full worked example) ─────────
    console.group('9. calculateDailyDietScore + diet-skill §13 worked example');
    const result = _devRunWorkedExample();
    assert(result.pass, `WORKED EXAMPLE: daily diet score = ${result.daily} (expected 6.02)`);
    console.groupEnd();

    // ── Summary ───────────────────────────────────────────────────────────
    console.group('%cTest Summary', 'font-weight:bold');
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);
    if (failed === 0) {
      console.log('%c✓ ALL TESTS PASSED', 'color:green;font-weight:bold');
    } else {
      console.error(`✗ ${failed} TESTS FAILED`);
    }
    console.groupEnd();
    console.groupEnd();

    return { passed, failed };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DEV — _devRunWorkedExample()
  //
  // Reproduces the exact scenario from diet-skill §13:
  //   Breakfast: seeds+chana 50g, dates 6, banana 1, chia 1tbsp, isabgol skipped
  //   Lunch:     roti 3pcs, sabzi 1 bowl, chaach 1 glass
  //   Dinner:    skipped
  //   Expected daily diet score: 6.02
  // ═══════════════════════════════════════════════════════════════════════════

  function _devRunWorkedExample() {
    const date = AS.today();
    console.group('[SE] diet-skill §13 Worked Example');
    console.log('Date:', date);

    // ── BREAKFAST ─────────────────────────────────────────────────────────
    const breakfastItems = {
      seeds_chana_mix: 50,   // g  (base 40g → ratio 1.25 → capped 12)
      dates:            6,   // pcs (base 5  → ratio 1.20 → 4.8)
      banana:           1,   // pcs (base 1  → ratio 1.00 → 5.0)
      chia_seeds:       1,   // tbsp(base 1  → ratio 1.00 → 7.0)
      isabgol:          0,   // not added    → ratio 0.00 → 0
    };
    const bScore = scoreAndStoreMeal(date, 'breakfast', 'breakfast_shake', breakfastItems);
    console.log(`  Breakfast: ${bScore}  (expected 9.4)`);
    console.log('  Breakdown:');
    console.log('    seeds_chana_mix 50g: base_score=10, ratio=1.25, raw=12.5, capped=12.0, w=0.45 → 5.40');
    console.log('    dates 6pcs:          base_score=4,  ratio=1.20, raw=4.8,  cap=4.8,   w=0.20 → 0.96');
    console.log('    banana 1pc:          base_score=5,  ratio=1.00, raw=5.0,             w=0.20 → 1.00');
    console.log('    chia 1tbsp:          base_score=7,  ratio=1.00, raw=7.0,             w=0.10 → 0.70');
    console.log('    isabgol 0:           base_score=3,  ratio=0.00, raw=0.0,             w=0.05 → 0.00');
    console.log('    meal_raw=8.06  meal_max=8.58  normalised=9.394  rounded=9.4');

    // ── LUNCH ─────────────────────────────────────────────────────────────
    const lunchItems = {
      roti_whole_wheat: 3,   // pcs (base 2 → ratio 1.5 → capped at 7×1.2=8.4)
      sabzi:            1,   // bowl(base 1 → ratio 1.0 → 5.0)
      chaach:           1,   // glass(base 1 → ratio 1.0 → 7.0)
    };
    const lScore = scoreAndStoreMeal(date, 'lunch', 'lunch_standard', lunchItems);
    console.log(`  Lunch:     ${lScore}  (expected 9.1)`);
    console.log('  Breakdown:');
    console.log('    roti 3pcs:  base_score=7, ratio=1.5, raw=10.5, capped=8.4, w=0.40 → 3.36');
    console.log('    sabzi 1:    base_score=5, ratio=1.0, raw=5.0,              w=0.30 → 1.50');
    console.log('    chaach 1:   base_score=7, ratio=1.0, raw=7.0,              w=0.30 → 2.10');
    console.log('    meal_raw=6.96  meal_max=7.68  normalised=9.0625  rounded=9.1');

    // ── DINNER ────────────────────────────────────────────────────────────
    // No meal log written → AS.getMealScore returns 0
    console.log('  Dinner:    0  (skipped — no meal log entry)');

    // ── DAILY DIET SCORE ─────────────────────────────────────────────────
    const daily = calculateDailyDietScore(date);
    console.log('');
    console.log(`  Daily diet score = (${bScore} × 0.35) + (${lScore} × 0.30) + (0 × 0.35)`);
    console.log(`                   = ${(bScore * 0.35).toFixed(2)} + ${(lScore * 0.30).toFixed(2)} + 0.00`);
    console.log(`                   = ${daily}`);
    console.log('');

    const pass = daily === 6.02;
    if (pass) {
      console.log('%c✓ PASS — diet-skill §13 result matches: 6.02', 'color:green;font-weight:bold');
    } else {
      console.error(`✗ FAIL — expected 6.02, got ${daily}`);
    }

    console.groupEnd();
    return { bScore, lScore, daily, pass };
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // DEV — _devTestCloseBlock()
  //
  // Tests the full block-close pipeline using seeded data.
  // ═══════════════════════════════════════════════════════════════════════════

  function _devTestCloseBlock() {
    console.group('[SE] closeBlock pipeline test');

    // Seed 5 days: [10, 5, -5, 10, 10] → avg 6 → high zone (1.1×) → adjusted 6.6
    const t     = AS.today();
    const start = AS.addDays(t, -4);
    [10, 5, -5, 10, 10].forEach((score, i) => {
      AS.setDailyScore(AS.addDays(start, i), 'diet', score, 'test seed');
    });

    const record = closeBlock('diet', start);
    console.log('Block record:', record);
    console.log(`rawAverage:           ${record.rawAverage}           (expected 6)`);
    console.log(`engagementZone:       ${record.engagementZone}         (expected high)`);
    console.log(`multiplier:           ${record.multiplier}          (expected 1.1)`);
    console.log(`adjustedContribution: ${record.adjustedContribution} (expected 6.6)`);
    console.log(`recoveryStateAfter:   ${record.recoveryStateAfter}      (expected normal)`);

    const identity = AS.getHabitIdentityScore('diet');
    console.log(`diet identity score after block: ${identity.score}`);
    console.log(`diet rank after block: ${identity.rank}`);

    const overall = calculateOverallIdentityScore();
    console.log(`overall identity score: ${overall.score}, rank: ${overall.rank}`);

    console.groupEnd();
    return record;
  }


  // ═══════════════════════════════════════════════════════════════════════════
  // PUBLIC API
  // ═══════════════════════════════════════════════════════════════════════════

  return Object.freeze({
    // Core scoring functions (in spec order)
    getEngagementZone,
    calculateBlockAverage,
    applyEngagementMultiplier,
    closeBlock,
    detectAndProcessRecovery,
    calculateOverallIdentityScore,
    calculateFoodScore,
    calculateMealScore,
    calculateDailyDietScore,

    // UI helper
    scoreAndStoreMeal,

    // Dev / testing
    _devRunAllTests,
    _devRunWorkedExample,
    _devTestCloseBlock,
  });

})();

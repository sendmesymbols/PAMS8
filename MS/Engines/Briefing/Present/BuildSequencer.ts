/**
 * BuildSequencer.ts
 *
 * Pure grouping logic for step-through builds. A slide's flat `BuildStep[]` is
 * partitioned into CLICK GROUPS: one group is everything a single briefer
 * advance reveals. Each step in a group carries an `at` offset from that
 * group's own clock zero, resolved from its `trigger`:
 *
 *   click      → starts a new group; at = its own delayMs
 *   withPrev   → joins the group, at = its own delayMs (parallel to the step before it)
 *   afterPrev  → joins the group, at = previous step's END + its own delayMs
 *
 * In 'auto' mode there is exactly ONE group holding every step at its original
 * absolute `delayMs` — bit-for-bit the pre-step-through schedule, which is why
 * briefings authored before this existed play back unchanged.
 *
 * No DOM, no ArcGIS, no engine state: everything here is a pure function of the
 * slide, so it is unit-tested directly (BuildSequencer.test.ts).
 */

import type { BuildStep, Slide, SlideBuildMode } from '../BriefingTypes';

/** A build step with its offset resolved against its group's clock. */
export interface ScheduledStep {
  step: BuildStep;
  /** ms from the group's start. */
  at: number;
}

/** Everything one briefer advance reveals. */
export interface BuildGroup {
  steps: ScheduledStep[];
  /** ms from group start to the last step finishing — the group's own length. */
  durationMs: number;
}

/** Absent buildMode means 'auto', so pre-existing slides keep timer playback. */
export function buildModeOf(slide: Slide | null | undefined): SlideBuildMode {
  return slide?.buildMode === 'click' ? 'click' : 'auto';
}

/**
 * Partition a slide's steps into click groups. Always returns at least an empty
 * array; a slide with no builds yields `[]` (zero groups — advancing leaves the
 * slide immediately).
 */
export function groupSteps(slide: Slide | null | undefined): BuildGroup[] {
  const steps = slide?.builds ?? [];
  if (!steps.length) return [];

  const finish = (group: ScheduledStep[]): BuildGroup => ({
    steps: group,
    durationMs: group.reduce(
      (end, s) => Math.max(end, s.at + Math.max(0, s.step.durationMs || 0)),
      0,
    ),
  });

  // 'auto': one group, absolute delays, no trigger interpretation whatsoever.
  if (buildModeOf(slide) === 'auto') {
    return [finish(steps.map((step) => ({ step, at: Math.max(0, step.delayMs || 0) })))];
  }

  const groups: BuildGroup[] = [];
  let current: ScheduledStep[] = [];
  // End of the step most recently placed — what 'afterPrev' chains off.
  let prevEnd = 0;

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const delay = Math.max(0, step.delayMs || 0);
    const duration = Math.max(0, step.durationMs || 0);
    // The first step always opens a group regardless of its trigger — a slide
    // whose leading step says 'withPrev' has no previous step to ride along with.
    const trigger = i === 0 ? 'click' : (step.trigger ?? 'click');

    if (trigger === 'click') {
      if (current.length) groups.push(finish(current));
      current = [];
      prevEnd = 0;
    }

    const at = trigger === 'afterPrev' ? prevEnd + delay : delay;
    current.push({ step, at });
    prevEnd = at + duration;
  }
  if (current.length) groups.push(finish(current));
  return groups;
}

/**
 * Every graphic id the slide's builds touch — the set present mode hides when
 * arming a click-mode slide, and the set it restores on the way out.
 */
export function buildTargetIds(slide: Slide | null | undefined): string[] {
  const seen = new Set<string>();
  for (const s of slide?.builds ?? []) if (s.graphicId) seen.add(s.graphicId);
  return [...seen];
}

/**
 * Graphic ids that should be VISIBLE once `revealed` groups have played.
 * Used both by step-through's instant back-step and by the exporter's
 * explode-builds path.
 */
export function revealedIds(groups: BuildGroup[], revealed: number): Set<string> {
  const ids = new Set<string>();
  for (let i = 0; i < Math.min(revealed, groups.length); i++) {
    for (const s of groups[i].steps) ids.add(s.step.graphicId);
  }
  return ids;
}

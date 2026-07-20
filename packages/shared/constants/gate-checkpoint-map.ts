/**
 * Canonical macro gate → macro_checkpoints.checkpoint_name (CASDM template) lookup.
 *
 * `macro_checkpoints` rows are CASDM checkpoints (e.g. 'Working SRS reviewed by SA'),
 * whose vocabulary differs from the 10 canonical MACRO_GATES. CR-16 resolves gates to
 * checkpoints via this EXPLICIT, DETERMINISTIC config lookup — never fuzzy matching.
 *
 * CASDM seeds 16 coarse checkpoints, fewer than the 10 canonical gates are granular, so a
 * handful of sibling gates intentionally collapse onto ONE shared checkpoint (2 gates → 1
 * checkpoint). This is deliberate, not name-drift:
 *   - 'Preliminary SRS validated'   shares '5 outputs reviewed by SA' with
 *     'Discovery outputs validated' (Preliminary SRS is one of the 5 Phase-0 outputs).
 *   - 'Spec strategy approved'      shares 'Technically validate 6 design docs with spec
 *     strategy by SA' with 'Design docs approved' (checkpoint name literally covers spec
 *     strategy).
 *   - 'Project documentation approved' shares 'Validate customer documentation by Tech Lead'
 *     with 'Runbooks approved' (Phase 4 combines Runbooks / Documentation).
 *
 * Behaviour of a shared checkpoint: the first-resolving sibling sets reached_at (resolved++);
 * the second is an idempotent no-op (`WHERE reached_at IS NULL` → 0 rows). Both gates still
 * point at a reached checkpoint, so the reached_at-driven UI shows both complete. The residual
 * `skipped` increment on the second sibling is cosmetic only.
 *
 * All 10 canonical gates are now mapped — there are NO intentionally-unmapped gates, so
 * resolveCheckpointForGate() always returns a real checkpoint for a canonical gate.
 *
 * Every value here is a real CASDM `macro_checkpoint` name seeded by
 * migrations/V003__phase2_additions.sql (verified against the live 16-checkpoint seed rows).
 *
 * Source: specs/phase2/CR-16-link-time-gate-detection-spec.md §6.1;
 *         migrations/V003__phase2_additions.sql (casdm_config macro_checkpoint seeds);
 *         aws-architect gate→checkpoint mapping correction (2026-07-09).
 */
import { MacroGate } from './macro-gates';

export const GATE_TO_CHECKPOINT: Record<MacroGate, string> = {
  'Discovery outputs validated': '5 outputs reviewed by SA',
  'Preliminary SRS validated': '5 outputs reviewed by SA',
  'SRS approved': 'Working SRS reviewed by SA',
  'Design docs approved': 'Technically validate 6 design docs with spec strategy by SA',
  'Implementation plan approved': 'Implementation Plan Review (Transcript Analysis)',
  'Spec strategy approved': 'Technically validate 6 design docs with spec strategy by SA',
  'Code approved': 'Review 3 generated outputs by Tech Lead',
  'UAT report approved': 'Validate performance, security, compliance by Tech Lead',
  'Runbooks approved': 'Validate customer documentation by Tech Lead',
  'Project documentation approved': 'Validate customer documentation by Tech Lead',
};

/**
 * Resolve the CASDM checkpoint name for a canonical macro gate.
 * Every canonical gate is mapped, so this always returns a real checkpoint name.
 * The `| undefined` return remains for defensive callers passing a non-canonical string.
 */
export function resolveCheckpointForGate(gate: MacroGate): string | undefined {
  return GATE_TO_CHECKPOINT[gate];
}

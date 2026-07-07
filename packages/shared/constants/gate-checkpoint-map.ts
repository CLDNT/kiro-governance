/**
 * Canonical macro gate → macro_checkpoints.checkpoint_name (CASDM template) lookup.
 *
 * `macro_checkpoints` rows are CASDM checkpoints (e.g. 'Working SRS reviewed by SA'),
 * whose vocabulary differs from the 10 canonical MACRO_GATES. CR-16 resolves gates to
 * checkpoints via this EXPLICIT, DETERMINISTIC config lookup — never fuzzy matching.
 *
 * A gate with no confident 1:1 CASDM checkpoint is intentionally OMITTED — such a resolved
 * gate is counted as `skipped` by the sync (never guessed), so the mapping's incompleteness
 * is observable rather than silently swallowed.
 *
 * Every value here is a real CASDM `macro_checkpoint` name seeded by
 * migrations/V003__phase2_additions.sql (verified against the 'default'/'AppDev' seed rows).
 *
 * Source: specs/phase2/CR-16-link-time-gate-detection-spec.md §6.1;
 *         migrations/V003__phase2_additions.sql (casdm_config macro_checkpoint seeds).
 *
 * Architect decision — the exact gate→checkpoint pairing is not customer-specified;
 * product to confirm completeness. Extending the map (or moving it to casdm_config) is a
 * follow-up; keeping it a typed constant makes it deterministic and unit-testable now.
 */
import { MacroGate } from './macro-gates';

export const GATE_TO_CHECKPOINT: Partial<Record<MacroGate, string>> = {
  'Discovery outputs validated': '5 outputs reviewed by SA',
  'SRS approved': 'Working SRS reviewed by SA',
  'Design docs approved': 'Technically validate 6 design docs with spec strategy by SA',
  'Implementation plan approved': 'Implementation Plan Review (Transcript Analysis)',
  'Code approved': 'Review 3 generated outputs by Tech Lead',
  'UAT report approved': 'Validate performance, security, compliance by Tech Lead',
  'Runbooks approved': 'Validate customer documentation by Tech Lead',
  // Intentionally unmapped (no confident 1:1 CASDM checkpoint) → counted as `skipped`:
  //   'Preliminary SRS validated', 'Spec strategy approved', 'Project documentation approved'
};

/**
 * Resolve the CASDM checkpoint name for a canonical macro gate.
 * Returns undefined for an intentionally-unmapped gate (caller counts it as `skipped`).
 */
export function resolveCheckpointForGate(gate: MacroGate): string | undefined {
  return GATE_TO_CHECKPOINT[gate];
}

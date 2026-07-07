/**
 * progress-tracker.parser — pure, deterministic extraction of RESOLVED macro gates
 * from a `docs/project-progress.md` tracker file.
 *
 * No I/O; fully unit-testable. Reuses the shared `matchGateFromText` so gate vocabulary
 * (canonical names + aliases) stays single-sourced.
 *
 * A line counts as a RESOLUTION MARKER only if it is either:
 *   (a) a completed task-list item — `- [x] …` / `* [x] …` (case-insensitive), or
 *   (b) a line containing the phrase "approved by" (case-insensitive).
 * For each marker line we ANCHOR to the documented tracker form `- [x] N.N <Gate> …`:
 * the bullet + `[x]` checkbox + optional `N.N` step number are stripped, then the gate
 * must appear at the START of the remaining text (see `matchGateAnchored`). Unchecked
 * items (`- [ ] … SRS approved`) and mere mentions are ignored — and, unlike a raw
 * whole-line substring match, a negated resolved marker (`- [x] Do not mark SRS approved
 * yet`) no longer false-positives because the gate is not at the anchored position.
 *
 * The gate vocabulary (canonical names + aliases) stays single-sourced from the shared
 * `macro-gates` constants; only the MATCH is anchored here (CR-16 gate-parse anchoring).
 *
 * Source: specs/phase2/CR-16-link-time-gate-detection-spec.md §5 (anchored to the
 * documented `[x] N.N <Gate>` prefix form).
 */
import {
  MacroGate,
  MACRO_GATES,
  MACRO_GATE_ALIASES,
} from '@kiro-governance/shared/constants/macro-gates';

/** Completed task-list item: `- [x] …` or `* [x] …` (leading whitespace tolerated). */
const CHECKED_ITEM_RE = /^\s*[-*]\s*\[x\]\s+/i;

/** Explicit human sign-off phrase. */
const APPROVED_BY_RE = /approved by/i;

/**
 * Strip a resolution-marker prefix down to the gate text, per the documented
 * `- [x] N.N <Gate>` form: leading whitespace, an optional bullet (`-`/`*`), an
 * optional `[x]`/`[ ]` checkbox, and an optional `N`/`N.N`/`N.N.N` step number
 * (with a trailing `.`/`)` tolerated). What remains should START with the gate.
 */
function stripMarkerPrefix(line: string): string {
  return line
    .replace(/^\s+/, '')
    .replace(/^[-*]\s*/, '')
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/^\d+(?:\.\d+)*[.)]?\s+/, '')
    .trimStart();
}

/**
 * Anchored gate match: the (prefix-stripped) text must START WITH a canonical
 * gate name or an alias. Canonical names are tried first — consistent with the
 * shared `matchGateFromText` alias-bleed fix. Returns the canonical MacroGate or
 * undefined. Anchoring (startsWith, not substring) is what rejects embedded /
 * negated gate mentions.
 */
function matchGateAnchored(text: string): MacroGate | undefined {
  const content = stripMarkerPrefix(text).toLowerCase();

  for (const gate of MACRO_GATES) {
    if (content.startsWith(gate.toLowerCase())) {
      return gate;
    }
  }
  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (content.startsWith(alias.toLowerCase())) {
      return canonical;
    }
  }
  return undefined;
}

/**
 * Parse a tracker markdown document into the set of RESOLVED canonical macro gates.
 * Returns a de-duplicated Set<MacroGate>. Empty input → empty set.
 */
export function parseResolvedGates(markdown: string): Set<MacroGate> {
  const resolved = new Set<MacroGate>();
  if (!markdown) {
    return resolved;
  }

  for (const line of markdown.split(/\r?\n/)) {
    const isMarker = CHECKED_ITEM_RE.test(line) || APPROVED_BY_RE.test(line);
    if (!isMarker) {
      continue;
    }
    const gate = matchGateAnchored(line);
    if (gate) {
      resolved.add(gate);
    }
  }

  return resolved;
}

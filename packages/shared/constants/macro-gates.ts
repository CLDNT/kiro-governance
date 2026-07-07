/**
 * Canonical macro gate names — single source of truth for gate string comparisons.
 * Must import from here — never hardcode gate strings.
 * Source: SRS §16 (Project Brief §4a), unified-data-model.md §2.6
 *
 * Changelog:
 * 2026-06-23 — Renamed 'Spec file approved' → 'Spec strategy approved' (Tariq Khan).
 *              Added GATE_PHASES and GATE_PHASE_NAMES aligned to CASDM phases.
 *              Corrected phase assignments: Discovery/Preliminary SRS → Phase 0,
 *              SRS approved → Phase 1 (was Phase 1 before, now explicit).
 */
export const MACRO_GATES = [
  'Discovery outputs validated',
  'Preliminary SRS validated',
  'SRS approved',
  'Design docs approved',
  'Implementation plan approved',
  'Spec strategy approved',
  'Code approved',
  'UAT report approved',
  'Runbooks approved',
  'Project documentation approved',
] as const;

export type MacroGate = typeof MACRO_GATES[number];

/**
 * CASDM phase number for each macro gate.
 * Source: CASDM Phase alignment — Tariq Khan 2026-06-23.
 */
export const GATE_PHASES: Record<MacroGate, string> = {
  'Discovery outputs validated':    'Phase 0',
  'Preliminary SRS validated':      'Phase 0',
  'SRS approved':                   'Phase 1',
  'Design docs approved':           'Phase 2',
  'Implementation plan approved':   'Phase 2',
  'Spec strategy approved':         'Phase 3',
  'Code approved':                  'Phase 3',
  'UAT report approved':            'Phase 3',
  'Runbooks approved':              'Phase 4',
  'Project documentation approved': 'Phase 4',
};

/**
 * CASDM phase human-readable name for each macro gate.
 * Source: Agentic Service Delivery Methodology_Final.pdf — Tariq Khan 2026-06-23.
 */
export const GATE_PHASE_NAMES: Record<MacroGate, string> = {
  'Discovery outputs validated':    'Internal Preparation',
  'Preliminary SRS validated':      'Internal Preparation',
  'SRS approved':                   'Discover & Align',
  'Design docs approved':           'Design & Review',
  'Implementation plan approved':   'Design & Review',
  'Spec strategy approved':         'Build & Implement',
  'Code approved':                  'Build & Implement',
  'UAT report approved':            'Build & Implement',
  'Runbooks approved':              'Launch & Enable',
  'Project documentation approved': 'Launch & Enable',
};

/**
 * Aliases for macro gates — case-insensitive user input maps to canonical names.
 * Source: data-persistence-architecture.md §7.1
 */
export const MACRO_GATE_ALIASES: Record<string, MacroGate> = {
  'solution architecture approved': 'Design docs approved',
  'sprint plan approved': 'Implementation plan approved',
  'documentation approved': 'Runbooks approved',
  'spec file approved': 'Spec strategy approved',
};

/**
 * Match free text against the canonical macro gates using case-insensitive
 * substring matching. Canonical gate names are tried FIRST, then aliases.
 *
 * Ordering matters: the alias `documentation approved` is a substring of the
 * canonical gate `Project documentation approved`. Trying aliases first would
 * make any "Project documentation approved" line bleed to `Runbooks approved`
 * (the alias target). Canonical-first prevents that bleed while still resolving
 * true aliases (e.g. `sprint plan approved`), which never contain a canonical
 * gate as a substring. First match wins; returns undefined when nothing matches.
 * Source: F-01 §4.2 (case-insensitive substring matching); CR-16 alias-bleed fix.
 */
export function matchGateFromText(text: string): MacroGate | undefined {
  const lowerText = text.toLowerCase().trim();

  // Try canonical gate matches first (avoids alias/canonical substring bleed).
  for (const gate of MACRO_GATES) {
    if (lowerText.includes(gate.toLowerCase())) {
      return gate;
    }
  }

  // Then try alias matches.
  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (lowerText.includes(alias.toLowerCase())) {
      return canonical;
    }
  }

  return undefined;
}

/**
 * Classify a governance update.
 *
 * Precedence (PLAN-H1 — change-requests/2026-07-02-github-slack-linkage-impact.md
 * v3-5.1, github-trigger-architecture.md §0.1):
 *   1. An explicitly-provided `type` is AUTHORITATIVE and always wins. A caller
 *      that passes `type:'micro'` is NEVER upgraded to macro, even when
 *      `update_text` contains a canonical gate name (this fixes the CI=MICRO
 *      split — a stored `type='macro'` from the CI path is a defect). For an
 *      explicit `type:'macro'` we still surface the matched gate label (if any)
 *      so downstream can derive the canonical gate name.
 *   2. Only when `type` is ABSENT do we auto-classify from the text via
 *      case-insensitive substring matching against MACRO_GATES / aliases.
 *
 * `flag_override` no longer gates whether an explicit `type` is honored — an
 * explicit `type` is enough on its own. `flag_override` is retained on the input
 * for the persistence layer / audit trail and belt-and-suspenders callers.
 *
 * Source: data-persistence-architecture.md §7.1, F-01 §4.1, PLAN-H1.
 */
export function classifyEvent(input: {
  update_text: string;
  type?: 'macro' | 'micro';
  flag_override?: boolean;
}): { resolvedType: 'macro' | 'micro'; matchedGate?: string } {
  // Explicit type is authoritative — it always wins over text-based inference.
  if (input.type) {
    return {
      resolvedType: input.type,
      // Only a macro event carries a matched gate; an explicit micro event is
      // never given a gate even if the text happens to contain one.
      matchedGate: input.type === 'macro' ? matchGateFromText(input.update_text) : undefined,
    };
  }

  // No explicit type → auto-classify from the update text.
  const matchedGate = matchGateFromText(input.update_text);
  if (matchedGate) {
    return { resolvedType: 'macro', matchedGate };
  }

  // No match → micro event
  return { resolvedType: 'micro' };
}

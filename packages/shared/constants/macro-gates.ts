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
 * Auto-classify a governance update based on text content.
 * Returns: macro event with matched gate, or micro event.
 * Source: data-persistence-architecture.md §7.1, F-01 §4.1
 */
export function classifyEvent(input: {
  update_text: string;
  type?: 'macro' | 'micro';
  flag_override?: boolean;
}): { resolvedType: 'macro' | 'micro'; matchedGate?: string } {
  // If caller provided explicit type + flag_override, use it as-is
  if (input.flag_override && input.type) {
    return { resolvedType: input.type, matchedGate: undefined };
  }

  const lowerText = input.update_text.toLowerCase().trim();

  // Try alias matches first
  for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
    if (lowerText.includes(alias.toLowerCase())) {
      return { resolvedType: 'macro', matchedGate: canonical };
    }
  }

  // Try canonical gate matches
  for (const gate of MACRO_GATES) {
    if (lowerText.includes(gate.toLowerCase())) {
      return { resolvedType: 'macro', matchedGate: gate };
    }
  }

  // No match → micro event
  return { resolvedType: 'micro' };
}

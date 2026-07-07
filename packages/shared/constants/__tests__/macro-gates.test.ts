import { describe, it, expect } from '@jest/globals';
import {
  classifyEvent,
  matchGateFromText,
  MACRO_GATES,
  MACRO_GATE_ALIASES,
} from '../macro-gates';

describe('matchGateFromText', () => {
  it('matches a canonical gate name (case-insensitive substring)', () => {
    expect(matchGateFromText('SRS approved')).toBe('SRS approved');
    expect(matchGateFromText('the srs approved today')).toBe('SRS approved');
    expect(matchGateFromText('- [x] 1.4 SRS APPROVED — 2026-07-03')).toBe('SRS approved');
  });

  it('resolves an alias to its canonical gate', () => {
    expect(matchGateFromText('solution architecture approved')).toBe('Design docs approved');
    expect(matchGateFromText('sprint plan approved')).toBe('Implementation plan approved');
    expect(matchGateFromText('spec file approved')).toBe('Spec strategy approved');
  });

  it('returns undefined when no gate is present', () => {
    expect(matchGateFromText('just a routine progress note')).toBeUndefined();
    expect(matchGateFromText('')).toBeUndefined();
  });
});

describe('classifyEvent — PLAN-H1: explicit type is authoritative', () => {
  it('does NOT upgrade an explicit type:"micro" to macro even when text matches a gate', () => {
    const result = classifyEvent({ update_text: 'SRS approved', type: 'micro' });
    expect(result.resolvedType).toBe('micro');
    expect(result.matchedGate).toBeUndefined();
  });

  it('keeps explicit micro even when text matches an alias', () => {
    const result = classifyEvent({ update_text: 'solution architecture approved', type: 'micro' });
    expect(result.resolvedType).toBe('micro');
    expect(result.matchedGate).toBeUndefined();
  });

  it('keeps explicit micro without requiring flag_override', () => {
    // Regression guard: the old behavior only honored an explicit type when
    // flag_override was ALSO true. An explicit type must now win on its own.
    const result = classifyEvent({ update_text: 'Code approved', type: 'micro', flag_override: false });
    expect(result.resolvedType).toBe('micro');
    expect(result.matchedGate).toBeUndefined();
  });

  it('keeps explicit micro for the CI non-gate label + flag_override:true call shape', () => {
    const result = classifyEvent({
      update_text: 'Progress update: docs/project-progress.md changed',
      type: 'micro',
      flag_override: true,
    });
    expect(result.resolvedType).toBe('micro');
    expect(result.matchedGate).toBeUndefined();
  });

  it('respects an explicit type:"macro" and surfaces the matched gate label from the text', () => {
    const result = classifyEvent({ update_text: 'SRS approved', type: 'macro' });
    expect(result.resolvedType).toBe('macro');
    expect(result.matchedGate).toBe('SRS approved');
  });

  it('respects an explicit type:"macro" even when the text carries no gate (matchedGate undefined)', () => {
    const result = classifyEvent({ update_text: 'display-only milestone', type: 'macro' });
    expect(result.resolvedType).toBe('macro');
    expect(result.matchedGate).toBeUndefined();
  });

  it('resolves the matched gate via alias for an explicit macro', () => {
    const result = classifyEvent({ update_text: 'sprint plan approved', type: 'macro' });
    expect(result.resolvedType).toBe('macro');
    expect(result.matchedGate).toBe('Implementation plan approved');
  });
});

describe('classifyEvent — absent type: auto-classification', () => {
  it('auto-classifies to macro when the text matches a canonical gate', () => {
    const result = classifyEvent({ update_text: 'Code approved by reviewer' });
    expect(result.resolvedType).toBe('macro');
    expect(result.matchedGate).toBe('Code approved');
  });

  it('auto-classifies to macro via alias when no type is given', () => {
    const result = classifyEvent({ update_text: 'documentation approved' });
    expect(result.resolvedType).toBe('macro');
    expect(result.matchedGate).toBe('Runbooks approved');
  });

  it('auto-classifies to micro when no gate is present and no type is given', () => {
    const result = classifyEvent({ update_text: 'Domain decomposition done' });
    expect(result.resolvedType).toBe('micro');
    expect(result.matchedGate).toBeUndefined();
  });

  it('every canonical gate auto-classifies to macro and resolves to ITSELF', () => {
    // matchGateFromText now checks canonical names before aliases, so a gate whose
    // text contains an alias substring (e.g. "Project documentation approved"
    // contains the "documentation approved" alias) resolves to the canonical gate
    // itself — NOT the alias target. This locks in the CR-16 alias-bleed fix.
    for (const gate of MACRO_GATES) {
      const result = classifyEvent({ update_text: gate });
      expect(result.resolvedType).toBe('macro');
      expect(result.matchedGate).toBe(gate);
    }
  });

  it('does NOT bleed "Project documentation approved" to "Runbooks approved"', () => {
    // Regression guard for the alias-ordering bleed: the alias `documentation approved`
    // (→ Runbooks approved) is a substring of the canonical `Project documentation approved`.
    expect(matchGateFromText('Project documentation approved')).toBe('Project documentation approved');
    expect(classifyEvent({ update_text: 'Project documentation approved' }).matchedGate).toBe(
      'Project documentation approved',
    );
    // The bare alias still resolves to its canonical target.
    expect(matchGateFromText('documentation approved')).toBe('Runbooks approved');
  });

  it('every alias auto-classifies to its canonical macro gate when type is absent', () => {
    for (const [alias, canonical] of Object.entries(MACRO_GATE_ALIASES)) {
      const result = classifyEvent({ update_text: alias });
      expect(result.resolvedType).toBe('macro');
      expect(result.matchedGate).toBe(canonical);
    }
  });
});

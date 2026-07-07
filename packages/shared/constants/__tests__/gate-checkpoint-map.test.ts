import { describe, it, expect } from '@jest/globals';
import { GATE_TO_CHECKPOINT, resolveCheckpointForGate } from '../gate-checkpoint-map';
import { MACRO_GATES, MacroGate } from '../macro-gates';

/**
 * The real CASDM macro_checkpoint names seeded by migrations/V003__phase2_additions.sql.
 * Every mapped value MUST be one of these (asserted below) so the map can never drift to a
 * checkpoint_name that no project row will ever have.
 */
const CASDM_CHECKPOINT_NAMES = new Set<string>([
  '5 outputs reviewed by SA',
  'Transcript Analysis (Sales to Delivery Handoff)',
  'Working SRS reviewed by SA',
  'Kickoff Call',
  'Review SRS with internal team (Internal Meeting)',
  'Discovery Readout/SRS Session (Client)',
  'Technically validate 6 design docs with spec strategy by SA',
  'Implementation Plan Review (Transcript Analysis)',
  'Review 3 generated outputs by Tech Lead',
  'Validate performance, security, compliance by Tech Lead',
  'Validate customer documentation by Tech Lead',
  'UAT Review with Client (SA Support)',
  'Share Signoff Document with Customer',
  'Project Retrospective (Transcript Analysis)',
  'Executive Check-in Call 2',
  'Conduct KT Sessions with customer',
]);

const UNMAPPED_GATES: MacroGate[] = [
  'Preliminary SRS validated',
  'Spec strategy approved',
  'Project documentation approved',
];

describe('GATE_TO_CHECKPOINT', () => {
  it('maps every value to a REAL CASDM checkpoint name', () => {
    for (const value of Object.values(GATE_TO_CHECKPOINT)) {
      expect(typeof value).toBe('string');
      expect(CASDM_CHECKPOINT_NAMES.has(value as string)).toBe(true);
    }
  });

  it('only keys the map with canonical MacroGates', () => {
    for (const key of Object.keys(GATE_TO_CHECKPOINT)) {
      expect(MACRO_GATES).toContain(key);
    }
  });

  it('is stable for the seven confidently-mapped gates', () => {
    expect(GATE_TO_CHECKPOINT['SRS approved']).toBe('Working SRS reviewed by SA');
    expect(GATE_TO_CHECKPOINT['Design docs approved']).toBe(
      'Technically validate 6 design docs with spec strategy by SA',
    );
    expect(GATE_TO_CHECKPOINT['Code approved']).toBe('Review 3 generated outputs by Tech Lead');
    expect(Object.keys(GATE_TO_CHECKPOINT)).toHaveLength(7);
  });

  it('has no duplicate checkpoint targets (each gate → a distinct checkpoint)', () => {
    const values = Object.values(GATE_TO_CHECKPOINT);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('resolveCheckpointForGate', () => {
  it('returns the checkpoint for a mapped gate', () => {
    expect(resolveCheckpointForGate('SRS approved')).toBe('Working SRS reviewed by SA');
  });

  it('returns undefined for an intentionally-unmapped gate', () => {
    for (const gate of UNMAPPED_GATES) {
      expect(resolveCheckpointForGate(gate)).toBeUndefined();
    }
  });
});

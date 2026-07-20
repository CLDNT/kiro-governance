import { describe, it, expect } from '@jest/globals';
import { GATE_TO_CHECKPOINT, resolveCheckpointForGate } from '../gate-checkpoint-map';
import { MACRO_GATES } from '../macro-gates';

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

/**
 * Deliberate 2-gates → 1-checkpoint collapses (CASDM's 16 checkpoints are coarser than the
 * 10 canonical gates). These siblings share a single checkpoint by design — NOT name-drift.
 */
const SHARED_CHECKPOINT_SIBLINGS: Array<[string, string, string]> = [
  ['Discovery outputs validated', 'Preliminary SRS validated', '5 outputs reviewed by SA'],
  [
    'Design docs approved',
    'Spec strategy approved',
    'Technically validate 6 design docs with spec strategy by SA',
  ],
  [
    'Runbooks approved',
    'Project documentation approved',
    'Validate customer documentation by Tech Lead',
  ],
];

describe('GATE_TO_CHECKPOINT', () => {
  it('maps every value to a REAL CASDM checkpoint name', () => {
    for (const value of Object.values(GATE_TO_CHECKPOINT)) {
      expect(typeof value).toBe('string');
      expect(CASDM_CHECKPOINT_NAMES.has(value)).toBe(true);
    }
  });

  it('only keys the map with canonical MacroGates', () => {
    for (const key of Object.keys(GATE_TO_CHECKPOINT)) {
      expect(MACRO_GATES).toContain(key);
    }
  });

  it('maps ALL 10 canonical macro gates (no gate left unmapped)', () => {
    for (const gate of MACRO_GATES) {
      expect(GATE_TO_CHECKPOINT[gate]).toBeDefined();
      expect(typeof GATE_TO_CHECKPOINT[gate]).toBe('string');
    }
    expect(Object.keys(GATE_TO_CHECKPOINT)).toHaveLength(MACRO_GATES.length);
    expect(Object.keys(GATE_TO_CHECKPOINT)).toHaveLength(10);
  });

  it('pins the exact checkpoint for each canonical gate', () => {
    expect(GATE_TO_CHECKPOINT['Discovery outputs validated']).toBe('5 outputs reviewed by SA');
    expect(GATE_TO_CHECKPOINT['Preliminary SRS validated']).toBe('5 outputs reviewed by SA');
    expect(GATE_TO_CHECKPOINT['SRS approved']).toBe('Working SRS reviewed by SA');
    expect(GATE_TO_CHECKPOINT['Design docs approved']).toBe(
      'Technically validate 6 design docs with spec strategy by SA',
    );
    expect(GATE_TO_CHECKPOINT['Implementation plan approved']).toBe(
      'Implementation Plan Review (Transcript Analysis)',
    );
    expect(GATE_TO_CHECKPOINT['Spec strategy approved']).toBe(
      'Technically validate 6 design docs with spec strategy by SA',
    );
    expect(GATE_TO_CHECKPOINT['Code approved']).toBe('Review 3 generated outputs by Tech Lead');
    expect(GATE_TO_CHECKPOINT['UAT report approved']).toBe(
      'Validate performance, security, compliance by Tech Lead',
    );
    expect(GATE_TO_CHECKPOINT['Runbooks approved']).toBe(
      'Validate customer documentation by Tech Lead',
    );
    expect(GATE_TO_CHECKPOINT['Project documentation approved']).toBe(
      'Validate customer documentation by Tech Lead',
    );
  });

  it('collapses sibling gates onto their shared checkpoint by design', () => {
    for (const [gateA, gateB, checkpoint] of SHARED_CHECKPOINT_SIBLINGS) {
      expect(GATE_TO_CHECKPOINT[gateA as (typeof MACRO_GATES)[number]]).toBe(checkpoint);
      expect(GATE_TO_CHECKPOINT[gateB as (typeof MACRO_GATES)[number]]).toBe(checkpoint);
    }
  });
});

describe('resolveCheckpointForGate', () => {
  it('returns the checkpoint for a mapped gate', () => {
    expect(resolveCheckpointForGate('SRS approved')).toBe('Working SRS reviewed by SA');
  });

  it('resolves a real checkpoint for EVERY canonical macro gate', () => {
    for (const gate of MACRO_GATES) {
      const checkpoint = resolveCheckpointForGate(gate);
      expect(checkpoint).toBeDefined();
      expect(CASDM_CHECKPOINT_NAMES.has(checkpoint as string)).toBe(true);
    }
  });
});

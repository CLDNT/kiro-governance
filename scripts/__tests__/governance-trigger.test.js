/**
 * Unit tests for scripts/governance-trigger.js — CR-10 event-source split.
 *
 * Focus: the CLI display-only MACRO backward-compat path (§0.3 / D-v3-10) emits a governance
 * event that is DISPLAY-ONLY — it must NOT carry any field that sets macro_checkpoints.reached_at
 * (macro completion stays app-owned, gates §5.3). Also asserts the MICRO default path (PLAN-H1)
 * uses type:'micro' + flag_override:true + a NON-gate update_text.
 *
 * Requires the script module (guarded main() means no side effects on require). See
 * docs/phase1/github-trigger-architecture.md §0; jira-backlog CR-10.
 */

'use strict';

const { buildRecordArgs } = require('../governance-trigger');

describe('governance-trigger buildRecordArgs — CLI event-source split', () => {
  const common = {
    projectId: 'kiro-governance',
    line: '- [x] 1.4 SRS approved',
    gate: 'SRS approved',
    sourceRef: 'abc123def456',
    actor: 'octocat',
  };

  describe('MACRO mode — CLI display-only backward-compat path', () => {
    const args = buildRecordArgs({ mode: 'macro', ...common });

    it('emits a macro governance event (type:macro + flag_override:true)', () => {
      expect(args.type).toBe('macro');
      expect(args.flag_override).toBe(true);
      expect(args.gate).toBe('SRS approved');
      expect(args.project_id).toBe('kiro-governance');
    });

    it('is DISPLAY-ONLY — carries NO field that sets macro_checkpoints.reached_at', () => {
      // A record_progress governance event only. There is deliberately no reached_at,
      // occurred, reviewed_by, or completed_* — completion stays app-owned.
      expect(args).not.toHaveProperty('reached_at');
      expect(args).not.toHaveProperty('occurred');
      expect(args).not.toHaveProperty('reviewed_by');
      expect(args).not.toHaveProperty('completed_at');
      expect(args).not.toHaveProperty('completed_by');
      // Args are exactly the plain governance-event shape.
      expect(Object.keys(args).sort()).toEqual(
        ['actor', 'flag_override', 'gate', 'project_id', 'source_ref', 'type', 'update_text'].sort(),
      );
    });
  });

  describe('MICRO mode — default CI path (PLAN-H1)', () => {
    const args = buildRecordArgs({ mode: 'micro', ...common });

    it('persists as type:micro with flag_override and a NON-gate update_text', () => {
      expect(args.type).toBe('micro');
      expect(args.flag_override).toBe(true);
      // update_text must NOT lead with a canonical gate name (prevents substring re-classification).
      expect(args.update_text).toBe('Progress update: docs/project-progress.md changed');
      expect(args.update_text).not.toContain('SRS approved');
    });

    it('is also a plain governance event with no reached_at-setting field', () => {
      expect(args).not.toHaveProperty('reached_at');
      expect(args).not.toHaveProperty('occurred');
      expect(args).not.toHaveProperty('reviewed_by');
    });
  });
});

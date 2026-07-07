import { describe, it, expect } from 'vitest';

import {
  isKiroCompleted,
  kiroActor,
  completionSource,
  completedByLabel,
  canEditArtifact,
  canManageArtifactAuto,
  KIRO_COMPLETED_BY_PREFIX,
} from './artifacts';

describe('artifacts — Level-2 provenance helpers', () => {
  describe('isKiroCompleted', () => {
    it('is true only for kiro:-prefixed values', () => {
      expect(isKiroCompleted('kiro:aws-architect')).toBe(true);
      expect(isKiroCompleted(`${KIRO_COMPLETED_BY_PREFIX}orchestrator`)).toBe(true);
    });

    it('is false for human emails, null, undefined, and empty', () => {
      expect(isKiroCompleted('jane@example.com')).toBe(false);
      expect(isKiroCompleted(null)).toBe(false);
      expect(isKiroCompleted(undefined)).toBe(false);
      expect(isKiroCompleted('')).toBe(false);
    });
  });

  describe('kiroActor', () => {
    it('extracts the actor after the prefix', () => {
      expect(kiroActor('kiro:aws-architect')).toBe('aws-architect');
      expect(kiroActor('kiro:  product-analyst  ')).toBe('product-analyst');
    });

    it('returns null for non-kiro values or a bare prefix', () => {
      expect(kiroActor('jane@example.com')).toBeNull();
      expect(kiroActor('kiro:')).toBeNull();
      expect(kiroActor(null)).toBeNull();
    });
  });

  describe('completionSource', () => {
    it('returns none when not complete regardless of completed_by', () => {
      expect(completionSource({ status: 'pending', completed_by: 'kiro:x' })).toBe('none');
      expect(completionSource({ status: 'in_progress', completed_by: null })).toBe('none');
    });

    it('returns kiro when complete and auto-completed', () => {
      expect(completionSource({ status: 'complete', completed_by: 'kiro:orchestrator' })).toBe(
        'kiro'
      );
    });

    it('returns manual when complete and human-completed', () => {
      expect(completionSource({ status: 'complete', completed_by: 'jane@example.com' })).toBe(
        'manual'
      );
      expect(completionSource({ status: 'complete', completed_by: null })).toBe('manual');
    });
  });

  describe('completedByLabel', () => {
    it('formats a kiro actor as "Kiro (<actor>)"', () => {
      expect(completedByLabel('kiro:aws-architect')).toBe('Kiro (aws-architect)');
    });

    it('shows plain Kiro when there is no actor', () => {
      expect(completedByLabel('kiro:')).toBe('Kiro');
    });

    it('passes through a human email and handles null', () => {
      expect(completedByLabel('jane@example.com')).toBe('jane@example.com');
      expect(completedByLabel(null)).toBeNull();
    });
  });

  describe('role gates', () => {
    it('canEditArtifact allows pm/sa/leadership/admin but not engineer', () => {
      expect(canEditArtifact('pm')).toBe(true);
      expect(canEditArtifact('sa')).toBe(true);
      expect(canEditArtifact('leadership')).toBe(true);
      expect(canEditArtifact('admin')).toBe(true);
      expect(canEditArtifact('engineer')).toBe(false);
      expect(canEditArtifact(null)).toBe(false);
      expect(canEditArtifact(undefined)).toBe(false);
    });

    it('canManageArtifactAuto allows only admin/leadership', () => {
      expect(canManageArtifactAuto('admin')).toBe(true);
      expect(canManageArtifactAuto('leadership')).toBe(true);
      expect(canManageArtifactAuto('pm')).toBe(false);
      expect(canManageArtifactAuto('sa')).toBe(false);
      expect(canManageArtifactAuto('engineer')).toBe(false);
      expect(canManageArtifactAuto(null)).toBe(false);
    });
  });
});

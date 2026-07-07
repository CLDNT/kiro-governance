import { describe, it, expect } from '@jest/globals';
import {
  MICRO_ARTIFACT_EVENT_CODES,
  EVENT_CODE_PATTERN,
  isKnownEventCode,
} from '../micro-artifact-events';

/**
 * The 16 CASDM micro artifacts seeded by migrations/V002__projects_and_casdm_tracking.sql
 * (__template__ micro_artifacts). Every mapped event_code MUST resolve to one of these
 * (phase, artifact_name) pairs so the reconcile join matches per project.
 */
const V002_TEMPLATE_ARTIFACTS = new Set<string>([
  'Phase 0|Preliminary SRS',
  'Phase 0|Discovery Meeting(s) Agenda + Questions',
  'Phase 0|High-level Project Plan + Gantt Chart + RACI',
  'Phase 0|Baseline Jira Backlog',
  'Phase 0|Kickoff Deck Content/Slides',
  'Phase 1|Working SRS',
  'Phase 2|Workstream Decomposition',
  'Phase 2|Spec Strategy per Workstream',
  'Phase 2|Data Readiness',
  'Phase 2|Solution Architecture Design',
  'Phase 2|TCO',
  'Phase 2|Jira stories/sprint plan using validated SRS/design docs',
  'Phase 3|Specs per story-id',
  'Phase 3|Code',
  'Phase 3|UAT report',
  'Phase 4|Runbooks / Documentation',
]);

describe('MICRO_ARTIFACT_EVENT_CODES', () => {
  it('defines exactly the 16 CASDM micro-artifact codes', () => {
    expect(Object.keys(MICRO_ARTIFACT_EVENT_CODES)).toHaveLength(16);
  });

  it('maps every code to a real V002 __template__ (phase, artifact_name)', () => {
    for (const [, { phase, artifact_name }] of Object.entries(MICRO_ARTIFACT_EVENT_CODES)) {
      expect(V002_TEMPLATE_ARTIFACTS.has(`${phase}|${artifact_name}`)).toBe(true);
    }
  });

  it('covers every V002 template artifact exactly once (bijection)', () => {
    const mapped = Object.values(MICRO_ARTIFACT_EVENT_CODES).map((v) => `${v.phase}|${v.artifact_name}`);
    expect(new Set(mapped).size).toBe(16);
    for (const target of V002_TEMPLATE_ARTIFACTS) {
      expect(mapped).toContain(target);
    }
  });

  it('every code obeys the casdm.<phase>.<artifact> charset/length contract', () => {
    for (const code of Object.keys(MICRO_ARTIFACT_EVENT_CODES)) {
      expect(code).toMatch(/^casdm\.p[0-4]\.[a-z0-9_]+$/);
      expect(code).toMatch(EVENT_CODE_PATTERN);
      expect(code.length).toBeLessThanOrEqual(64);
    }
  });
});

describe('isKnownEventCode', () => {
  it('returns true for a seeded code', () => {
    expect(isKnownEventCode('casdm.p1.working_srs')).toBe(true);
    expect(isKnownEventCode('casdm.p3.code')).toBe(true);
  });

  it('returns false for an unknown / unmapped code', () => {
    expect(isKnownEventCode('casdm.p9.nonexistent')).toBe(false);
    expect(isKnownEventCode('random')).toBe(false);
    expect(isKnownEventCode('')).toBe(false);
  });
});

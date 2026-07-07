import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  RecordProgressInputSchema,
  buildIdempotencyKey,
  handleRecordProgress,
} from '../record-progress';
import { classifyEvent } from '@kiro-governance/shared/constants/macro-gates';
import { resolveProject, writeGovernanceEvent } from '../../services/postgres.service';

// Mock classifyEvent from shared
jest.mock('@kiro-governance/shared/constants/macro-gates', () => ({
  classifyEvent: jest.fn(),
}));

// Mock the PostgreSQL service — the DB layer (pg) is never touched in these tests.
jest.mock('../../services/postgres.service', () => ({
  resolveProject: jest.fn(),
  writeGovernanceEvent: jest.fn(),
}));

const mockClassifyEvent = classifyEvent as jest.MockedFunction<typeof classifyEvent>;
const mockResolveProject = resolveProject as jest.MockedFunction<typeof resolveProject>;
const mockWriteGovernanceEvent = writeGovernanceEvent as jest.MockedFunction<typeof writeGovernanceEvent>;

describe('record_progress tool', () => {
  describe('Input validation', () => {
    it('should accept valid macro event input', () => {
      const input = {
        project_id: 'rainn',
        update_text: 'SRS approved',
        gate: 'SRS approved',
        source_ref: 'abc123',
        actor: 'human',
      };
      expect(() => RecordProgressInputSchema.parse(input)).not.toThrow();
    });

    it('should reject missing project_id', () => {
      const input = { update_text: 'test', source_ref: 'abc', actor: 'human' };
      expect(() => RecordProgressInputSchema.parse(input)).toThrow();
    });

    it('should reject update_text > 4096 chars', () => {
      const input = {
        project_id: 'rainn',
        update_text: 'a'.repeat(4097),
        source_ref: 'abc',
        actor: 'human',
      };
      expect(() => RecordProgressInputSchema.parse(input)).toThrow();
    });
  });

  describe('Idempotency key building', () => {
    it('should build macro key with date component', () => {
      const key = buildIdempotencyKey('rainn', 'macro', 'SRS approved', '01J5K3M2N4P5Q6R7S8T9');
      expect(key).toMatch(/^rainn#srs approved#\d{4}-\d{2}-\d{2}$/);
    });

    it('should normalize gate to lowercase', () => {
      const key = buildIdempotencyKey('rainn', 'macro', 'SRS APPROVED', '01J5K3M2N4P5Q6R7S8T9');
      expect(key).toMatch(/^rainn#srs approved#/);
    });

    it('should trim whitespace from gate', () => {
      const key = buildIdempotencyKey('rainn', 'macro', '  SRS approved  ', '01J5K3M2N4P5Q6R7S8T9');
      expect(key).toMatch(/^rainn#srs approved#/);
    });

    it('should build micro key with ULID', () => {
      const ulid = '01J5K3M2N4P5Q6R7S8T9';
      const key = buildIdempotencyKey('rainn', 'micro', undefined, ulid);
      expect(key).toBe(`rainn#micro#${ulid}`);
    });

    it('should not include gate in micro key', () => {
      const key = buildIdempotencyKey('rainn', 'micro', 'ignored', 'ulid123');
      expect(key).toMatch(/^rainn#micro#/);
    });
  });

  describe('No-orphan resolve-or-reject (CR-08 / FR-P2-038)', () => {
    let logSpy: jest.SpiedFunction<typeof console.log>;
    let warnSpy: jest.SpiedFunction<typeof console.warn>;
    let infoSpy: jest.SpiedFunction<typeof console.info>;

    beforeEach(() => {
      jest.clearAllMocks();
      logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
      warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      infoSpy = jest.spyOn(console, 'info').mockImplementation(() => undefined);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    const macroInput = {
      project_id: 'deliverpro',
      update_text: 'SRS approved',
      gate: 'SRS approved',
      source_ref: 'abc123',
      actor: 'human',
    };

    it('writes the event when the repo resolves to a project', async () => {
      mockClassifyEvent.mockReturnValue({ resolvedType: 'macro', matchedGate: 'SRS approved' });
      mockResolveProject.mockResolvedValue({ jira_key: 'DP-001', slack_micro_channel_id: null, slack_macro_channel_id: null });
      mockWriteGovernanceEvent.mockResolvedValue({ written: true });

      const result = await handleRecordProgress(macroInput);

      expect(result).toEqual({ written: true });
      expect(mockResolveProject).toHaveBeenCalledWith('deliverpro');
      expect(mockWriteGovernanceEvent).toHaveBeenCalledTimes(1);
      // The stored record still keys project_id by the repo name (unchanged).
      const [record] = mockWriteGovernanceEvent.mock.calls[0];
      expect(record.project_id).toBe('deliverpro');
    });

    it('HARD REJECTS and does NOT write when no project matches', async () => {
      mockClassifyEvent.mockReturnValue({ resolvedType: 'macro', matchedGate: 'SRS approved' });
      mockResolveProject.mockResolvedValue(null);

      const result = await handleRecordProgress({ ...macroInput, project_id: 'unknown-repo' });

      expect(result).toEqual({ written: false, reason: 'no_matching_project' });
      expect(mockResolveProject).toHaveBeenCalledWith('unknown-repo');
      // Critical: the write path is never reached.
      expect(mockWriteGovernanceEvent).not.toHaveBeenCalled();
    });

    it('emits a dimensionless GovernanceEventRejected metric on rejection (repo not a dimension)', async () => {
      mockClassifyEvent.mockReturnValue({ resolvedType: 'micro', matchedGate: undefined });
      mockResolveProject.mockResolvedValue(null);

      await handleRecordProgress({ ...macroInput, project_id: 'unknown-repo' });

      // The EMF metric line is the only console.log emitted on the reject path.
      const emfLine = logSpy.mock.calls
        .map((c) => String(c[0]))
        .find((line) => line.includes('GovernanceEventRejected'));
      expect(emfLine).toBeDefined();

      const emf = JSON.parse(emfLine as string);
      const metricDef = emf._aws.CloudWatchMetrics[0];
      expect(metricDef.Metrics[0].Name).toBe('GovernanceEventRejected');
      expect(emf.GovernanceEventRejected).toBe(1);
      // Dimensionless — no repo/caller dimension (SEC-H2).
      expect(metricDef.Dimensions).toEqual([[]]);
      // Repo name must NOT appear in the metric payload.
      expect(emfLine).not.toContain('unknown-repo');

      // Repo name is present only in the structured warn log line.
      const warnedRepo = warnSpy.mock.calls.some((c) =>
        JSON.stringify(c).includes('unknown-repo'),
      );
      expect(warnedRepo).toBe(true);
    });

    it('preserves the dedup path — matching project + duplicate returns { written:false, reason:"duplicate" }', async () => {
      mockClassifyEvent.mockReturnValue({ resolvedType: 'macro', matchedGate: 'SRS approved' });
      mockResolveProject.mockResolvedValue({ jira_key: 'DP-001', slack_micro_channel_id: null, slack_macro_channel_id: null });
      mockWriteGovernanceEvent.mockResolvedValue({ written: false, reason: 'duplicate' });

      const result = await handleRecordProgress(macroInput);

      expect(result).toEqual({ written: false, reason: 'duplicate' });
      // Resolve happened first, then the write attempt (dedup handled in the DB layer).
      expect(mockResolveProject).toHaveBeenCalledWith('deliverpro');
      expect(mockWriteGovernanceEvent).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalled();
    });

    it('resolve-or-reject applies to micro events too', async () => {
      mockClassifyEvent.mockReturnValue({ resolvedType: 'micro', matchedGate: undefined });
      mockResolveProject.mockResolvedValue({ jira_key: 'DP-002', slack_micro_channel_id: null, slack_macro_channel_id: null });
      mockWriteGovernanceEvent.mockResolvedValue({ written: true });

      const result = await handleRecordProgress({
        project_id: 'deliverpro',
        update_text: 'Domain decomposition done',
        type: 'micro',
        source_ref: 'docs/domain-decomposition.md',
        actor: 'aws-architect',
      });

      expect(result).toEqual({ written: true });
      expect(mockResolveProject).toHaveBeenCalledWith('deliverpro');
      const [record] = mockWriteGovernanceEvent.mock.calls[0];
      expect(record.type).toBe('micro');
    });
  });

  describe('event_code passthrough (CR-14)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
      jest.spyOn(console, 'log').mockImplementation(() => undefined);
      jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      jest.spyOn(console, 'info').mockImplementation(() => undefined);
      mockClassifyEvent.mockReturnValue({ resolvedType: 'micro', matchedGate: undefined });
      mockResolveProject.mockResolvedValue({ jira_key: 'DP-001', slack_micro_channel_id: null, slack_macro_channel_id: null });
      mockWriteGovernanceEvent.mockResolvedValue({ written: true });
    });

    afterEach(() => jest.restoreAllMocks());

    const microInput = {
      project_id: 'deliverpro',
      update_text: 'Domain decomposition done',
      type: 'micro' as const,
      source_ref: 'docs/domain-decomposition.md',
      actor: 'aws-architect',
    };

    it('accepts a valid event_code in the schema', () => {
      expect(() =>
        RecordProgressInputSchema.parse({ ...microInput, event_code: 'casdm.p2.workstream_decomposition' }),
      ).not.toThrow();
    });

    it('rejects an event_code with a disallowed charset (uppercase / dash)', () => {
      expect(() => RecordProgressInputSchema.parse({ ...microInput, event_code: 'CASDM.P2.x' })).toThrow();
      expect(() => RecordProgressInputSchema.parse({ ...microInput, event_code: 'casdm-p2-x' })).toThrow(); // '-' not in [a-z0-9._]
    });

    it('rejects an event_code over 64 chars', () => {
      expect(() =>
        RecordProgressInputSchema.parse({ ...microInput, event_code: 'a'.repeat(65) }),
      ).toThrow();
    });

    it('persists event_code on the governance record when present', async () => {
      await handleRecordProgress({ ...microInput, event_code: 'casdm.p2.workstream_decomposition' });
      const [record] = mockWriteGovernanceEvent.mock.calls[0];
      expect(record.event_code).toBe('casdm.p2.workstream_decomposition');
    });

    it('omits event_code (undefined) when absent — column persists as NULL downstream', async () => {
      await handleRecordProgress(microInput);
      const [record] = mockWriteGovernanceEvent.mock.calls[0];
      expect(record.event_code).toBeUndefined();
    });

    it('persists an UNKNOWN (unmapped) event_code — not rejected at write time (allow-list is at reconcile)', async () => {
      await handleRecordProgress({ ...microInput, event_code: 'casdm.p9.not_in_mapping' });
      const [record] = mockWriteGovernanceEvent.mock.calls[0];
      expect(record.event_code).toBe('casdm.p9.not_in_mapping');
      expect(mockWriteGovernanceEvent).toHaveBeenCalledTimes(1);
    });

    it('event_code does not participate in the idempotency key', () => {
      const withoutCode = buildIdempotencyKey('deliverpro', 'micro', undefined, 'ULID123');
      // event_code is never an argument to buildIdempotencyKey — the micro key is repo#micro#ulid.
      expect(withoutCode).toBe('deliverpro#micro#ULID123');
    });
  });
});

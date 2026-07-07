import { describe, it, expect, beforeEach, jest } from '@jest/globals';

// --- Mock the DB + IAM auth layer (pg, RDS signer, fs CA bundle) ---
// Names are prefixed with `mock` so the hoisted jest.mock factories may reference them.
const mockQuery = jest.fn();
const mockEnd = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn().mockImplementation(() => ({ query: mockQuery, end: mockEnd })),
}));

jest.mock('@aws-sdk/rds-signer', () => ({
  Signer: jest.fn().mockImplementation(() => ({
    getAuthToken: jest.fn(async () => 'iam-token'),
  })),
}));

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => 'ca-bundle-pem'),
}));

import { resolveProject, writeGovernanceEvent } from '../postgres.service';
import type { GovernanceEventRecord } from '@kiro-governance/shared/types/governance-event';

beforeEach(() => {
  jest.clearAllMocks();
  process.env.DB_ENDPOINT = 'db.example.internal';
  process.env.DB_PORT = '5432';
  process.env.DB_USER = 'kiro_mcp_app';
  process.env.DB_NAME = 'kiro_governance';
  process.env.AWS_REGION = 'us-east-1';
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('postgres.service — resolveProject (CR-08 / CR-09)', () => {
  it('returns the project row (jira_key + dual Slack channels) when the repo is linked', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ jira_key: 'DP-001', slack_micro_channel_id: 'C_MICRO01', slack_macro_channel_id: 'C_MACRO01' }],
      rowCount: 1,
    } as never);

    const project = await resolveProject('deliverpro');

    expect(project).toEqual({
      jira_key: 'DP-001',
      slack_micro_channel_id: 'C_MICRO01',
      slack_macro_channel_id: 'C_MACRO01',
    });
  });

  it('issues a parameterized, grant-scoped SELECT on projects.github_repo', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    await resolveProject('deliverpro');

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // Only CR-01A grant-covered columns are selected (no id / title).
    expect(sql).toMatch(
      /SELECT jira_key, slack_micro_channel_id, slack_macro_channel_id\s+FROM projects\s+WHERE github_repo = \$1/,
    );
    expect(sql).not.toMatch(/\bid\b/);
    expect(sql).not.toMatch(/\btitle\b/);
    expect(params).toEqual(['deliverpro']);
  });

  it('returns null when no project is linked to the repo', async () => {
    mockQuery.mockResolvedValue({ rows: [], rowCount: 0 } as never);

    const project = await resolveProject('unknown-repo');

    expect(project).toBeNull();
  });

  it('propagates unexpected DB errors', async () => {
    mockQuery.mockRejectedValue(new Error('connection reset') as never);

    await expect(resolveProject('deliverpro')).rejects.toThrow('connection reset');
  });
});

describe('postgres.service — writeGovernanceEvent dedup path (unchanged)', () => {
  const record: GovernanceEventRecord = {
    project_id: 'deliverpro',
    update_text: 'SRS approved',
    type: 'macro',
    source_ref: 'abc123',
    actor: 'human',
    created_at: new Date().toISOString(),
    idempotency_key: 'deliverpro#srs approved#2026-07-03',
  };

  it('returns { written: true } when a new row is inserted', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 } as never);

    const result = await writeGovernanceEvent(record, record.idempotency_key);

    expect(result).toEqual({ written: true });
  });

  it('returns { written: false, reason: "duplicate" } when ON CONFLICT skips the insert', async () => {
    mockQuery.mockResolvedValue({ rowCount: 0 } as never);

    const result = await writeGovernanceEvent(record, record.idempotency_key);

    expect(result).toEqual({ written: false, reason: 'duplicate' });
  });

  it('persists event_code in the INSERT column list + params (CR-14)', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 } as never);

    await writeGovernanceEvent(
      { ...record, type: 'micro', event_code: 'casdm.p2.workstream_decomposition' },
      record.idempotency_key,
    );

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toMatch(/event_code/);
    expect(params).toContain('casdm.p2.workstream_decomposition');
  });

  it('sends NULL for event_code when absent (append-only column stays nullable)', async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 } as never);

    await writeGovernanceEvent(record, record.idempotency_key);

    const [, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    // 8th positional param is event_code (after project_id, update_text, type, flag_override, gate, phase, phase_name).
    expect(params[7]).toBeNull();
  });
});

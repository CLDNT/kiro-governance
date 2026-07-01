/**
 * e2e.test.ts
 * End-to-end integration tests for DeliverPro API
 * Runs against deployed API Gateway endpoint (API_BASE_URL env var)
 * Source: analysis-architecture.md §DP-40
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';

// Test tokens (in real E2E, these are obtained from Cognito)
const LEADERSHIP_TOKEN = process.env.LEADERSHIP_TOKEN || 'test-leadership-token';
const PM_TOKEN = process.env.PM_TOKEN || 'test-pm-token';
const SA_TOKEN = process.env.SA_TOKEN || 'test-sa-token';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'test-admin-token';

interface ProjectResponse {
  project_id: string;
  project_name: string;
  created_at: string;
}

interface GateResponse {
  project_id: string;
  phases: Array<{
    phase: string;
    phase_name: string;
    micro_artifacts: Array<{ id: number; artifact_name: string }>;
    macro_checkpoints: Array<{ id: number; checkpoint_name: string; checkpoint_type: string }>;
  }>;
}

interface EvidenceResponse {
  id: number;
  project_id: string;
  evidence_type: string;
  link_metadata?: Record<string, unknown>;
}

interface PresignedUrlResponse {
  presigned_url: string;
  s3_key: string;
}

interface StatusLogResponse {
  id: number;
  checkpoint_name: string;
  status_type: string;
  message: string;
}

interface EscalationResponse {
  id: number;
  checkpoint_name: string;
  status: 'open' | 'resolved';
}

interface ReportingResponse {
  project_id: string;
  total_phases: number;
  phases_complete: number;
  macro_checkpoints_passed: number;
  completion_percentage: number;
}

describe('DeliverPro E2E Integration Tests', () => {
  let testProjectId: string;
  let testCheckpointId: number;

  beforeAll(async () => {
    console.log(`Testing against API_BASE_URL: ${API_BASE_URL}`);
  });

  afterAll(() => {
    // Cleanup if needed
  });

  // Test 1: Create project and verify CASDM template seeded
  it('should create project and verify CASDM template is seeded', async () => {
    const response = await fetch(`${API_BASE_URL}/api/projects`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LEADERSHIP_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        project_name: 'E2E Test Project',
        casdm_type: 'agile',
      }),
    });

    expect(response.status).toBe(201);
    const data = (await response.json()) as ProjectResponse;
    testProjectId = data.project_id;

    // Verify CASDM template seeded by checking gates
    const gatesResponse = await fetch(`${API_BASE_URL}/api/projects/${testProjectId}/gates`, {
      headers: { 'Authorization': `Bearer ${LEADERSHIP_TOKEN}` },
    });

    expect(gatesResponse.status).toBe(200);
    const gates = (await gatesResponse.json()) as GateResponse;

    // Should have multiple phases with artifacts + checkpoints
    expect(gates.phases.length).toBeGreaterThan(0);

    let totalMicroArtifacts = 0;
    let totalMacroCheckpoints = 0;

    for (const phase of gates.phases) {
      totalMicroArtifacts += phase.micro_artifacts.length;
      totalMacroCheckpoints += phase.macro_checkpoints.length;
    }

    expect(totalMicroArtifacts).toBeGreaterThan(0);
    expect(totalMacroCheckpoints).toBeGreaterThan(0);
  });

  // Test 2: GET /gates returns all phases with correct structure
  it('should return all phases with correct structure', async () => {
    const response = await fetch(`${API_BASE_URL}/api/projects/${testProjectId}/gates`, {
      headers: { 'Authorization': `Bearer ${PM_TOKEN}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as GateResponse;

    expect(data.project_id).toBe(testProjectId);
    expect(Array.isArray(data.phases)).toBe(true);

    for (const phase of data.phases) {
      expect(phase.phase).toBeDefined();
      expect(phase.phase_name).toBeDefined();
      expect(Array.isArray(phase.micro_artifacts)).toBe(true);
      expect(Array.isArray(phase.macro_checkpoints)).toBe(true);

      // Store a checkpoint ID for later tests
      if (phase.macro_checkpoints.length > 0 && !testCheckpointId) {
        testCheckpointId = phase.macro_checkpoints[0].id;
      }
    }
  });

  // Test 3: Complete a meeting-type checkpoint, verify reached_at set
  it('should complete a meeting-type checkpoint and set reached_at', async () => {
    // Find a meeting-type checkpoint
    const gatesResponse = await fetch(`${API_BASE_URL}/api/projects/${testProjectId}/gates`, {
      headers: { 'Authorization': `Bearer ${PM_TOKEN}` },
    });

    const gates = (await gatesResponse.json()) as GateResponse;
    let meetingCheckpointId: number | null = null;

    for (const phase of gates.phases) {
      const checkpoint = phase.macro_checkpoints.find((c) => c.checkpoint_type === 'meeting');
      if (checkpoint) {
        meetingCheckpointId = checkpoint.id;
        break;
      }
    }

    if (!meetingCheckpointId) {
      console.log('No meeting-type checkpoint found, skipping test');
      return;
    }

    const response = await fetch(
      `${API_BASE_URL}/api/projects/${testProjectId}/checkpoints/${meetingCheckpointId}/complete`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${PM_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ occurred: true }),
      }
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as { reached_at: string | null };
    expect(data.reached_at).toBeTruthy();
  });

  // Test 4: Attach evidence (meeting_link), verify gate_evidence row created
  it('should attach evidence and create gate_evidence row', async () => {
    const response = await fetch(
      `${API_BASE_URL}/api/projects/${testProjectId}/checkpoints/${testCheckpointId}/evidence`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PM_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          evidence_type: 'meeting_link',
          label: 'Meeting Recording',
          value: 'https://app.avoma.com/meetings/test123456',
        }),
      }
    );

    expect(response.status).toBe(201);
    const evidence = (await response.json()) as EvidenceResponse;

    expect(evidence.id).toBeGreaterThan(0);
    expect(evidence.evidence_type).toBe('meeting_link');
    expect(evidence.project_id).toBe(testProjectId);
  });

  // Test 5: Upload presigned URL returned, S3 key format correct
  it('should return presigned URL for evidence upload with correct S3 key format', async () => {
    const response = await fetch(
      `${API_BASE_URL}/api/projects/${testProjectId}/checkpoints/${testCheckpointId}/upload-url`,
      {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${PM_TOKEN}` },
      }
    );

    expect(response.status).toBe(200);
    const data = (await response.json()) as PresignedUrlResponse;

    expect(data.presigned_url).toBeTruthy();
    expect(data.s3_key).toBeTruthy();

    // Verify S3 key format: evidence/{projectId}/{checkpointName}/{timestamp}
    expect(data.s3_key).toMatch(/^evidence\/[\w-]+\/[\w-]+\/\d+$/);
  });

  // Test 6: POST status log, verify retrieval
  it('should create and retrieve status logs', async () => {
    const response = await fetch(
      `${API_BASE_URL}/api/projects/${testProjectId}/checkpoints/${testCheckpointId}/status-log`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PM_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          status_type: 'in_progress',
          message: 'Started reviewing kickoff meeting',
        }),
      }
    );

    expect(response.status).toBe(201);
    const log = (await response.json()) as StatusLogResponse;

    // Retrieve logs
    const listResponse = await fetch(
      `${API_BASE_URL}/api/projects/${testProjectId}/checkpoints/${testCheckpointId}/status-log`,
      {
        headers: { 'Authorization': `Bearer ${PM_TOKEN}` },
      }
    );

    expect(listResponse.status).toBe(200);
    const logs = (await listResponse.json()) as StatusLogResponse[];
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.some((l) => l.id === log.id)).toBe(true);
  });

  // Test 7: Raise escalation, resolve it, verify status
  it('should raise and resolve escalations', async () => {
    // Raise escalation
    const raiseResponse = await fetch(
      `${API_BASE_URL}/api/projects/${testProjectId}/checkpoints/${testCheckpointId}/escalation`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PM_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          reason: 'Awaiting customer clarification on deliverables',
        }),
      }
    );

    expect(raiseResponse.status).toBe(201);
    const escalation = (await raiseResponse.json()) as EscalationResponse;
    expect(escalation.status).toBe('open');

    // Resolve escalation
    const resolveResponse = await fetch(
      `${API_BASE_URL}/api/projects/${testProjectId}/checkpoints/${testCheckpointId}/escalation/${escalation.id}/resolve`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${LEADERSHIP_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolution: 'Customer provided clarification' }),
      }
    );

    expect(resolveResponse.status).toBe(200);
    const resolved = (await resolveResponse.json()) as EscalationResponse;
    expect(resolved.status).toBe('resolved');
  });

  // Test 8: GET /reporting/summary with leadership token, verify response shape
  it('should return reporting summary with correct shape', async () => {
    const response = await fetch(`${API_BASE_URL}/api/projects/${testProjectId}/reporting/summary`, {
      headers: { 'Authorization': `Bearer ${LEADERSHIP_TOKEN}` },
    });

    expect(response.status).toBe(200);
    const data = (await response.json()) as ReportingResponse;

    expect(data.project_id).toBe(testProjectId);
    expect(typeof data.total_phases).toBe('number');
    expect(typeof data.phases_complete).toBe('number');
    expect(typeof data.macro_checkpoints_passed).toBe('number');
    expect(typeof data.completion_percentage).toBe('number');
    expect(data.completion_percentage).toBeGreaterThanOrEqual(0);
    expect(data.completion_percentage).toBeLessThanOrEqual(100);
  });

  // Test 9: Unauthenticated request returns 401
  it('should return 401 for unauthenticated requests', async () => {
    const response = await fetch(`${API_BASE_URL}/api/projects/${testProjectId}/gates`);

    expect(response.status).toBe(401);
  });

  // Test 10: PM role accessing admin endpoint returns 403
  it('should return 403 for unauthorized role', async () => {
    const response = await fetch(`${API_BASE_URL}/api/admin/config`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${PM_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        config_type: 'project_types',
        config_key: 'new_type',
        config_value: 'test',
      }),
    });

    expect(response.status).toBe(403);
  });
});

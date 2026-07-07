import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ulid } from 'ulid';
import { classifyEvent } from '@kiro-governance/shared/constants/macro-gates';
import { GovernanceEventRecord } from '@kiro-governance/shared/types/governance-event';
import { writeGovernanceEvent, resolveProject } from '../services/postgres.service';

/**
 * Input schema for record_progress tool.
 * Per F-01 §3.2 — exact fields, validation, constraints.
 */
export const RecordProgressInputSchema = z.object({
  project_id: z.string().min(1),
  update_text: z.string().min(1).max(4096),
  type: z.enum(['macro', 'micro']).optional(),
  gate: z.string().optional(),
  phase: z.string().optional(),
  phase_name: z.string().optional(),
  source_ref: z.string().min(1),
  actor: z.string().min(1),
  flag_override: z.boolean().optional(),
  // CR-14: optional Level-2 event code. Charset/length-validated but NOT checked against the
  // vocabulary at write time — unknown codes still persist (timeline-only). The Level-2 allow-list
  // is enforced at reconcile time via the micro_artifact_mapping join, keeping record_progress
  // decoupled from the mapping.
  event_code: z.string().regex(/^[a-z0-9._]{1,64}$/).optional(),
});

export type RecordProgressInput = z.infer<typeof RecordProgressInputSchema>;

export interface RecordProgressOutput {
  written: boolean;
  reason?: string;
}

/**
 * Register record_progress MCP tool.
 * See mcp-server-core-architecture.md §3.2
 */
export function registerRecordProgress(
  server: McpServer,
  _config?: unknown,
): void {
  server.tool(
    'record_progress',
    'Write a governance event to PostgreSQL with auto-classification and deduplication',
    RecordProgressInputSchema.shape as Record<string, unknown>,
    async (params: Record<string, unknown>): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
      try {
        const input = RecordProgressInputSchema.parse(params);
        const result = await handleRecordProgress(input);
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      } catch (err) {
        const error = err instanceof z.ZodError ? err.errors[0]?.message : String(err);
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: 'VALIDATION_ERROR', message: error }) }],
        };
      }
    },
  );
}

export async function handleRecordProgress(
  input: RecordProgressInput,
): Promise<RecordProgressOutput> {
  try {
    // Step 1: Classify event (F-01 §3.2, FR-03)
    const { resolvedType, matchedGate } = classifyEvent({
      update_text: input.update_text,
      type: input.type,
      flag_override: input.flag_override,
    });

    // Step 2: No-orphan resolve-or-reject (CR-08 / FR-P2-038).
    //   The incoming project_id is the GitHub repository name. Resolve it to a
    //   linked project BEFORE any write. If nothing matches, HARD REJECT — do
    //   not write governance_events. Applies to BOTH macro and micro events.
    const project = await resolveProject(input.project_id);
    if (!project) {
      // Dimensionless rejection metric (SEC-H2): no repo/caller dimension to avoid
      // unbounded cardinality / denial-of-wallet. Repo name goes to the log only.
      emitRejectionMetric();
      console.warn('[record_progress] Rejected — no matching project', {
        repo: input.project_id,
        reason: 'no_matching_project',
      });
      return { written: false, reason: 'no_matching_project' };
    }

    // Step 3: Derive gate (F-01 §3.2 FINDING-2)
    //   Priority: caller-provided > classification match > undefined
    let resolvedGate: string | undefined;
    if (input.gate) {
      resolvedGate = input.gate.toLowerCase().trim();
    } else if (resolvedType === 'macro' && matchedGate) {
      resolvedGate = matchedGate;
    }

    // Step 4: Generate ULID for idempotency key
    const eventUlid = ulid();

    // Step 5: Build idempotency key (F-04 §5.1)
    const idempotencyKey = buildIdempotencyKey(input.project_id, resolvedType, resolvedGate, eventUlid);

    // Step 6: Build GovernanceEventRecord
    //   project_id stays the repo name (unchanged). The resolved project is used
    //   only for the no-orphan guard — nothing extra is persisted (not modeled).
    const now = new Date().toISOString();

    const record: GovernanceEventRecord = {
      project_id: input.project_id,
      update_text: input.update_text,
      type: resolvedType,
      source_ref: input.source_ref,
      actor: input.actor,
      created_at: now,
      idempotency_key: idempotencyKey,
      ...(resolvedGate && { gate: resolvedGate }),
      ...(input.phase && { phase: input.phase }),
      ...(input.phase_name && { phase_name: input.phase_name }),
      ...(input.event_code && { event_code: input.event_code }),
      ...(input.flag_override !== undefined && { flag_override: input.flag_override }),
    };

    // Step 7: Write event record to PostgreSQL (F-04 §5.2)
    //   ON CONFLICT (idempotency_key) DO NOTHING handles deduplication atomically
    const result = await writeGovernanceEvent(record, idempotencyKey);

    if (!result.written) {
      console.info('[record_progress] Dedup hit', { projectId: input.project_id, idempotencyKey });
      return { written: false, reason: 'duplicate' };
    }

    console.log('[record_progress] Written', { project_id: input.project_id, gate: resolvedGate, type: resolvedType, idempotency_key: idempotencyKey });
    return { written: true };
  } catch (err) {
    console.error('[record_progress] PostgreSQL write failed', { error: String(err) });
    return {
      written: false,
      reason: 'database_write_failed',
    };
  }
}

/**
 * Emit a dimensionless `GovernanceEventRejected` CloudWatch metric via EMF
 * (Embedded Metric Format). Per SEC-H2, the metric carries NO dimensions — the
 * caller-supplied repo name is never used as a dimension (avoids unbounded
 * cardinality / denial-of-wallet). The repo name is logged separately.
 */
function emitRejectionMetric(): void {
  const emf = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: 'KiroGovernance',
          Dimensions: [[]],
          Metrics: [{ Name: 'GovernanceEventRejected', Unit: 'Count' }],
        },
      ],
    },
    GovernanceEventRejected: 1,
  };
  console.log(JSON.stringify(emf));
}

/**
 * Build idempotency key per F-04 §5.1.
 * Macro: <project_id>#<gate.toLowerCase().trim()>#<YYYY-MM-DD>
 * Micro: <project_id>#micro#<ULID>
 */
export function buildIdempotencyKey(
  projectId: string,
  type: 'macro' | 'micro',
  gate: string | undefined,
  ulid: string,
): string {
  if (type === 'macro' && gate) {
    const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const normalizedGate = gate.toLowerCase().trim();
    return `${projectId}#${normalizedGate}#${today}`;
  }
  // Micro events: always unique (ULID guarantees)
  return `${projectId}#micro#${ulid}`;
}

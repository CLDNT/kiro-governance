# Implementation Spec — KG-18 Update Shared Types

**Story:** KG-18 — Update shared types: flatten GovernanceEventRecord (remove pk/sk)

**Sprint:** Sprint 4

**Effort:** 1 story point

**Type:** Type-only refactor — no runtime behavior changes

---

## Overview

Replace the DynamoDB-shaped `GovernanceEventRecord` interface with the PostgreSQL-shaped version. Remove `pk` and `sk` fields, add `id?: number` and `phase_name?: string` fields.

This is a prerequisite for KG-17 (MCP Server migration to RDS PostgreSQL) and is enabled by KG-16 (database schema creation).

---

## Changes Required

### 1. Update `packages/shared/types/governance-event.ts`

**Current state:** `GovernanceEventRecord` has `pk: string` and `sk: string` fields.

**Target state:** Remove `pk` and `sk`. Add `id?: number` and `phase_name?: string`. Keep all other fields identical.

```typescript
/**
 * PostgreSQL record shape for governance_events table.
 * Canonical definition — unified data model v1.4.
 */
export interface GovernanceEventRecord {
  /** Auto-incrementing primary key (populated by Postgres) */
  id?: number;

  /** GitHub repository name */
  project_id: string;

  /** Human-readable event description (max 4096 chars) */
  update_text: string;

  /** Event classification */
  type: 'macro' | 'micro';

  /** True if type was manually overridden; undefined if auto-classified */
  flag_override?: boolean;

  /** Canonical macro gate name. Present for macro events, absent for micro. */
  gate?: string;

  /** Phase grouping (e.g., "Phase 1") */
  phase?: string;

  /** Human-readable phase name (e.g., "Internal Preparation") */
  phase_name?: string;

  /** Provenance — commit SHA or file line reference */
  source_ref: string;

  /** Who emitted/approved (agent name or human name) */
  actor: string;

  /** ISO-8601 creation timestamp */
  created_at: string;

  /** Deduplication key */
  idempotency_key: string;
}
```

**Remove:** `DeduplicatedSentinelRecord` interface (only needed for DynamoDB dedup pattern; PostgreSQL uses ON CONFLICT instead).

### 2. Update `packages/mcp-server/src/tools/record-progress.ts`

**Impact:** The `GovernanceEventRecord` used in Step 6 of `handleRecordProgress()` no longer has `pk` and `sk` fields.

**Changes:**

- Remove `pk` and `sk` variables (lines ~104-105)
- Update record builder to NOT include `pk` and `sk` (lines ~107-115)
- Update return value: change from `{ written: true, pk, sk }` to `{ written: true }` (line ~117)

**Before:**
```typescript
const pk = `PROJECT#${input.project_id}`;
const sk = `UPDATE#${now}#${eventUlid}`;

const record: GovernanceEventRecord = {
  pk,
  sk,
  update_text: input.update_text,
  type: resolvedType,
  source_ref: input.source_ref,
  actor: input.actor,
  created_at: now,
  idempotency_key: idempotencyKey,
  ...(resolvedGate && { gate: resolvedGate }),
  ...(input.phase && { phase: input.phase }),
  ...(input.flag_override !== undefined && { flag_override: input.flag_override }),
};
```

**After:**
```typescript
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
  ...(input.flag_override !== undefined && { flag_override: input.flag_override }),
};
```

**Return:**
```typescript
return { written: true };
```

### 3. Update `packages/mcp-server/src/services/dynamodb.service.ts`

**Impact:** If this file exists and uses `GovernanceEventRecord` in function signatures, update any references.

- Verify `writeGovernanceEvent()` signature accepts `record: GovernanceEventRecord` (should be unchanged)
- No code changes needed if the service layer doesn't explicitly reference `pk` or `sk`

### 4. Verify TypeScript Strict Mode

Run:
```bash
npm run type-check
```

Expected: Zero errors. All imports of `GovernanceEventRecord` automatically resolve to the new interface shape.

---

## Acceptance Criteria Checklist

- [ ] `GovernanceEventRecord` interface removes `pk` and `sk` fields
- [ ] `GovernanceEventRecord` interface adds `id?: number` field
- [ ] `GovernanceEventRecord` interface adds `phase_name?: string` field
- [ ] `DeduplicatedSentinelRecord` interface removed from `governance-event.ts`
- [ ] `packages/shared/index.ts` export updated (remove `DeduplicatedSentinelRecord`)
- [ ] `record-progress.ts` Step 6 removes `pk`/`sk` assignment
- [ ] `record-progress.ts` return value changed to `{ written: true }` (no pk/sk)
- [ ] `dynamodb.service.ts` references checked (no code changes needed if service layer doesn't reference pk/sk)
- [ ] `npm run type-check` passes with zero errors
- [ ] No other TypeScript files broken by the refactor

---

## Files to Modify

| File | Changes | Impact |
|------|---------|--------|
| `packages/shared/types/governance-event.ts` | Remove pk/sk, add id/phase_name, remove DeduplicatedSentinelRecord | High — type definition |
| `packages/shared/index.ts` | Remove DeduplicatedSentinelRecord export | Low — export only |
| `packages/mcp-server/src/tools/record-progress.ts` | Remove pk/sk construction, update record builder, update return | Medium — MCP tool |
| `packages/mcp-server/src/services/dynamodb.service.ts` | Verify no explicit pk/sk references | Low — likely no changes |

---

## Testing Strategy

### Unit Tests

Update existing tests in `packages/mcp-server/__tests__/tools/record-progress.test.ts`:

1. **Test: record written successfully**
   - Verify returned object has `{ written: true }` (no pk/sk)
   - Verify DynamoDB write was called with correct shape

2. **Test: duplicate detection**
   - Verify returned object has `{ written: false, reason: 'duplicate' }`

### Type Check

```bash
npm run type-check
```

Must pass with zero errors.

### Build

```bash
npm run build
```

Must succeed. No TypeScript compilation errors.

---

## Definition of Done

- [ ] Type changes made to `governance-event.ts`
- [ ] All imports across codebase still resolve correctly
- [ ] Return types updated in `record-progress.ts`
- [ ] Unit tests updated to expect new return shape
- [ ] `npm run type-check` passes
- [ ] `npm run build` succeeds
- [ ] No console warnings or errors
- [ ] PR passes all GitHub Actions checks

---

## Notes

- **No runtime behavior change:** The MCP tool still writes governance events to the database. Only the TypeScript interface changed.
- **PostgreSQL-ready:** After this change, KG-17 can modify the service layer to use PostgreSQL instead of DynamoDB without changing the MCP tool interface.
- **Can run in parallel:** This spec does not depend on KG-17. It can be implemented immediately after KG-16 (schema creation) is complete.

---

## Related Stories

- **KG-16:** DB migration script — creates `governance_events` table with `id` column
- **KG-17:** MCP Server migration — replaces DynamoDB SDK with PostgreSQL pg + IAM auth
- **KG-15:** CDK infrastructure — replaces DynamoDB with RDS PostgreSQL

---

*Spec prepared for backend developer. See data-persistence-architecture.md §3–8 for design rationale. See SRS FR-03 for acceptance criteria traceability.*

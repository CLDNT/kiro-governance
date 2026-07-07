/**
 * Gates domain public entry.
 *
 * This barrel is the ONLY sanctioned cross-domain surface for the gates package. Other domains
 * (e.g. projects) import from '@kiro-governance/gates' — never from '../../gates/services/*',
 * which crosses a domain boundary via a relative path and breaks `tsc` rootDir isolation
 * (docs/code-structure.md §2). Internal gates handlers keep their relative './services/*' imports.
 */

// CR-12 / FR-P2-042 — Level-2 micro→artifact reconciliation. Owned by the gates domain (it also
// backs the gates `POST /sync-artifacts` endpoint and the gate-view auto-reconcile). The projects
// create/update handlers invoke the best-effort, always-resolving trigger at link time.
export {
  reconcileMicroArtifacts,
  triggerMicroArtifactReconcile,
  ARTIFACT_SYNC_ACTOR,
} from './services/micro-artifact-reconcile.service';
export type { ReconcileArtifactsSummary } from './services/micro-artifact-reconcile.service';

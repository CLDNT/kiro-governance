/**
 * Level-2 micro-artifact helpers (CR-12 / FR-P2-042).
 *
 * Pure, side-effect-free logic for:
 *  - deriving the completion provenance of a micro artifact ('kiro' auto vs 'manual');
 *  - extracting the Kiro actor from a `kiro:<actor>` completed_by value;
 *  - UX-only role gates that mirror the backend RBAC (the server is the real enforcer).
 *
 * The single source of truth for "was this auto-completed by Kiro?" is the `completed_by`
 * convention set by the reconciler: `kiro:<actor>` (see gates sync-artifacts + reconcile service).
 */

import type { Role } from '@/lib/linkage';

/** Prefix the Level-2 reconciler writes into `completed_by` when it auto-completes a row. */
export const KIRO_COMPLETED_BY_PREFIX = 'kiro:';

export type ArtifactCompletionSource = 'kiro' | 'manual' | 'none';

/** True when `completed_by` was written by the Kiro Level-2 reconciler (`kiro:<actor>`). */
export function isKiroCompleted(completedBy: string | null | undefined): boolean {
  return typeof completedBy === 'string' && completedBy.startsWith(KIRO_COMPLETED_BY_PREFIX);
}

/**
 * The actor recorded after the `kiro:` prefix (e.g. `kiro:aws-architect` → `aws-architect`),
 * or null when the value is not a Kiro-auto value or carries no actor.
 */
export function kiroActor(completedBy: string | null | undefined): string | null {
  if (!isKiroCompleted(completedBy)) return null;
  const actor = (completedBy as string).slice(KIRO_COMPLETED_BY_PREFIX.length).trim();
  return actor.length > 0 ? actor : null;
}

/**
 * Provenance of a micro artifact's completion:
 *  - 'kiro'   → complete, auto-completed by the Level-2 reconciler;
 *  - 'manual' → complete, completed by a human;
 *  - 'none'   → not complete.
 */
export function completionSource(
  artifact: { status: string; completed_by: string | null }
): ArtifactCompletionSource {
  if (artifact.status !== 'complete') return 'none';
  return isKiroCompleted(artifact.completed_by) ? 'kiro' : 'manual';
}

/**
 * A human-friendly label for who/what completed the artifact.
 * Strips the `kiro:` prefix for auto-completed rows so the UI can render "Kiro (<actor>)".
 */
export function completedByLabel(completedBy: string | null | undefined): string | null {
  if (!completedBy) return null;
  const actor = kiroActor(completedBy);
  if (actor) return `Kiro (${actor})`;
  if (isKiroCompleted(completedBy)) return 'Kiro';
  return completedBy;
}

// ─── UX-only role gates (backend RBAC is the real enforcer) ──────────────────

/**
 * Roles allowed to manually change a micro-artifact status via PATCH /artifacts.
 * Mirrors the backend `withRoles(['pm','sa','leadership','admin'])` — engineers are view-only.
 */
export function canEditArtifact(role: Role | null | undefined): boolean {
  return role === 'pm' || role === 'sa' || role === 'leadership' || role === 'admin';
}

/**
 * Roles allowed to clear manual_override and re-enable Kiro auto-sync (reset_to_auto),
 * and to trigger a manual repo → artifact sync. Mirrors backend admin/leadership gate.
 */
export function canManageArtifactAuto(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'leadership';
}

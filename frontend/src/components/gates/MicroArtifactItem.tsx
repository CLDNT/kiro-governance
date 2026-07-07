/**
 * MicroArtifactItem — a single CASDM micro-artifact row with Level-2 provenance (CR-12 / FR-P2-042).
 *
 * Surfaces:
 *  - the artifact status;
 *  - a 'kiro' source badge when the row was AUTO-completed by the Level-2 reconciler
 *    (completed_by starts with 'kiro:'), vs a 'Manual' badge for human completion;
 *  - a 'Manual override' chip when a human has locked the row from auto-sync;
 *  - completed_at / completed_by details;
 *  - the manual status toggle (pm/sa/leadership/admin) which acts as the override, and a
 *    reset-to-auto action (admin/leadership) that re-enables Kiro auto-sync.
 *
 * The backend is the real RBAC + audit enforcer; the role gates here are UX-only.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sparkles, Loader2, RotateCcw } from 'lucide-react';

import { useApiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Role } from '@/lib/linkage';
import type { MicroArtifact, UpdateArtifactInput } from '@/types';
import {
  completionSource,
  completedByLabel,
  canEditArtifact,
  canManageArtifactAuto,
} from '@/lib/artifacts';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

type ArtifactStatus = MicroArtifact['status'];

interface MicroArtifactItemProps {
  artifact: MicroArtifact;
  projectId: string;
  /** Current user's role — drives which controls are shown (UX-only; backend enforces). */
  role: Role | null | undefined;
}

const STATUS_VARIANT: Record<ArtifactStatus, BadgeVariant> = {
  complete: 'success',
  in_progress: 'info',
  pending: 'neutral',
};

const STATUS_LABEL: Record<ArtifactStatus, string> = {
  complete: 'Complete',
  in_progress: 'In progress',
  pending: 'Pending',
};

const STATUS_ORDER: ArtifactStatus[] = ['pending', 'in_progress', 'complete'];

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

function MicroArtifactItem({ artifact, projectId, role }: MicroArtifactItemProps): JSX.Element {
  const client = useApiClient();
  const queryClient = useQueryClient();

  const canEdit = canEditArtifact(role);
  const canManageAuto = canManageArtifactAuto(role);
  const source = completionSource(artifact);
  const isComplete = artifact.status === 'complete';

  const mutation = useMutation({
    mutationFn: async (body: UpdateArtifactInput) => {
      await client.patch(`/api/projects/${projectId}/artifacts/${artifact.id}`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update artifact status');
    },
  });

  const setStatus = (status: ArtifactStatus): void => {
    if (status === artifact.status && !artifact.manual_override) return;
    mutation.mutate({ status });
  };

  const resetToAuto = (): void => {
    // Clears manual_override while keeping the current status, re-enabling Kiro auto-sync.
    mutation.mutate({ status: artifact.status, reset_to_auto: true });
  };

  return (
    <Card
      className={cn(isComplete && source === 'kiro' && 'border-blue-500/40 bg-blue-500/5',
        isComplete && source === 'manual' && 'border-emerald-500/40 bg-emerald-500/5')}
      data-testid={`micro-artifact-${artifact.id}`}
      data-source={source}
    >
      <CardContent className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium text-foreground">{artifact.artifact_name}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{artifact.phase_name}</p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
            <Badge variant={STATUS_VARIANT[artifact.status]}>{STATUS_LABEL[artifact.status]}</Badge>

            {source === 'kiro' && (
              <Badge variant="info" className="gap-1" data-testid="kiro-badge">
                <Sparkles className="h-3 w-3" aria-hidden="true" />
                kiro
              </Badge>
            )}
            {source === 'manual' && (
              <Badge variant="secondary" data-testid="manual-badge">
                Manual
              </Badge>
            )}
            {artifact.manual_override && (
              <Badge variant="warning" data-testid="override-badge">
                Manual override
              </Badge>
            )}
          </div>
        </div>

        {/* Completion details */}
        {isComplete && (artifact.completed_at || artifact.completed_by) && (
          <p className="text-xs text-muted-foreground" data-testid="completion-info">
            ✓ Completed {formatDate(artifact.completed_at)}
            {completedByLabel(artifact.completed_by) && (
              <> by {completedByLabel(artifact.completed_by)}</>
            )}
          </p>
        )}

        {/* Controls */}
        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2">
            <div
              className="flex flex-wrap gap-1.5"
              role="group"
              aria-label={`Set status for ${artifact.artifact_name}`}
            >
              {STATUS_ORDER.map((status) => (
                <Button
                  key={status}
                  type="button"
                  size="sm"
                  variant={artifact.status === status ? 'default' : 'outline'}
                  aria-pressed={artifact.status === status}
                  disabled={mutation.isPending}
                  onClick={() => setStatus(status)}
                >
                  {STATUS_LABEL[status]}
                </Button>
              ))}
            </div>

            {artifact.manual_override && canManageAuto && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={mutation.isPending}
                onClick={resetToAuto}
                title="Clear the manual override and re-enable Kiro auto-sync"
              >
                {mutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                ) : (
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                Reset to auto
              </Button>
            )}
          </div>
        ) : (
          <p className="text-xs italic text-muted-foreground">
            View-only. Contact a PM/SA to change status.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default MicroArtifactItem;

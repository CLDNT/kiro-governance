import { type FormEvent, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  CalendarDays,
  Sparkles,
  ListChecks,
  UserCheck,
  Loader2,
  Paperclip,
  FileText,
  Link2,
  Upload,
  ChevronRight,
  RefreshCw,
} from 'lucide-react';

import { useProject } from '@/hooks/useProjects';
import { useGates } from '@/hooks/useGates';
import { useApiClient } from '@/lib/api';
import { cn } from '@/lib/utils';
import {
  MacroCheckpoint,
  PhaseGateView,
  Project,
  SyncArtifactsResponse,
} from '@/types';
import { useAuth } from '@/contexts/AuthContext';
import { canManageArtifactAuto } from '@/lib/artifacts';
import MicroArtifactItem from '@/components/gates/MicroArtifactItem';
import TranscriptAnalysisPanel from '@/components/gates/TranscriptAnalysisPanel';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ProjectLinkageCard } from '@/components/projects/ProjectLinkageCard';

const PHASE_ORDER = ['Phase 0', 'Phase 1', 'Phase 2', 'Phase 3', 'Phase 4'] as const;

const CHECKPOINT_ICON: Record<MacroCheckpoint['checkpoint_type'], typeof CheckCircle2> = {
  human_review: UserCheck,
  meeting: CalendarDays,
  transcript_analysis: Sparkles,
  checklist: ListChecks,
};

function formatDate(value: string | null): string {
  return value ? new Date(value).toLocaleDateString() : '—';
}

// ─── Phase stepper ───────────────────────────────────────────────────────────

function PhaseStepper({ currentPhase }: { currentPhase: string }): JSX.Element {
  const currentIndex = PHASE_ORDER.indexOf(currentPhase as (typeof PHASE_ORDER)[number]);
  return (
    <ol className="flex items-center">
      {PHASE_ORDER.map((phase, i) => {
        const completed = i < currentIndex;
        const current = i === currentIndex;
        return (
          <li key={phase} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                  completed && 'border-emerald-500 bg-emerald-500 text-white',
                  current && 'border-primary bg-background text-primary',
                  !completed && !current && 'border-border bg-background text-muted-foreground'
                )}
                aria-current={current ? 'step' : undefined}
              >
                {completed ? <CheckCircle2 className="h-4 w-4" /> : i}
              </span>
              <span
                className={cn(
                  'hidden text-[11px] font-medium sm:block',
                  current ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                {phase}
              </span>
            </div>
            {i < PHASE_ORDER.length - 1 && (
              <span
                className={cn(
                  'mx-2 mb-5 h-0.5 flex-1 rounded-full transition-colors',
                  i < currentIndex ? 'bg-emerald-500' : 'bg-border'
                )}
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ─── Checkpoint card ───────────────────────────────────────────────────────

function checkpointStatus(c: MacroCheckpoint): { Icon: typeof CheckCircle2; className: string } {
  if (c.reached_at) return { Icon: CheckCircle2, className: 'text-emerald-500' };
  if (c.occurred) return { Icon: Clock, className: 'text-amber-500' };
  return { Icon: AlertCircle, className: 'text-muted-foreground' };
}

function CheckpointCard({
  checkpoint,
  onComplete,
  onAddEvidence,
}: {
  checkpoint: MacroCheckpoint;
  onComplete: (c: MacroCheckpoint) => void;
  onAddEvidence: (c: MacroCheckpoint) => void;
}): JSX.Element {
  const { Icon, className } = checkpointStatus(checkpoint);
  const TypeIcon = CHECKPOINT_ICON[checkpoint.checkpoint_type] ?? ListChecks;
  const completed = Boolean(checkpoint.reached_at);

  return (
    <Card className={cn(completed && 'border-emerald-500/40 bg-emerald-500/5')}>
      <CardContent className="flex gap-4 p-4">
        <Icon className={cn('mt-0.5 h-5 w-5 shrink-0', className)} aria-hidden="true" />

        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground">{checkpoint.checkpoint_name}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="gap-1">
              <TypeIcon className="h-3 w-3" />
              {checkpoint.checkpoint_type.replace(/_/g, ' ')}
            </Badge>
            {completed && (
              <Badge variant="success">Completed {formatDate(checkpoint.reached_at)}</Badge>
            )}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-1.5">
            <Badge variant="neutral" className="gap-1">
              <Paperclip className="h-3 w-3" />
              {checkpoint.evidence_count}
            </Badge>
            <Badge variant="neutral" className="gap-1">
              <FileText className="h-3 w-3" />
              {checkpoint.notes_count}
            </Badge>
          </div>
          <div className="flex items-center gap-1.5">
            <Button size="sm" variant="outline" onClick={() => onAddEvidence(checkpoint)}>
              Evidence
            </Button>
            <Button size="sm" onClick={() => onComplete(checkpoint)}>
              {completed ? 'Update' : 'Complete'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Complete checkpoint sheet ───────────────────────────────────────────────

function CompleteCheckpointSheet({
  checkpoint,
  projectId,
  onClose,
}: {
  checkpoint: MacroCheckpoint;
  projectId: string;
  onClose: () => void;
}): JSX.Element {
  const client = useApiClient();
  const queryClient = useQueryClient();

  const [reviewedBy, setReviewedBy] = useState(checkpoint.reviewed_by ?? '');
  const [occurred, setOccurred] = useState(Boolean(checkpoint.occurred));
  const [meetingDate, setMeetingDate] = useState(checkpoint.meeting_date ?? '');
  const [meetingLink, setMeetingLink] = useState(checkpoint.meeting_link ?? '');
  const [resultDetail, setResultDetail] = useState(checkpoint.result_detail ?? '');

  const mutation = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {};
      if (checkpoint.checkpoint_type === 'human_review' && reviewedBy) {
        payload.reviewed_by = reviewedBy;
      }
      if (checkpoint.checkpoint_type === 'meeting') {
        if (occurred) payload.occurred = true;
        if (meetingDate) payload.meeting_date = meetingDate;
        if (meetingLink) payload.meeting_link = meetingLink;
      }
      if (resultDetail) payload.result_detail = resultDetail;
      await client.patch(`/api/projects/${projectId}/checkpoints/${checkpoint.id}`, payload);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
      toast.success('Checkpoint updated');
      onClose();
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to update checkpoint');
    },
  });

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    mutation.mutate();
  };

  const TypeIcon = CHECKPOINT_ICON[checkpoint.checkpoint_type] ?? ListChecks;

  return (
    <SheetContent className="flex w-full flex-col sm:max-w-md">
      <SheetHeader>
        <SheetTitle>Complete checkpoint</SheetTitle>
        <SheetDescription className="flex items-center gap-1.5">
          <TypeIcon className="h-3.5 w-3.5" />
          {checkpoint.checkpoint_type.replace(/_/g, ' ')}
        </SheetDescription>
      </SheetHeader>

      <form onSubmit={handleSubmit} className="flex flex-1 flex-col gap-5 overflow-y-auto py-4">
        <div className="rounded-lg border bg-muted/40 p-3">
          <p className="font-medium text-foreground">{checkpoint.checkpoint_name}</p>
        </div>

        {checkpoint.checkpoint_type === 'human_review' && (
          <div className="space-y-1.5">
            <Label htmlFor="reviewed-by">Reviewed by</Label>
            <Input
              id="reviewed-by"
              value={reviewedBy}
              onChange={(e) => setReviewedBy(e.target.value)}
              placeholder="Reviewer name or email"
              required
            />
          </div>
        )}

        {checkpoint.checkpoint_type === 'meeting' && (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label>Meeting occurred?</Label>
              <div className="flex gap-2" role="group" aria-label="Meeting occurred">
                <Button
                  type="button"
                  variant={occurred ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={occurred}
                  onClick={() => setOccurred(true)}
                >
                  Yes
                </Button>
                <Button
                  type="button"
                  variant={!occurred ? 'default' : 'outline'}
                  size="sm"
                  aria-pressed={!occurred}
                  onClick={() => setOccurred(false)}
                >
                  Not yet
                </Button>
              </div>
            </div>

            {occurred && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="meeting-date">Meeting date</Label>
                  <Input
                    id="meeting-date"
                    type="date"
                    value={meetingDate}
                    onChange={(e) => setMeetingDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="meeting-link">Meeting link (optional)</Label>
                  <Input
                    id="meeting-link"
                    type="url"
                    value={meetingLink}
                    onChange={(e) => setMeetingLink(e.target.value)}
                    placeholder="https://app.avoma.com/…"
                  />
                </div>
              </>
            )}
          </div>
        )}

        {checkpoint.checkpoint_type === 'transcript_analysis' && (
          <TranscriptAnalysisPanel checkpoint={checkpoint} projectId={projectId} />
        )}

        <div className="space-y-1.5">
          <Label htmlFor="result-detail">Result / notes (optional)</Label>
          <Textarea
            id="result-detail"
            value={resultDetail}
            onChange={(e) => setResultDetail(e.target.value)}
            placeholder="Add any details about this checkpoint…"
            rows={3}
          />
        </div>

        <SheetFooter className="mt-auto gap-2 sm:flex-col">
          {checkpoint.checkpoint_type !== 'transcript_analysis' && (
            <Button type="submit" className="w-full" disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="animate-spin" />}
              Save checkpoint
            </Button>
          )}
          <Button type="button" variant="ghost" className="w-full" onClick={onClose}>
            Cancel
          </Button>
        </SheetFooter>
      </form>
    </SheetContent>
  );
}

// ─── Evidence dialog ─────────────────────────────────────────────────────────

const ALLOWED_FILE_TYPES = [
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/png',
  'image/jpeg',
  'text/plain',
  'text/markdown',
];
const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

function EvidenceDialog({
  checkpoint,
  projectId,
  onClose,
}: {
  checkpoint: MacroCheckpoint;
  projectId: string;
  onClose: () => void;
}): JSX.Element {
  const client = useApiClient();
  const queryClient = useQueryClient();

  const [meetingLink, setMeetingLink] = useState('');
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const postEvidence = useMutation({
    mutationFn: async (body: { evidence_type: string; value: string; label?: string }) => {
      await client.post(`/api/projects/${projectId}/checkpoints/${checkpoint.id}/evidence`, body);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['gates', projectId] });
      toast.success('Evidence attached');
      onClose();
    },
    onError: (err) => {
      setError(err instanceof Error ? err.message : 'Failed to attach evidence');
    },
  });

  const submitLink = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError('');
    if (!meetingLink.startsWith('https://app.avoma.com/')) {
      setError('Meeting link must be from https://app.avoma.com/');
      return;
    }
    postEvidence.mutate({ evidence_type: 'meeting_link', value: meetingLink });
  };

  const submitUrl = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError('');
    postEvidence.mutate({ evidence_type: 'url', value: url });
  };

  const submitFile = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setError('');
    if (!file) {
      setError('Please select a file.');
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setError('File size must be less than 25MB.');
      return;
    }
    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      setError('File type not supported. Allowed: PDF, DOCX, XLSX, PNG, JPG, TXT, MD.');
      return;
    }
    // Real flow: request a presigned URL, upload to S3, then submit the S3 key.
    postEvidence.mutate({
      evidence_type: 'file_upload',
      value: `s3://deliverpro-evidence/${projectId}/${file.name}`,
      label: file.name,
    });
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>Add evidence</DialogTitle>
        <DialogDescription>{checkpoint.checkpoint_name}</DialogDescription>
      </DialogHeader>

      <Tabs defaultValue="link" onValueChange={() => setError('')}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="link" className="gap-1.5">
            <CalendarDays className="h-4 w-4" />
            Meeting
          </TabsTrigger>
          <TabsTrigger value="file" className="gap-1.5">
            <Upload className="h-4 w-4" />
            File
          </TabsTrigger>
          <TabsTrigger value="url" className="gap-1.5">
            <Link2 className="h-4 w-4" />
            URL
          </TabsTrigger>
        </TabsList>

        {error && (
          <Alert variant="destructive" className="mt-4">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <TabsContent value="link" className="mt-4">
          <form onSubmit={submitLink} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="avoma-link">Avoma meeting link</Label>
              <Input
                id="avoma-link"
                type="url"
                value={meetingLink}
                onChange={(e) => setMeetingLink(e.target.value)}
                placeholder="https://app.avoma.com/…"
                required
              />
              <p className="text-xs text-muted-foreground">Must be from the app.avoma.com domain.</p>
            </div>
            <Button type="submit" className="w-full" disabled={postEvidence.isPending}>
              {postEvidence.isPending && <Loader2 className="animate-spin" />}
              Add evidence
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="file" className="mt-4">
          <form onSubmit={submitFile} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="evidence-file">Choose file</Label>
              <Input
                id="evidence-file"
                type="file"
                accept=".pdf,.docx,.xlsx,.png,.jpg,.txt,.md"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                Max 25MB: PDF, DOCX, XLSX, PNG, JPG, TXT, MD.
              </p>
            </div>
            <Button type="submit" className="w-full" disabled={postEvidence.isPending || !file}>
              {postEvidence.isPending && <Loader2 className="animate-spin" />}
              Upload
            </Button>
          </form>
        </TabsContent>

        <TabsContent value="url" className="mt-4">
          <form onSubmit={submitUrl} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="evidence-url">External URL</Label>
              <Input
                id="evidence-url"
                type="url"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={postEvidence.isPending}>
              {postEvidence.isPending && <Loader2 className="animate-spin" />}
              Add evidence
            </Button>
          </form>
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

function ProjectDetailPage(): JSX.Element {
  const { projectId } = useParams<{ projectId: string }>();
  const id = projectId ?? '';

  const { user } = useAuth();
  const client = useApiClient();
  const queryClient = useQueryClient();

  const [completeTarget, setCompleteTarget] = useState<MacroCheckpoint | null>(null);
  const [evidenceTarget, setEvidenceTarget] = useState<MacroCheckpoint | null>(null);

  const projectQuery = useProject(id);
  const gatesQuery = useGates(id);

  const canSyncArtifacts = canManageArtifactAuto(user?.role);

  const syncArtifacts = useMutation({
    mutationFn: async (): Promise<SyncArtifactsResponse> => {
      const response = await client.post<SyncArtifactsResponse>(
        `/api/projects/${id}/sync-artifacts`
      );
      return response.data;
    },
    onSuccess: (summary) => {
      void queryClient.invalidateQueries({ queryKey: ['gates', id] });
      toast.success(
        `Kiro sync complete — ${summary.completed} completed, ${summary.matched} matched, ${summary.skipped} skipped.`
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : 'Failed to sync artifacts from Kiro');
    },
  });

  const project = projectQuery.data as Project | undefined;
  const gates = gatesQuery.data;

  if (projectQuery.isLoading || gatesQuery.isLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (projectQuery.isError || gatesQuery.isError || !project || !gates) {
    return (
      <Alert variant="destructive">
        <AlertTitle>Failed to load project</AlertTitle>
        <AlertDescription className="flex flex-col items-start gap-3">
          <span>The project could not be loaded. It may not exist or you may not have access.</span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void projectQuery.refetch();
              void gatesQuery.refetch();
            }}
          >
            Retry
          </Button>
        </AlertDescription>
      </Alert>
    );
  }

  const metadata: { label: string; value: string }[] = [
    { label: 'Jira Key', value: project.jira_key },
    { label: 'Type', value: project.project_type || '—' },
    { label: 'Status', value: project.status || '—' },
    { label: 'Project Manager', value: project.project_manager || '—' },
    { label: 'Solution Architect', value: project.solution_architect || '—' },
    { label: 'Planned Kickoff', value: formatDate(project.planned_kickoff_date) },
    { label: 'Expected Completion', value: formatDate(project.expected_completion_date) },
    {
      label: 'SOW / Consumed Hours',
      value: `${project.sow_hours ?? '—'} / ${project.hours_consumed ?? 0}`,
    },
    {
      label: 'Burn Rate',
      value: project.burn_rate_pct != null ? `${Math.round(project.burn_rate_pct)}%` : 'N/A',
    },
  ];

  return (
    <div className="space-y-6">
      {/* Sticky header */}
      <div className="sticky top-0 z-20 -mx-4 space-y-4 border-b bg-background/95 px-4 pb-4 pt-1 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-sm">
          <Link to="/projects" className="text-muted-foreground transition-colors hover:text-foreground">
            Projects
          </Link>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/50" />
          <span className="font-medium text-foreground">{project.title}</span>
        </nav>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">{project.title}</h1>
            <Badge variant="secondary" className="font-mono">
              {project.jira_key}
            </Badge>
          </div>
          <Badge variant="info">{project.current_phase}</Badge>
        </div>

        <PhaseStepper currentPhase={project.current_phase} />
      </div>

      {/* Metadata */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Project details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 md:grid-cols-3">
            {metadata.map((field) => (
              <div key={field.label}>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {field.label}
                </dt>
                <dd className="mt-1 text-sm font-medium text-foreground">{field.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>

      {/* GitHub & Slack linkage (CR-15) */}
      <ProjectLinkageCard project={project} />

      {/* Phase accordion */}
      <Accordion
        type="single"
        collapsible
        defaultValue={gates.phases[0]?.phase}
        className="space-y-3"
      >
        {gates.phases.map((phaseView: PhaseGateView) => (
          <AccordionItem
            key={phaseView.phase}
            value={phaseView.phase}
            className="rounded-lg border bg-card px-4"
          >
            <AccordionTrigger className="hover:no-underline">
              <div className="flex flex-1 items-center justify-between gap-3 pr-3">
                <div className="text-left">
                  <p className="font-semibold text-foreground">{phaseView.phase}</p>
                  <p className="text-sm font-normal text-muted-foreground">{phaseView.phase_name}</p>
                </div>
                <Badge variant={phaseView.phase_complete ? 'success' : 'neutral'}>
                  {phaseView.phase_complete ? 'Complete' : 'In progress'}
                </Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-6">
              {/* Micro artifacts */}
              {phaseView.micro_artifacts.length > 0 && (
                <div>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <h4 className="text-sm font-semibold text-foreground">Artifacts</h4>
                    {canSyncArtifacts && project.github_repo && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncArtifacts.mutate()}
                        disabled={syncArtifacts.isPending}
                        title="Reconcile Kiro micro-events into artifact completion"
                      >
                        {syncArtifacts.isPending ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                        )}
                        Sync from Kiro
                      </Button>
                    )}
                  </div>
                  <div className="space-y-2">
                    {phaseView.micro_artifacts.map((a) => (
                      <MicroArtifactItem
                        key={a.id}
                        artifact={a}
                        projectId={id}
                        role={user?.role}
                      />
                    ))}
                  </div>
                </div>
              )}

              {/* Macro checkpoints */}
              {phaseView.macro_checkpoints.length > 0 && (
                <div>
                  <h4 className="mb-3 text-sm font-semibold text-foreground">Checkpoints</h4>
                  <div className="space-y-3">
                    {phaseView.macro_checkpoints.map((c) => (
                      <CheckpointCard
                        key={c.id}
                        checkpoint={c}
                        onComplete={setCompleteTarget}
                        onAddEvidence={setEvidenceTarget}
                      />
                    ))}
                  </div>
                </div>
              )}

              {phaseView.micro_artifacts.length === 0 &&
                phaseView.macro_checkpoints.length === 0 && (
                  <p className="py-2 text-sm text-muted-foreground">
                    No artifacts or checkpoints for this phase.
                  </p>
                )}
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>

      <Separator className="opacity-0" />

      {/* Complete checkpoint sheet */}
      <Sheet open={!!completeTarget} onOpenChange={(open) => !open && setCompleteTarget(null)}>
        {completeTarget && (
          <CompleteCheckpointSheet
            key={completeTarget.id}
            checkpoint={completeTarget}
            projectId={id}
            onClose={() => setCompleteTarget(null)}
          />
        )}
      </Sheet>

      {/* Evidence dialog */}
      <Dialog open={!!evidenceTarget} onOpenChange={(open) => !open && setEvidenceTarget(null)}>
        {evidenceTarget && (
          <EvidenceDialog
            key={evidenceTarget.id}
            checkpoint={evidenceTarget}
            projectId={id}
            onClose={() => setEvidenceTarget(null)}
          />
        )}
      </Dialog>
    </div>
  );
}

export default ProjectDetailPage;

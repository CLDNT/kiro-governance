import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ExternalLink, Hash, Link2, Loader2, Pencil } from 'lucide-react';

import { useAuth } from '@/contexts/AuthContext';
import { useUpdateProject, useProvisionSlack } from '@/hooks/useProjects';
import type { Project } from '@/types';
import {
  buildLinkagePayload,
  canManageLinkage,
  EMPTY_LINKAGE_VALUES,
  hasErrors,
  mapServerError,
  validateLinkageValues,
  type LinkageErrors,
  type LinkageField,
  type LinkageValues,
} from '@/lib/linkage';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LinkageFields } from './LinkageFields';

function toLinkageValues(project: Project): LinkageValues {
  return {
    github_repo: project.github_repo ?? '',
    github_url: project.github_url ?? '',
    slack_micro_channel_id: project.slack_micro_channel_id ?? '',
    slack_macro_channel_id: project.slack_macro_channel_id ?? '',
  };
}

/** Read-only row for a single non-secret linkage value. */
function LinkageRow({
  icon,
  label,
  children,
}: {
  icon: JSX.Element;
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-all text-sm font-medium text-foreground">{children}</dd>
      </div>
    </div>
  );
}

export interface ProjectLinkageCardProps {
  project: Project;
}

/**
 * "GitHub & Slack linkage" card on the project detail page.
 * Everyone with project access sees the (non-secret) current values, with github_url rendered
 * as a safe external link. Only admin/leadership get the edit dialog + Slack provisioning trigger
 * (projects-architecture §12.1/§12.4). No secret is ever rendered.
 */
export function ProjectLinkageCard({ project }: ProjectLinkageCardProps): JSX.Element {
  const { user } = useAuth();
  const canManage = canManageLinkage(user?.role);

  const [editOpen, setEditOpen] = useState(false);
  const [values, setValues] = useState<LinkageValues>(EMPTY_LINKAGE_VALUES);
  const [fieldErrors, setFieldErrors] = useState<LinkageErrors>({});
  const [formError, setFormError] = useState<string | null>(null);

  const original = useMemo(() => toLinkageValues(project), [project]);

  const updateProject = useUpdateProject(project.jira_key);
  const provisionSlack = useProvisionSlack(project.jira_key);

  const openEditor = (): void => {
    setValues(toLinkageValues(project));
    setFieldErrors({});
    setFormError(null);
    setEditOpen(true);
  };

  const handleChange = (field: LinkageField, value: string): void => {
    setValues((v) => ({ ...v, [field]: value }));
    // Clear the field error as the user edits it.
    setFieldErrors((e) => (e[field] ? { ...e, [field]: undefined } : e));
  };

  const handleSave = async (): Promise<void> => {
    setFormError(null);
    const clientErrors = validateLinkageValues(values);
    if (hasErrors(clientErrors)) {
      setFieldErrors(clientErrors);
      return;
    }

    const payload = buildLinkagePayload(values, 'edit', original);
    if (Object.keys(payload).length === 0) {
      setEditOpen(false);
      return;
    }

    try {
      await updateProject.mutateAsync(payload);
      toast.success('Project linkage updated');
      setEditOpen(false);
    } catch (err) {
      const mapped = mapServerError(err);
      setFieldErrors(mapped.fieldErrors);
      setFormError(mapped.formError);
    }
  };

  const handleProvision = async (): Promise<void> => {
    try {
      const result = await provisionSlack.mutateAsync();
      toast.success(
        `Slack channels ready — micro ${result.slack_micro_channel_id}, macro ${result.slack_macro_channel_id}`
      );
    } catch {
      // Global interceptor already surfaces a toast; nothing secret to show here.
    }
  };

  const hasAnyLinkage =
    project.github_repo ||
    project.github_url ||
    project.slack_micro_channel_id ||
    project.slack_macro_channel_id;

  const provisioned = provisionSlack.data;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle className="text-base">GitHub &amp; Slack linkage</CardTitle>
        {canManage && (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={openEditor}>
            <Pencil className="h-3.5 w-3.5" />
            Edit linkage
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-5">
        {hasAnyLinkage ? (
          <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <LinkageRow icon={<Link2 className="h-4 w-4" />} label="GitHub repo">
              {project.github_repo || '—'}
            </LinkageRow>
            <LinkageRow icon={<ExternalLink className="h-4 w-4" />} label="GitHub URL">
              {project.github_url ? (
                <a
                  href={project.github_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                >
                  {project.github_url}
                  <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                </a>
              ) : (
                '—'
              )}
            </LinkageRow>
            <LinkageRow icon={<Hash className="h-4 w-4" />} label="Slack micro-channel">
              {project.slack_micro_channel_id || '—'}
            </LinkageRow>
            <LinkageRow icon={<Hash className="h-4 w-4" />} label="Slack macro-channel">
              {project.slack_macro_channel_id || '—'}
            </LinkageRow>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">
            No GitHub or Slack linkage set. This project behaves as governance-unlinked.
            {canManage && ' Use “Edit linkage” to connect a repo and Slack channels.'}
          </p>
        )}

        {canManage && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button
                variant="secondary"
                size="sm"
                className="gap-1.5"
                onClick={handleProvision}
                disabled={provisionSlack.isPending}
              >
                {provisionSlack.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Hash className="h-3.5 w-3.5" />
                )}
                Provision Slack channels
              </Button>
              <span className="text-xs text-muted-foreground">
                Resolves or creates the micro + macro channels and stores their ids.
              </span>
            </div>
            {provisioned && (
              <Alert>
                <Hash className="h-4 w-4" aria-hidden="true" />
                <AlertTitle>Slack channels provisioned</AlertTitle>
                <AlertDescription className="space-y-0.5">
                  <p>
                    Micro:{' '}
                    <span className="font-mono">{provisioned.slack_micro_channel_id}</span>{' '}
                    {provisioned.provisioned.micro.created ? '(created)' : '(existing)'}
                  </p>
                  <p>
                    Macro:{' '}
                    <span className="font-mono">{provisioned.slack_macro_channel_id}</span>{' '}
                    {provisioned.provisioned.macro.created ? '(created)' : '(existing)'}
                  </p>
                </AlertDescription>
              </Alert>
            )}
          </div>
        )}
      </CardContent>

      {canManage && (
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Edit GitHub &amp; Slack linkage</DialogTitle>
              <DialogDescription>
                Connect this project to a GitHub repo and its Slack channels. Admin / leadership only.
              </DialogDescription>
            </DialogHeader>

            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <div className="py-1">
              <LinkageFields
                mode="edit"
                values={values}
                errors={fieldErrors}
                onChange={handleChange}
                originalRepo={project.github_repo}
                disabled={updateProject.isPending}
              />
            </div>

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setEditOpen(false)}
                disabled={updateProject.isPending}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={updateProject.isPending}>
                {updateProject.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Save linkage
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </Card>
  );
}

export default ProjectLinkageCard;

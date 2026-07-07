import { AlertTriangle, ExternalLink, ShieldAlert } from 'lucide-react';

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  GITHUB_URL_RE,
  isRepoRepointOrClear,
  type LinkageErrors,
  type LinkageField,
  type LinkageValues,
} from '@/lib/linkage';

interface FieldSpec {
  name: LinkageField;
  label: string;
  placeholder: string;
  help: string;
}

const FIELD_SPECS: FieldSpec[] = [
  {
    name: 'github_repo',
    label: 'GitHub repo',
    placeholder: 'my-service-repo',
    help: 'Repo name only — 1–100 chars: letters, numbers, dot, underscore, hyphen. Turns on governance surfacing for this project.',
  },
  {
    name: 'github_url',
    label: 'GitHub URL',
    placeholder: 'https://github.com/org/my-service-repo',
    help: 'Must be an https://github.com/… URL.',
  },
  {
    name: 'slack_micro_channel_id',
    label: 'Slack micro-channel id',
    placeholder: 'C0123ABCD',
    help: 'Non-secret channel id. Never paste a bot token or webhook URL.',
  },
  {
    name: 'slack_macro_channel_id',
    label: 'Slack macro-channel id',
    placeholder: 'C0456WXYZ',
    help: 'Non-secret channel id. Never paste a bot token or webhook URL.',
  },
];

export interface LinkageFieldsProps {
  values: LinkageValues;
  errors: LinkageErrors;
  onChange: (field: LinkageField, value: string) => void;
  mode: 'create' | 'edit';
  /** Original repo (edit mode only) — drives the FR-P2-040 re-point/clear warning. */
  originalRepo?: string | null;
  disabled?: boolean;
}

/**
 * Admin/leadership-only GitHub↔Slack linkage inputs (projects-architecture §12.1/§12.2).
 * The caller is responsible for role-gating whether this component renders at all; when
 * `disabled` is passed the fields render read-only. No field here is ever a secret —
 * the Slack bot token lives only in SSM and is never accepted or displayed.
 */
export function LinkageFields({
  values,
  errors,
  onChange,
  mode,
  originalRepo,
  disabled = false,
}: LinkageFieldsProps): JSX.Element {
  const showRepoWarning =
    mode === 'edit' && isRepoRepointOrClear(originalRepo, values.github_repo);
  const githubUrlValid = Boolean(values.github_url) && GITHUB_URL_RE.test(values.github_url.trim());

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p>
          Admin / leadership only. These are <strong>non-secret</strong> identifiers. Never paste a
          Slack bot token or webhook URL here — the workspace token is stored server-side only.
        </p>
      </div>

      {FIELD_SPECS.map((spec) => {
        const error = errors[spec.name];
        const errorId = `${spec.name}-error`;
        const helpId = `${spec.name}-help`;
        return (
          <div key={spec.name} className="space-y-1.5">
            <Label htmlFor={spec.name}>{spec.label}</Label>
            <Input
              id={spec.name}
              name={spec.name}
              value={values[spec.name]}
              placeholder={spec.placeholder}
              disabled={disabled}
              autoComplete="off"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? `${errorId} ${helpId}` : helpId}
              onChange={(e) => onChange(spec.name, e.target.value)}
            />
            {spec.name === 'github_url' && githubUrlValid && (
              <a
                href={values.github_url.trim()}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline"
              >
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                Open repository
              </a>
            )}
            <p id={helpId} className="text-xs text-muted-foreground">
              {spec.help}
            </p>
            {error && (
              <p id={errorId} role="alert" className="text-xs font-medium text-destructive">
                {error}
              </p>
            )}
          </div>
        );
      })}

      {showRepoWarning && (
        <Alert variant="destructive" className="border-amber-500/50 text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-4 w-4" aria-hidden="true" />
          <AlertTitle>Historical-event visibility will change</AlertTitle>
          <AlertDescription>
            {values.github_repo.trim() === ''
              ? 'Clearing the GitHub repo stops previously-recorded governance events from surfacing on this project’s timeline. Re-linking the same repo later restores them.'
              : 'Re-pointing to a different GitHub repo hides events recorded under the previous repo from this project’s timeline. Pointing back to the original repo restores visibility.'}
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

export default LinkageFields;

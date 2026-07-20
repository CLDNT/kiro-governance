/**
 * GitHub / Slack project-linkage helpers (CR-15).
 *
 * Pure, framework-free logic shared by the create and edit forms:
 *  - client-side validation that MIRRORS the server contract
 *    (create-project.ts / update-project.ts, projects-architecture §12.2)
 *  - role gating (admin / leadership only, §12.1)
 *  - mapping of server 400 / 409 / 422 / 403 responses to inline field/form errors
 *
 * SECURITY: none of these fields is a secret. The Slack workspace bot token / webhook
 * URL is stored only in SSM and is never accepted, rendered, or logged by the frontend.
 */

import { AxiosError } from 'axios';

// Mirrors the server regexes exactly (projects-architecture §12.2, create/update handlers).
export const GITHUB_REPO_RE = /^[A-Za-z0-9._-]{1,100}$/;
export const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9._/-]{1,200}$/;
export const SLACK_CHANNEL_RE = /^[A-Za-z0-9]{1,64}$/; // non-secret channel id shape (e.g. C0123ABCD)

export type Role = 'pm' | 'sa' | 'engineer' | 'leadership' | 'admin';

/** The four audited linkage fields, in a stable order for iteration. */
export const LINKAGE_FIELDS = [
  'github_repo',
  'github_url',
  'slack_micro_channel_id',
  'slack_macro_channel_id',
] as const;

export type LinkageField = (typeof LINKAGE_FIELDS)[number];

export type LinkageValues = Record<LinkageField, string>;
export type LinkageErrors = Partial<Record<LinkageField, string>>;

/** Empty (all-blank) linkage form state. */
export const EMPTY_LINKAGE_VALUES: LinkageValues = {
  github_repo: '',
  github_url: '',
  slack_micro_channel_id: '',
  slack_macro_channel_id: '',
};

/**
 * §12.1 authorization mirror: only admin / leadership may view/edit linkage fields.
 * This is a UX gate only — the backend re-enforces it on the Cognito group claim.
 */
export function canManageLinkage(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'leadership';
}

/**
 * CR-16 authorization mirror: only admin / leadership may trigger the repo → macro-gate sync
 * (POST /api/projects/{projectId}/sync-gates). sync-gates is part of the projects-linkage function
 * group and reads the linked GitHub repo. This is a UX gate only — the handler re-enforces
 * admin/leadership on the Cognito group claim (returns 403 FORBIDDEN otherwise). Distinct from the
 * Level-2 artifact-auto permission (canManageArtifactAuto) even though both resolve to the same
 * roles today, so the two controls stay independently governable.
 */
export function canManageGateSync(role: Role | null | undefined): boolean {
  return role === 'admin' || role === 'leadership';
}

export function isLinkageField(value: string): value is LinkageField {
  return (LINKAGE_FIELDS as readonly string[]).includes(value);
}

export function validateGithubRepo(value: string): string | undefined {
  if (!value) return undefined; // optional
  if (!GITHUB_REPO_RE.test(value)) {
    return 'Use 1–100 characters: letters, numbers, dot, underscore or hyphen only.';
  }
  return undefined;
}

export function validateGithubUrl(value: string): string | undefined {
  if (!value) return undefined; // optional
  if (!GITHUB_URL_RE.test(value)) {
    return 'Must be an https://github.com/… URL (https and github.com only).';
  }
  return undefined;
}

export function validateSlackChannelId(value: string): string | undefined {
  if (!value) return undefined; // optional
  if (!SLACK_CHANNEL_RE.test(value)) {
    return 'Enter a non-secret channel id (letters/numbers, e.g. C0123ABCD). Never paste a token or webhook.';
  }
  return undefined;
}

/** Validate all four linkage fields. Returns a map of field → error message. */
export function validateLinkageValues(values: LinkageValues): LinkageErrors {
  const errors: LinkageErrors = {};
  const repo = validateGithubRepo(values.github_repo);
  if (repo) errors.github_repo = repo;
  const url = validateGithubUrl(values.github_url);
  if (url) errors.github_url = url;
  const micro = validateSlackChannelId(values.slack_micro_channel_id);
  if (micro) errors.slack_micro_channel_id = micro;
  const macro = validateSlackChannelId(values.slack_macro_channel_id);
  if (macro) errors.slack_macro_channel_id = macro;
  return errors;
}

export function hasErrors(errors: LinkageErrors): boolean {
  return LINKAGE_FIELDS.some((f) => Boolean(errors[f]));
}

/**
 * Build the linkage slice of a create/edit payload.
 *  - `create`: only include a field when it has a value (server treats absence as "not set").
 *  - `edit`:   include a field only when it changed vs the original, sending `null` to clear it
 *              (mirrors the nullable clear/re-point contract, §12.5).
 */
export function buildLinkagePayload(
  values: LinkageValues,
  mode: 'create' | 'edit',
  original?: LinkageValues,
): Partial<Record<LinkageField, string | null>> {
  const payload: Partial<Record<LinkageField, string | null>> = {};
  for (const field of LINKAGE_FIELDS) {
    const next = values[field].trim();
    if (mode === 'create') {
      if (next) payload[field] = next;
    } else {
      const prev = (original?.[field] ?? '').trim();
      if (next !== prev) payload[field] = next === '' ? null : next;
    }
  }
  return payload;
}

/**
 * True when github_repo is being cleared or re-pointed to a different repo (edit only).
 * Drives the FR-P2-040 historical-event visibility warning.
 */
export function isRepoRepointOrClear(originalRepo: string | null | undefined, nextRepo: string): boolean {
  const prev = (originalRepo ?? '').trim();
  const next = nextRepo.trim();
  return prev !== '' && next !== prev;
}

interface ServerErrorBody {
  code?: string;
  message?: string;
  details?: unknown;
}

export interface MappedServerError {
  fieldErrors: LinkageErrors;
  formError: string | null;
}

/**
 * Map a rejected linkage request to inline field errors + a form-level message.
 * Handles the CR-02 error contract: 400 VALIDATION_ERROR (details keyed by field),
 * 409 DUPLICATE_GITHUB_REPO, 422 IMMUTABLE_FIELD, 403 FORBIDDEN.
 */
export function mapServerError(err: unknown): MappedServerError {
  const fieldErrors: LinkageErrors = {};
  let formError: string | null = null;

  const axiosErr = err as AxiosError<ServerErrorBody>;
  const status = axiosErr?.response?.status;
  const body = axiosErr?.response?.data;
  const code = body?.code;

  switch (code) {
    case 'VALIDATION_ERROR': {
      // details is Record<field, string[]> from zodToValidationError.
      const details = body?.details;
      if (details && typeof details === 'object') {
        for (const [key, messages] of Object.entries(details as Record<string, unknown>)) {
          if (isLinkageField(key)) {
            const msg = Array.isArray(messages) ? String(messages[0]) : String(messages);
            fieldErrors[key] = msg;
          }
        }
      }
      if (!hasErrors(fieldErrors)) {
        formError = body?.message ?? 'Validation failed. Check the highlighted fields.';
      }
      break;
    }
    case 'DUPLICATE_GITHUB_REPO':
      fieldErrors.github_repo =
        'This GitHub repo is already linked to another project (or collides with a project key).';
      break;
    case 'IMMUTABLE_FIELD': {
      const field =
        body?.details && typeof body.details === 'object'
          ? (body.details as { field?: string }).field
          : undefined;
      formError = field
        ? `${field} cannot be changed after creation.`
        : (body?.message ?? 'This field cannot be changed after creation.');
      break;
    }
    case 'FORBIDDEN':
      formError = body?.message ?? 'Only admin or leadership may change project linkage.';
      break;
    default:
      // Fall back on HTTP status when the body has no recognised code.
      if (status === 409) {
        fieldErrors.github_repo = 'This GitHub repo is already linked to another project.';
      } else {
        formError = body?.message ?? 'Something went wrong. Please try again.';
      }
  }

  return { fieldErrors, formError };
}

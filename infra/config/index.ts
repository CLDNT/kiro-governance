/**
 * Per-environment infrastructure configuration.
 *
 * Non-secret, environment-specific values consumed by the CDK stacks live here so stack code never
 * hardcodes org-/env-specific literals. Secrets are NOT stored here — they are read at runtime from
 * SSM / Secrets Manager (see stateless-stack SsmSecretGrant).
 */
export interface EnvConfig {
  /**
   * CR-16: approved GitHub org owner. Used as the fallback owner when a project's `github_url` has
   * none, and as the seed for the H1 owner allowlist. Injected as `GITHUB_DEFAULT_OWNER` on the
   * projects-linkage Lambdas (create / update / sync-gates). Public org name — not a secret.
   */
  readonly githubDefaultOwner: string;

  /**
   * CR-16 H1: comma-separated approved GitHub owners (fail-closed allowlist). Injected as
   * `GITHUB_ALLOWED_OWNERS` on the projects-linkage Lambdas. Strongly recommended in every env when
   * a broad PAT is used for the read-token (see packages/projects/README.md §CR16-H1).
   */
  readonly githubAllowedOwners: string;
}

import { devConfig } from './dev';
import { prodConfig } from './prod';

/** Resolve the infra config for the given deployment environment. */
export const getEnvConfig = (environment: 'dev' | 'prod'): EnvConfig =>
  environment === 'prod' ? prodConfig : devConfig;

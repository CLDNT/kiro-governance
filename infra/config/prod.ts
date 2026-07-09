import type { EnvConfig } from './index';

/**
 * Prod environment configuration.
 *
 * `githubDefaultOwner` is this repository's own GitHub org (`CODEZAX-CE`) — it owns the majority of
 * linked repos plus the e2e fixtures, and is the URL fallback owner. `githubAllowedOwners` is the
 * CR16-H1 fail-closed allowlist (comma-separated, matched case-insensitively): both `CODEZAX-CE`
 * (tooling repos, this repo, e2e fixtures) and `CLDNT` (client repos) are approved owners. These
 * are public org names, not secrets. Change owners here; never hardcode them in a stack.
 */
export const prodConfig: EnvConfig = {
  githubDefaultOwner: 'CODEZAX-CE',
  githubAllowedOwners: 'CODEZAX-CE,CLDNT',
};

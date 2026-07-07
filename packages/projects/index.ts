/**
 * Projects domain exports.
 * Centralizes all handlers, services, and types.
 */

// Handlers
export { handler as listProjectsHandler } from './handlers/list-projects';
export { handler as getProjectHandler } from './handlers/get-project';
export { handler as createProjectHandler } from './handlers/create-project';
export { handler as updateProjectHandler } from './handlers/update-project';
export { handler as importJiraHandler } from './handlers/import-jira';
export { handler as updateHoursHandler } from './handlers/update-hours';
export { handler as listChecklistHandler } from './handlers/list-checklist';
export { handler as updateChecklistItemHandler } from './handlers/update-checklist-item';
export { handler as provisionSlackChannelsHandler } from './handlers/provision-slack-channels';
export { handler as syncGatesHandler } from './handlers/sync-gates';

// Services
export { seedCasdmTemplate, generateProjectKey, ONBOARDING_CHECKLIST_ITEMS } from './services/seed.service';
export {
  getProvisioningToken,
  resolveOrCreateChannel,
  microChannelName,
  macroChannelName,
  PROVISIONING_TOKEN_SSM_PATH,
  SlackProvisioningError,
} from './services/slack-provisioning.service';
export {
  getGithubReadToken,
  fetchProgressFile,
  resolveOwner,
  isOwnerAllowed,
  isOwnerAllowlistConfigured,
  GITHUB_READ_TOKEN_SSM_PATH,
  GithubFetchError,
} from './services/github.service';
export type { ProgressFileResult } from './services/github.service';
export { syncGatesFromRepo, triggerLinkTimeSync, REPO_SYNC_ACTOR } from './services/gate-sync.service';
export type { SyncGatesSummary } from './services/gate-sync.service';
export { parseResolvedGates } from './services/progress-tracker.parser';

// Types
export type {
  Project,
  ProjectDetail,
  CreateProjectInput,
  UpdateProjectInput,
  ProjectSummary,
  ProjectListResponse,
  OnboardingChecklistItem,
  ChecklistResponse,
  UpdateChecklistInput,
  UpdateHoursInput,
  UpdateHoursResponse,
  ImportJiraInput,
  ImportJiraResponse,
  CreateProjectResponse,
  ProvisionSlackChannelsResponse,
  ProvisionedChannel,
  SyncGatesResponse,
} from './types';

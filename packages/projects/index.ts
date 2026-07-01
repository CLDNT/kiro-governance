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

// Services
export { seedCasdmTemplate, generateProjectKey, ONBOARDING_CHECKLIST_ITEMS } from './services/seed.service';

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
} from './types';

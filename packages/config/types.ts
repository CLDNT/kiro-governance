/**
 * Config domain types — CASDM templates and analysis prompts
 * Source: docs/phase2/config-architecture.md §7
 */

// Enums matching database constraints
export const PROJECT_TYPES = ['AppDev', 'AppMod', 'AIML', 'default'] as const;
export type ProjectType = typeof PROJECT_TYPES[number];

export const CONFIG_TYPES = ['phase', 'micro_artifact', 'macro_checkpoint'] as const;
export type ConfigType = typeof CONFIG_TYPES[number];

export const CHECKPOINT_TYPES = ['human_review', 'meeting', 'transcript_analysis', 'checklist'] as const;
export type CheckpointType = typeof CHECKPOINT_TYPES[number];

// ===== Models =====

export interface CasdmConfigItem {
  id: number;
  config_type: ConfigType;
  phase: string;
  phase_name: string;
  phase_order: number;
  item_name: string | null;
  item_order: number | null;
  item_type: CheckpointType | null;
  is_mandatory: boolean;
  is_active: boolean;
  project_type: string;
  changed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface AnalysisPrompt {
  id: number;
  checkpoint_name: string;
  prompt_text: string;
  updated_by: string | null;
  updated_at: string;
  created_at: string;
}

// ===== Request/Response Types =====

export interface CreateConfigItemInput {
  config_type: ConfigType;
  phase: string;
  phase_name: string;
  phase_order: number;
  item_name?: string;
  item_order?: number;
  item_type?: CheckpointType;
  is_mandatory?: boolean;
}

export interface UpdateConfigItemInput {
  item_name?: string;
  phase_name?: string;
  item_order?: number;
  phase_order?: number;
  is_active?: boolean;
  is_mandatory?: boolean;
}

export interface UpdatePromptInput {
  prompt_text: string;
}

export interface CopyTemplateInput {
  source_project_type: string;
  target_project_type: string;
}

// ===== Response Models =====

export interface TemplateListResponse {
  templates: TemplateTypeSummary[];
}

export interface TemplateTypeSummary {
  project_type: string;
  phase_count: number;
  micro_artifact_count: number;
  macro_checkpoint_count: number;
  last_updated: string;
}

export interface TemplateResponse {
  project_type: string;
  phases: TemplatePhase[];
}

export interface TemplatePhase {
  phase: string;
  phase_name: string;
  phase_order: number;
  micro_artifacts: TemplateItem[];
  macro_checkpoints: TemplateItem[];
}

export interface TemplateItem {
  id: number;
  item_name: string;
  item_order: number;
  item_type: string | null;
  is_mandatory: boolean;
  is_active: boolean;
}

export interface PromptListResponse {
  prompts: AnalysisPrompt[];
}

export interface ListProjectTypesResponse {
  project_types: string[];
}

export interface CopyTemplateResponse {
  rows_copied: number;
  target_project_type: string;
}

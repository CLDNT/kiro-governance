import { CasdmConfigItem, AnalysisPrompt, CreateConfigItemInput, UpdateConfigItemInput, UpdatePromptInput, CopyTemplateInput, TemplateTypeSummary } from './types';
/**
 * Get configuration template for a specific project type
 * Falls back to 'default' if project type has no rows
 */
export declare function getTemplate(projectType: string): Promise<CasdmConfigItem[]>;
/**
 * List all project types with their template statistics
 */
export declare function listTemplates(): Promise<TemplateTypeSummary[]>;
/**
 * Create a new config item (phase, artifact, or checkpoint)
 */
export declare function createConfigItem(projectType: string, input: CreateConfigItemInput, actor: string): Promise<CasdmConfigItem>;
/**
 * Update a config item (rename, reorder, toggle active)
 */
export declare function updateConfigItem(projectType: string, id: number, input: UpdateConfigItemInput, actor: string): Promise<CasdmConfigItem>;
/**
 * List all analysis prompts
 */
export declare function listPrompts(): Promise<AnalysisPrompt[]>;
/**
 * Update an analysis prompt (upsert)
 * Uses INSERT ON CONFLICT DO UPDATE
 */
export declare function updatePrompt(checkpointName: string, input: UpdatePromptInput, actor: string): Promise<AnalysisPrompt>;
/**
 * Get list of all distinct project types
 */
export declare function listProjectTypes(): Promise<string[]>;
/**
 * Copy all casdm_config rows from source to target project type
 * Returns 409 if target already has rows
 */
export declare function copyTemplate(input: CopyTemplateInput, actor: string): Promise<number>;

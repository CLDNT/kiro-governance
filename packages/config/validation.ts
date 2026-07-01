/**
 * Config domain Zod schemas for request validation
 */
import { z } from 'zod';

export const CreateConfigItemSchema = z.object({
  config_type: z.enum(['phase', 'micro_artifact', 'macro_checkpoint']),
  phase: z.string().min(1).max(50),
  phase_name: z.string().min(1).max(200),
  phase_order: z.number().int().min(0),
  item_name: z.string().min(1).max(200).optional(),
  item_order: z.number().int().min(1).optional(),
  item_type: z.enum(['human_review', 'meeting', 'transcript_analysis', 'checklist']).optional(),
  is_mandatory: z.boolean().optional(),
});

export const UpdateConfigItemSchema = z.object({
  item_name: z.string().min(1).max(200).optional(),
  phase_name: z.string().min(1).max(200).optional(),
  item_order: z.number().int().min(1).optional(),
  phase_order: z.number().int().min(0).optional(),
  is_active: z.boolean().optional(),
  is_mandatory: z.boolean().optional(),
});

export const UpdatePromptSchema = z.object({
  prompt_text: z.string().min(1).max(10000),
});

export const CopyTemplateSchema = z.object({
  source_project_type: z.string().min(1).max(50),
  target_project_type: z.string().min(1).max(50),
});

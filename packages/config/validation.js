"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CopyTemplateSchema = exports.UpdatePromptSchema = exports.UpdateConfigItemSchema = exports.CreateConfigItemSchema = void 0;
/**
 * Config domain Zod schemas for request validation
 */
const zod_1 = require("zod");
exports.CreateConfigItemSchema = zod_1.z.object({
    config_type: zod_1.z.enum(['phase', 'micro_artifact', 'macro_checkpoint']),
    phase: zod_1.z.string().min(1).max(50),
    phase_name: zod_1.z.string().min(1).max(200),
    phase_order: zod_1.z.number().int().min(0),
    item_name: zod_1.z.string().min(1).max(200).optional(),
    item_order: zod_1.z.number().int().min(1).optional(),
    item_type: zod_1.z.enum(['human_review', 'meeting', 'transcript_analysis', 'checklist']).optional(),
    is_mandatory: zod_1.z.boolean().optional(),
});
exports.UpdateConfigItemSchema = zod_1.z.object({
    item_name: zod_1.z.string().min(1).max(200).optional(),
    phase_name: zod_1.z.string().min(1).max(200).optional(),
    item_order: zod_1.z.number().int().min(1).optional(),
    phase_order: zod_1.z.number().int().min(0).optional(),
    is_active: zod_1.z.boolean().optional(),
    is_mandatory: zod_1.z.boolean().optional(),
});
exports.UpdatePromptSchema = zod_1.z.object({
    prompt_text: zod_1.z.string().min(1).max(10000),
});
exports.CopyTemplateSchema = zod_1.z.object({
    source_project_type: zod_1.z.string().min(1).max(50),
    target_project_type: zod_1.z.string().min(1).max(50),
});

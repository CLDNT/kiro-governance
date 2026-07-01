/**
 * Config domain Zod schemas for request validation
 */
import { z } from 'zod';
export declare const CreateConfigItemSchema: z.ZodObject<{
    config_type: z.ZodEnum<["phase", "micro_artifact", "macro_checkpoint"]>;
    phase: z.ZodString;
    phase_name: z.ZodString;
    phase_order: z.ZodNumber;
    item_name: z.ZodOptional<z.ZodString>;
    item_order: z.ZodOptional<z.ZodNumber>;
    item_type: z.ZodOptional<z.ZodEnum<["human_review", "meeting", "transcript_analysis", "checklist"]>>;
    is_mandatory: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    phase: string;
    config_type: "phase" | "micro_artifact" | "macro_checkpoint";
    phase_name: string;
    phase_order: number;
    item_name?: string | undefined;
    item_order?: number | undefined;
    item_type?: "human_review" | "meeting" | "transcript_analysis" | "checklist" | undefined;
    is_mandatory?: boolean | undefined;
}, {
    phase: string;
    config_type: "phase" | "micro_artifact" | "macro_checkpoint";
    phase_name: string;
    phase_order: number;
    item_name?: string | undefined;
    item_order?: number | undefined;
    item_type?: "human_review" | "meeting" | "transcript_analysis" | "checklist" | undefined;
    is_mandatory?: boolean | undefined;
}>;
export declare const UpdateConfigItemSchema: z.ZodObject<{
    item_name: z.ZodOptional<z.ZodString>;
    phase_name: z.ZodOptional<z.ZodString>;
    item_order: z.ZodOptional<z.ZodNumber>;
    phase_order: z.ZodOptional<z.ZodNumber>;
    is_active: z.ZodOptional<z.ZodBoolean>;
    is_mandatory: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    phase_name?: string | undefined;
    phase_order?: number | undefined;
    item_name?: string | undefined;
    item_order?: number | undefined;
    is_mandatory?: boolean | undefined;
    is_active?: boolean | undefined;
}, {
    phase_name?: string | undefined;
    phase_order?: number | undefined;
    item_name?: string | undefined;
    item_order?: number | undefined;
    is_mandatory?: boolean | undefined;
    is_active?: boolean | undefined;
}>;
export declare const UpdatePromptSchema: z.ZodObject<{
    prompt_text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    prompt_text: string;
}, {
    prompt_text: string;
}>;
export declare const CopyTemplateSchema: z.ZodObject<{
    source_project_type: z.ZodString;
    target_project_type: z.ZodString;
}, "strip", z.ZodTypeAny, {
    source_project_type: string;
    target_project_type: string;
}, {
    source_project_type: string;
    target_project_type: string;
}>;

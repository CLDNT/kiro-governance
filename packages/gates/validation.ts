import { z } from 'zod';

export const UpdateCheckpointInputSchema = z.object({
  occurred: z.boolean().optional(),
  meeting_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  meeting_link: z.string().url().optional(),
  reviewed_by: z.string().min(1).max(255).optional(),
  result_detail: z.string().max(4000).optional(),
});

export const UpdateArtifactInputSchema = z.object({
  status: z.enum(['pending', 'in_progress', 'complete']),
  // CR-12: admin/leadership-only re-enable of Kiro auto-sync (clears manual_override). Authz is
  // enforced in the handler; the schema only allows the field through.
  reset_to_auto: z.boolean().optional(),
});

export const AttachEvidenceInputSchema = z.object({
  evidence_type: z.enum(['meeting_link', 'url', 'file_upload', 'ai_analysis']),
  label: z.string().max(255).optional(),
  value: z.string().min(1).max(4000),
  link_metadata: z.object({
    title: z.string().max(500).optional(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    duration_minutes: z.number().nullable().optional(),
  }).optional(),
});

export const AddNoteInputSchema = z.object({
  note_text: z.string().min(1).max(4000),
});

export const TimelineQuerySchema = z.object({
  limit: z.number().int().min(1).max(200).default(50),
  cursor: z.string().optional(),
});

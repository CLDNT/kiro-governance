import { z } from 'zod';

export const TranscriptAnalysisResultSchema = z.object({
  topics_covered: z.array(z.string()),
  topics_missing: z.array(z.string()),
  key_points: z.array(z.string()),
  disagreements: z.array(z.string()),
  passed: z.boolean(),
  confidence: z.number().min(0).max(1),
});

export const LinkMetadataSchema = z.object({
  meeting_title: z.string().optional(),
  meeting_date: z.string().optional(),
  duration_minutes: z.number().optional(),
  participants: z.array(z.string()).optional(),
});

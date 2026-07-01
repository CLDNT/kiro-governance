import { z } from 'zod';

export const CreateStatusLogInputSchema = z.object({
  log_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  meeting_link: z.string().url().optional(),
  topics_covered: z.string().min(1).max(4000),
  demo_items: z.string().max(2000).optional(),
  blockers: z.string().max(2000).optional(),
}).refine(
  (data) => new Date(data.log_date) <= new Date(),
  { message: 'Date cannot be in the future', path: ['log_date'] },
);

export const CreateEscalationInputSchema = z.object({
  raised_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  description: z.string().min(1).max(2000),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  raised_by: z.string().min(1).max(200),
});

export const ResolveEscalationInputSchema = z.object({
  resolved_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  resolution_notes: z.string().max(2000).optional(),
});

export const CreateDiscoverySessionInputSchema = z.object({
  session_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD'),
  meeting_link: z.string().url().optional(),
  participants: z.string().min(1).max(1000),
  notes: z.string().max(4000).optional(),
});

export const ListStatusLogsQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const ListEscalationsQuerySchema = z.object({
  status: z.enum(['open', 'resolved']).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  limit: z.number().int().min(1).max(100).default(20),
  cursor: z.string().optional(),
});

export const ListDiscoverySessionsQuerySchema = z.object({
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().optional(),
});

import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { ReportingSummaryResponse } from '@/types';

export function useReportingSummary() {
  const client = useApiClient();

  return useQuery({
    queryKey: ['reporting-summary'],
    queryFn: async () => {
      const response = await client.get<ReportingSummaryResponse>('/api/reporting/summary');
      return response;
    },
  });
}

export function useProjectTimeline(projectId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['reporting-timeline', projectId],
    queryFn: async () => {
      const response = await client.get(`/api/reporting/projects/${projectId}/timeline`);
      return response;
    },
    enabled: !!projectId,
  });
}

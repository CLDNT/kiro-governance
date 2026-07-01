import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { Escalation, DiscoverySession } from '@/types';

export function useEscalations(projectId: string, statusFilter?: 'open' | 'resolved') {
  const client = useApiClient();

  return useQuery({
    queryKey: ['escalations', projectId, statusFilter],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (statusFilter) params.append('status', statusFilter);
      const response = await client.get<{ escalations: Escalation[] }>(
        `/api/projects/${projectId}/escalations?${params.toString()}`
      );
      return response.data.escalations;
    },
    enabled: !!projectId,
  });
}

export function useDiscoverySessions(projectId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['discovery-sessions', projectId],
    queryFn: async () => {
      const response = await client.get<{ sessions: DiscoverySession[] }>(
        `/api/projects/${projectId}/discovery-sessions`
      );
      return response.data.sessions;
    },
    enabled: !!projectId,
  });
}

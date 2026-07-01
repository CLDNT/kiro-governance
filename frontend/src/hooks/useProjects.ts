import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { ProjectListResponse, ChecklistResponse } from '@/types';

export function useProjects(filters: {
  status?: string;
  phase?: string;
  search?: string;
  limit?: number;
  cursor?: string;
}) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['projects', filters],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters.status) params.append('status', filters.status);
      if (filters.phase) params.append('phase', filters.phase);
      if (filters.search) params.append('search', filters.search);
      if (filters.limit) params.append('limit', filters.limit.toString());
      if (filters.cursor) params.append('cursor', filters.cursor);

      const response = await client.get<ProjectListResponse>(`/api/projects?${params.toString()}`);
      return response.data;
    },
  });
}

export function useProject(projectId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await client.get(`/api/projects/${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });
}

export function useProjectChecklist(projectId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['checklist', projectId],
    queryFn: async () => {
      const response = await client.get<ChecklistResponse>(`/api/projects/${projectId}/checklist`);
      return response.data;
    },
    enabled: !!projectId,
  });
}

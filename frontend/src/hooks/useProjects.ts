import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import {
  ProjectListResponse,
  ChecklistResponse,
  CreateProjectInput,
  UpdateProjectInput,
  Project,
  ProvisionSlackChannelsResponse,
} from '@/types';

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

export function useCreateProject() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: CreateProjectInput) => {
      const response = await client.post('/api/projects', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

/**
 * PATCH /api/projects/{projectId} — metadata + linkage edits.
 * Linkage fields (github_repo/github_url/slack_*_channel_id) are admin/leadership-only;
 * the server re-enforces this on the Cognito group claim (projects-architecture §12.1).
 */
export function useUpdateProject(projectId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: UpdateProjectInput) => {
      const response = await client.patch<Project>(`/api/projects/${projectId}`, data);
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
      void queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

/**
 * POST /api/projects/{projectId}/slack/provision — resolve/create the micro + macro
 * Slack channels (CR-05, FR-P2-039) and persist the returned non-secret channel ids.
 * The workspace bot token never crosses this boundary — response carries channel ids only.
 */
export function useProvisionSlack(projectId: string) {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const response = await client.post<ProvisionSlackChannelsResponse>(
        `/api/projects/${projectId}/slack/provision`
      );
      return response.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['project', projectId] });
    },
  });
}

export function useImportJira() {
  const client = useApiClient();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (data: { jira_base_url: string; project_key: string }) => {
      const response = await client.post('/api/projects/import-jira', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    },
  });
}

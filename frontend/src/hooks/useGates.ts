import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import { GateStatusResponse, TimelineResponse, GateNote } from '@/types';

export function useGates(projectId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['gates', projectId],
    queryFn: async () => {
      const response = await client.get<GateStatusResponse>(`/api/projects/${projectId}/gates`);
      return response.data;
    },
    enabled: !!projectId,
  });
}

export function useProjectTimeline(projectId: string) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['timeline', projectId],
    queryFn: async () => {
      const response = await client.get<TimelineResponse>(`/api/projects/${projectId}/timeline`);
      return response.data;
    },
    enabled: !!projectId,
  });
}

export function useCheckpointNotes(projectId: string, checkpointId: number) {
  const client = useApiClient();

  return useQuery({
    queryKey: ['checkpoint-notes', projectId, checkpointId],
    queryFn: async () => {
      const response = await client.get<{ notes: GateNote[] }>(
        `/api/projects/${projectId}/checkpoints/${checkpointId}/notes`
      );
      return response.data.notes;
    },
    enabled: !!projectId && !!checkpointId,
  });
}

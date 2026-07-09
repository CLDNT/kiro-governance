import { useQuery } from '@tanstack/react-query';
import { useApiClient } from '@/lib/api';
import type { UserSummary, UsersListResponse } from '@/types';

/**
 * Fetches the directory of users used for reviewer selection.
 *
 * Best-effort by design: the only consumer (ReviewerCombobox) degrades to a free-text
 * field when this query fails or returns nothing, so we disable retries and suppress the
 * global error toast (`_suppressErrorToast`) — a missing/unavailable directory must never
 * block a reviewer from being recorded.
 */
export function useUsers() {
  const client = useApiClient();

  return useQuery<UserSummary[]>({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await client.get<UsersListResponse>('/api/users', {
        _suppressErrorToast: true,
      });
      return response.data.users ?? [];
    },
    retry: false,
    staleTime: 5 * 60 * 1000,
  });
}

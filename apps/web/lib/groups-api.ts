import { tenantApi } from './api';

/** Mirrors GroupsController's own local response shape — memberUserIds is absent unless the caller is an admin or an actual member (apps/api/src/groups/groups.controller.ts's toSummary()). */
export type GroupSummary = { id: string; name: string; memberUserIds?: string[] };

export const groupsApi = {
  list: () => tenantApi.get<GroupSummary[]>('/groups'),
  detail: (id: string) => tenantApi.get<GroupSummary>(`/groups/${id}`),
  create: (name: string) => tenantApi.post<GroupSummary>('/groups', { name }),
  updateMembers: (id: string, changes: { add?: string[]; remove?: string[] }) =>
    tenantApi.patch<GroupSummary>(`/groups/${id}/members`, changes),
  remove: (id: string) => tenantApi.del<{ deleted: true }>(`/groups/${id}`),
};

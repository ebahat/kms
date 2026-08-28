import { tenantApi } from './api';

/** Caps whatever tier a folder grants this group — never widens it (user-management plan, 2026-08-24). */
export type GroupMemberRole = 'viewer' | 'editor' | 'manager';

export type GroupMember = { userId: string; role: GroupMemberRole };

/** Mirrors GroupsController's own local response shape — members is absent unless the caller is an admin or an actual member (apps/api/src/groups/groups.controller.ts's toSummary()). */
export type GroupSummary = { id: string; name: string; members?: GroupMember[] };

export const groupsApi = {
  list: () => tenantApi.get<GroupSummary[]>('/groups'),
  detail: (id: string) => tenantApi.get<GroupSummary>(`/groups/${id}`),
  create: (name: string) => tenantApi.post<GroupSummary>('/groups', { name }),
  rename: (id: string, name: string) => tenantApi.patch<GroupSummary>(`/groups/${id}`, { name }),
  updateMembers: (id: string, changes: { add?: GroupMember[]; remove?: string[] }) =>
    tenantApi.patch<GroupSummary>(`/groups/${id}/members`, changes),
  remove: (id: string) => tenantApi.del<{ deleted: true }>(`/groups/${id}`),
};

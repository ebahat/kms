import { tenantApi, toQuery } from './api';
import type { CreateUserResult, CsvImportRowResult, UserGroupAssignment, UserLookupResult, UserSummary } from '@kms/contracts';

export type { UserSummary, CsvImportRowResult, UserGroupAssignment, CreateUserResult, UserLookupResult };

/**
 * `TenantUsersAdminController`'s client (UI spec C1, user-management plan 2026-08-24) — every
 * method below is admin-only server-side (`AdminOnlyGuard`, class-level). `lookupByEmail` is the
 * one exception: it hits a *different*, non-admin-gated controller (`UserLookupController`,
 * `/tenant-users/lookup`) — 2026-08-28 bug fix, see that controller's own doc comment for why
 * `principalId`/`userId` fields elsewhere in this app (group membership, folder grants) needed an
 * email-to-id resolver reachable by any authenticated tenant member, not just admins.
 */
export const usersApi = {
  list: () => tenantApi.get<UserSummary[]>('/tenant-admin/users'),
  create: (email: string, firstName: string, lastName: string, role: 'user' | 'admin', groups: UserGroupAssignment[]) =>
    tenantApi.post<CreateUserResult>('/tenant-admin/users', { email, firstName, lastName, role, groups }),
  update: (
    id: string,
    patch: { email?: string; firstName?: string; lastName?: string; role?: 'user' | 'admin'; groups?: UserGroupAssignment[] },
  ) => tenantApi.patch<UserSummary>(`/tenant-admin/users/${id}`, patch),
  resendInvite: (id: string) => tenantApi.post<{ ok: true }>(`/tenant-admin/users/${id}/resend-invite`),
  deactivate: (id: string) => tenantApi.patch<{ ok: true }>(`/tenant-admin/users/${id}/deactivate`),
  reactivate: (id: string) => tenantApi.patch<{ ok: true }>(`/tenant-admin/users/${id}/reactivate`),
  importCsv: (csvContent: string) => tenantApi.post<{ results: CsvImportRowResult[] }>('/tenant-admin/users/import', { csvContent }),

  lookupByEmail: (email: string) => tenantApi.get<UserLookupResult>(`/tenant-users/lookup${toQuery({ email })}`),
};

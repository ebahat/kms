import { portalApi, toQuery } from './api';

/** Mirrors PlatformTenantsController.provision's response (apps/portal-api/src/platform-admin/tenants.controller.ts). */
export type ProvisionTenantResult = {
  tenantId: string;
  subdomain: string;
  adminUserId: string;
  adminEmail: string;
  tempPassword: string;
};

export type ProvisionTenantInput = {
  name: string;
  edition: 'kb' | 'ocr';
  subdomain: string;
  adminEmail: string;
  themeColorRgb?: string;
};

/** Mirrors the Tenant Mongoose document as PlatformTenantsController.getOne/update return it. */
export type TenantDetail = {
  _id: string;
  name: string;
  edition: 'kb' | 'ocr';
  status: 'active' | 'suspended';
  storageQuotaBytes: number;
  subdomain?: string;
  logoObjectKey?: string;
  logoUrl?: string;
  themeColorRgb?: string;
};

export type UpdateTenantInput = {
  name?: string;
  edition?: 'kb' | 'ocr';
  subdomain?: string;
  themeColorRgb?: string;
};

export type TenantAdminSummary = { id: string; email: string; status: 'active' | 'inactive' | 'locked' };

export const platformTenantsApi = {
  list: () => portalApi.get<TenantDetail[]>('/platform-admin/tenants'),
  get: (tenantId: string) => portalApi.get<TenantDetail>(`/platform-admin/tenants/${tenantId}`),
  checkSubdomain: (value: string) => portalApi.get<{ available: boolean }>(`/platform-admin/tenants/check-subdomain${toQuery({ value })}`),
  provision: (input: ProvisionTenantInput) => portalApi.post<ProvisionTenantResult>('/platform-admin/tenants/provision', input),
  update: (tenantId: string, input: UpdateTenantInput) => portalApi.patch<TenantDetail>(`/platform-admin/tenants/${tenantId}`, input),
  suspend: (tenantId: string) => portalApi.patch<{ ok: true }>(`/platform-admin/tenants/${tenantId}/suspend`),
  reactivate: (tenantId: string) => portalApi.patch<{ ok: true }>(`/platform-admin/tenants/${tenantId}/reactivate`),
  uploadLogo: (tenantId: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return portalApi.postForm<{ ok: true }>(`/platform-admin/tenants/${tenantId}/logo`, form);
  },
  listAdmins: (tenantId: string) => portalApi.get<TenantAdminSummary[]>(`/platform-admin/tenants/${tenantId}/admins`),
  resetAdminPassword: (tenantId: string, userId: string) =>
    portalApi.post<{ tempPassword: string }>(`/platform-admin/tenants/${tenantId}/admins/${userId}/reset-password`),
};

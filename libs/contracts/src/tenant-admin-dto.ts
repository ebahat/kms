import { z } from 'zod';

/** Platform-admin tenant lifecycle (PRD §5). */
export const CreateTenantRequestSchema = z.object({
  name: z.string().min(1),
  edition: z.enum(['kb', 'ocr']),
  storageQuotaBytes: z.number().int().positive().optional(),
});
export type CreateTenantRequest = z.infer<typeof CreateTenantRequestSchema>;

export const UpdateTenantQuotaRequestSchema = z.object({
  storageQuotaBytes: z.number().int().positive(),
});
export type UpdateTenantQuotaRequest = z.infer<typeof UpdateTenantQuotaRequestSchema>;

/**
 * Reserved DNS labels for the superuser subdomain form (Phase C, C1.2) — `api`/`admin`/`app` are
 * the existing hostname prefixes this project's Caddy config already routes (system-overview.md),
 * `www`/`mail` are conventional reservations. Exported so both the API validator and any future
 * frontend pre-check can share the exact same list rather than drifting.
 */
export const RESERVED_SUBDOMAINS = ['api', 'admin', 'app', 'www', 'mail'] as const;

const SUBDOMAIN_REGEX = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Atomic tenant + first-admin provisioning (Phase C, C1.2) — the superuser screen's single submit.
 * A tenant with no admin is a useless, half-finished state, so this always creates both together.
 */
export const ProvisionTenantRequestSchema = z.object({
  name: z.string().min(1).max(200),
  edition: z.enum(['kb', 'ocr']),
  subdomain: z
    .string()
    .toLowerCase()
    .regex(SUBDOMAIN_REGEX, 'invalid subdomain')
    .refine((value) => !(RESERVED_SUBDOMAINS as readonly string[]).includes(value), { message: 'subdomain is reserved' }),
  adminEmail: z.string().email(),
  themeColorRgb: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
  storageQuotaBytes: z.number().int().positive().optional(),
});
export type ProvisionTenantRequest = z.infer<typeof ProvisionTenantRequestSchema>;

export type ProvisionTenantResponse = {
  tenantId: string;
  subdomain: string;
  adminUserId: string;
  adminEmail: string;
  tempPassword: string; // shown once, same convention as tenant-admin user creation
};

export const CheckSubdomainQuerySchema = z.object({
  value: z.string().min(1),
});
export type CheckSubdomainResponse = { available: boolean };

/**
 * Edit an existing tenant (Phase C follow-up, 2026-08-22) — every field optional, only the ones
 * present are changed. Reuses `ProvisionTenantRequestSchema`'s exact subdomain field (format +
 * reserved-word check) so the two endpoints can never validate subdomains differently.
 */
export const UpdateTenantRequestSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  edition: z.enum(['kb', 'ocr']).optional(),
  subdomain: ProvisionTenantRequestSchema.shape.subdomain.optional(),
  themeColorRgb: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .optional(),
});
export type UpdateTenantRequest = z.infer<typeof UpdateTenantRequestSchema>;

/** Mirrors TenantUsersAdminController's UserSummary shape, minus fields the superuser screen doesn't need. */
export type TenantAdminSummary = {
  id: string;
  email: string;
  /** 'pending' = invited, activation link not yet used (user-management plan, 2026-08-24). */
  status: 'pending' | 'active' | 'inactive' | 'locked';
};

export type ResetTenantAdminPasswordResponse = { tempPassword: string };

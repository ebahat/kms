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

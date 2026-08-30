import { z } from 'zod';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

/**
 * `grants` is only meaningful for a root folder (`parentId: null`) — a non-root folder inherits by
 * default (ADR-0005), and the create-subfolder UI has no picker for it. Restricted to
 * `principalType: 'group'` — per-user grants at creation time aren't part of this feature (product-
 * gaps batch, 2026-08-29 item 6); a per-user grant can still be added afterward via the existing
 * `/grants` endpoint.
 */
export const CreateFolderRequestSchema = z.object({
  parentId: objectIdString.nullable(), // null = root
  name: z.string().trim().min(1).max(255),
  grants: z.array(z.object({ principalType: z.literal('group'), principalId: objectIdString, access: z.enum(['read', 'edit', 'manage']) })).optional(),
});
export type CreateFolderRequest = z.infer<typeof CreateFolderRequestSchema>;

export const RenameFolderRequestSchema = z.object({ name: z.string().trim().min(1).max(255) });
export type RenameFolderRequest = z.infer<typeof RenameFolderRequestSchema>;

export const MoveFolderRequestSchema = z.object({ parentId: objectIdString.nullable() });
export type MoveFolderRequest = z.infer<typeof MoveFolderRequestSchema>;

export const SetFolderPublicRequestSchema = z.object({ isPublic: z.boolean() });
export type SetFolderPublicRequest = z.infer<typeof SetFolderPublicRequestSchema>;

/** ADR-0005 access tiers: manage > edit > read. */
export const FolderGrantRequestSchema = z.object({
  principalType: z.enum(['user', 'group']),
  principalId: objectIdString,
  access: z.enum(['read', 'edit', 'manage']),
});
export type FolderGrantRequest = z.infer<typeof FolderGrantRequestSchema>;

export const RevokeFolderGrantRequestSchema = z.object({
  principalType: z.enum(['user', 'group']),
  principalId: objectIdString,
});
export type RevokeFolderGrantRequest = z.infer<typeof RevokeFolderGrantRequestSchema>;

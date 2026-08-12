import { z } from 'zod';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

export const CreateFolderRequestSchema = z.object({
  parentId: objectIdString.nullable(), // null = root
  name: z.string().trim().min(1).max(255),
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

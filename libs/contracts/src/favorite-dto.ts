import { z } from 'zod';

const objectIdString = z.string().regex(/^[0-9a-fA-F]{24}$/, 'invalid id');

export const AddFavoriteRequestSchema = z.object({
  targetType: z.enum(['document', 'folder']),
  targetId: objectIdString,
});
export type AddFavoriteRequest = z.infer<typeof AddFavoriteRequestSchema>;

/**
 * `name`/`folderId` are resolved server-side at read time (never trusts a cached value from
 * favorite time) — for a document favorite, `folderId` is the document's *current* containing
 * folder, used to build a link back to it since documents have no page of their own.
 */
export type FavoriteSummary = {
  id: string;
  targetType: 'document' | 'folder';
  targetId: string;
  name: string;
  folderId: string;
  createdAt: Date;
};

export type RemoveFavoriteResponse = { removed: true };

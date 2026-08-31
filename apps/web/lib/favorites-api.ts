import { tenantApi } from './api';
import type { FavoriteSummary, RemoveFavoriteResponse } from '@kms/contracts';

export type { FavoriteSummary, RemoveFavoriteResponse };

/** `FavoritesController`'s response types are published from @kms/contracts (mirrors chat-api.ts's convention, not folders-api.ts's hand-mirrored-locals one). */
export const favoritesApi = {
  list: () => tenantApi.get<FavoriteSummary[]>('/favorites'),
  add: (targetType: 'document' | 'folder', targetId: string) =>
    tenantApi.post<FavoriteSummary>('/favorites', { targetType, targetId }),
  remove: (targetType: 'document' | 'folder', targetId: string) =>
    tenantApi.del<RemoveFavoriteResponse>(`/favorites/${targetType}/${targetId}`),
};

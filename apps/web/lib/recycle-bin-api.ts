import { tenantApi } from './api';

/** Mirrors RecycleBinEntrySummary (apps/api's documents.controller.ts listRecycleBin, C4). */
export type RecycleBinEntry = {
  id: string;
  documentId: string;
  name: string;
  folderId: string;
  folderName: string | null;
  sizeBytes: number;
  deletedAt: string;
  purgeAfter: string;
};

export const recycleBinApi = {
  list: () => tenantApi.get<RecycleBinEntry[]>('/recycle-bin'),
  restore: (id: string) => tenantApi.post<{ documentId: string }>(`/recycle-bin/${id}/restore`),
  purge: (id: string) => tenantApi.post<{ verified: boolean }>(`/recycle-bin/${id}/purge`),
};

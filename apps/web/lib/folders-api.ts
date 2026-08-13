import { tenantApi, toQuery } from './api';

/**
 * Mirrors FoldersController's own local response shapes (apps/api/src/folders/folders.controller.ts)
 * — those were never published as @kms/contracts types (only request DTOs are), so this is a
 * hand-matched client-side type, same as how the controller itself defines `FolderSummary` locally
 * rather than importing one.
 */
export type FolderSummary = {
  id: string;
  name: string;
  parentId: string | null;
  hasExplicitGrants: boolean;
  isPublic: boolean;
  tier: 'read' | 'edit' | 'manage';
  broaderThanParent: boolean;
  addedGroups: string[];
  becamePublic: boolean;
  path: { id: string; name: string }[];
};

export type FolderGrant = { principalType: 'user' | 'group'; principalId: string; access: 'read' | 'edit' | 'manage' };

export type FolderDetail = FolderSummary & { grants?: FolderGrant[] };

export type DocumentSummary = {
  id: string;
  folderId: string;
  name: string;
  status: 'queued' | 'processing' | 'indexed' | 'failed';
  latestVersionId: string;
  latestVersionNumber: number;
  sizeBytes: number;
  createdBy: string;
  createdAt: string;
};

export const foldersApi = {
  list: (parentId?: string) => tenantApi.get<FolderSummary[]>(`/folders${toQuery({ parentId })}`),
  detail: (id: string) => tenantApi.get<FolderDetail>(`/folders/${id}`),
  create: (input: { parentId: string | null; name: string }) =>
    tenantApi.post<{ id: string; name: string; parentId: string | null; hasExplicitGrants: boolean; isPublic: boolean }>('/folders', input),
  rename: (id: string, name: string) => tenantApi.patch<{ id: string; name: string }>(`/folders/${id}`, { name }),
  move: (id: string, parentId: string | null) => tenantApi.patch<{ id: string; parentId: string | null }>(`/folders/${id}/move`, { parentId }),
  remove: (id: string) => tenantApi.del<{ deleted: true }>(`/folders/${id}`),
  documents: (id: string) => tenantApi.get<DocumentSummary[]>(`/folders/${id}/documents`),
};

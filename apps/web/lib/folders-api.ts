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
  /** Mongoose's automatic `updatedAt` — bumped on rename/move/setLatestVersion. */
  updatedAt: string;
  /** Stamped on each download-link issuance; absent until the document has been opened at least once. */
  lastOpenedAt?: string;
};

/** Mirrors DocumentsController's DownloadDocumentResponse (@kms/contracts) — issued per click, never stored. */
export type DownloadDocumentResponse = { url: string; expiresAt: string };

/** Mirrors DocumentsController's UploadDocumentResponse (@kms/contracts) — `status` is always 'queued' today, since no ingestion pipeline consumes it yet (Phase 3, not started). */
export type UploadDocumentResponse = { documentId: string; versionId: string; versionNumber: number; status: 'queued' };

export type GrantsResponse = { id: string; hasExplicitGrants: boolean; isPublic: boolean; grants: FolderGrant[] };

/** Group-only grant, root-folder creation time only (product-gaps batch, 2026-08-29 item 6). */
export type FolderGroupGrant = { principalType: 'group'; principalId: string; access: 'read' | 'edit' | 'manage' };

/** Cross-group visibility (item 6/7e) — group name + tier only, never user-type grants. */
export type GrantedGroup = { groupId: string; groupName: string; access: 'read' | 'edit' | 'manage' };

export type DecidingGrant =
  | { tier: 'read' | 'edit' | 'manage'; via: 'public' }
  | { tier: 'read' | 'edit' | 'manage'; via: { principalType: 'user' | 'group'; principalId: string } };

export type EffectivePermission = {
  userId: string;
  folderId: string;
  tier: 'read' | 'edit' | 'manage' | null;
  decidingGrant: DecidingGrant | null;
};

export const foldersApi = {
  list: (parentId?: string) => tenantApi.get<FolderSummary[]>(`/folders${toQuery({ parentId })}`),
  detail: (id: string) => tenantApi.get<FolderDetail>(`/folders/${id}`),
  create: (input: { parentId: string | null; name: string; grants?: FolderGroupGrant[] }) =>
    tenantApi.post<{ id: string; name: string; parentId: string | null; hasExplicitGrants: boolean; isPublic: boolean }>('/folders', input),
  rename: (id: string, name: string) => tenantApi.patch<{ id: string; name: string }>(`/folders/${id}`, { name }),
  move: (id: string, parentId: string | null) => tenantApi.patch<{ id: string; parentId: string | null }>(`/folders/${id}/move`, { parentId }),
  remove: (id: string) => tenantApi.del<{ deleted: true }>(`/folders/${id}`),
  documents: (id: string) => tenantApi.get<DocumentSummary[]>(`/folders/${id}/documents`),
  documentDownloadUrl: (documentId: string) => tenantApi.get<DownloadDocumentResponse>(`/documents/${documentId}/download`),
  uploadDocument: (folderId: string, file: File) => {
    const form = new FormData();
    form.append('folderId', folderId);
    form.append('file', file);
    return tenantApi.postForm<UploadDocumentResponse>('/documents', form);
  },
  renameDocument: (id: string, name: string) => tenantApi.patch<DocumentSummary>(`/documents/${id}`, { name }),
  moveDocument: (id: string, folderId: string) => tenantApi.patch<DocumentSummary>(`/documents/${id}`, { folderId }),
  addGrant: (id: string, grant: FolderGrant) => tenantApi.post<GrantsResponse>(`/folders/${id}/grants`, grant),
  revokeGrant: (id: string, principalType: 'user' | 'group', principalId: string) =>
    tenantApi.del<GrantsResponse>(`/folders/${id}/grants`, { principalType, principalId }),
  resetToInherited: (id: string) => tenantApi.post<GrantsResponse>(`/folders/${id}/grants/inherit`),
  setPublic: (id: string, isPublic: boolean) => tenantApi.patch<GrantsResponse>(`/folders/${id}/public`, { isPublic }),
  effectivePermission: (id: string, userId: string) =>
    tenantApi.get<EffectivePermission>(`/folders/${id}/effective-permission${toQuery({ userId })}`),
  grantedGroups: (id: string) => tenantApi.get<GrantedGroup[]>(`/folders/${id}/granted-groups`),
};

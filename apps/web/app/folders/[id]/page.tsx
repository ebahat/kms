'use client';

import { DragEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { FolderPicker } from '../../../components/folder-picker';
import { ApiError, apiErrorMessage } from '../../../lib/api';
import { DocumentSummary, FolderDetail, FolderSummary, foldersApi } from '../../../lib/folders-api';
import { useSession } from '../../../lib/use-session';

const STATUS_LABEL: Record<DocumentSummary['status'], string> = { queued: 'ממתין', processing: 'בעיבוד', indexed: 'מאונדקס', failed: 'נכשל' };

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso: string | undefined): string {
  if (!iso) return 'מעולם לא';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Which item a "move to" picker session is targeting — the current folder itself, one of its subfolders, or one of its documents. */
type MoveTarget = { kind: 'currentFolder' } | { kind: 'subfolder'; id: string; name: string } | { kind: 'document'; id: string; name: string };

/**
 * UI spec B2's folder-tree portion, one folder deep: breadcrumb, subfolders, document list with a
 * plain download link per document (calling the already-built DocumentsController download route).
 * Upload with progress/version history/processing-queue (B3-B5) remain out of scope for this plan —
 * the download link itself is a small, self-contained addition to the existing read-only list, not
 * that deferred slice.
 */
export default function FolderDetailPage() {
  const params = useParams<{ id: string }>();
  const folderId = params.id;
  const session = useSession();
  const router = useRouter();

  const [folder, setFolder] = useState<FolderDetail | null>(null);
  const [children, setChildren] = useState<FolderSummary[] | null>(null);
  const [documents, setDocuments] = useState<DocumentSummary[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadNotice, setDownloadNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null);
  const [renamingSubfolderId, setRenamingSubfolderId] = useState<string | null>(null);
  const [subfolderRenameValue, setSubfolderRenameValue] = useState('');
  const [renamingDocumentId, setRenamingDocumentId] = useState<string | null>(null);
  const [documentRenameValue, setDocumentRenameValue] = useState('');

  const load = useCallback(async () => {
    setNotFound(false);
    setError(null);
    try {
      const [f, kids, docs] = await Promise.all([foldersApi.detail(folderId), foldersApi.list(folderId), foldersApi.documents(folderId)]);
      setFolder(f);
      setChildren(kids);
      setDocuments(docs);
      setRenameValue(f.name);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true);
      else setError(apiErrorMessage(e, 'שגיאה בטעינת התיקייה'));
    }
  }, [folderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onCreateSubfolder() {
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const created = await foldersApi.create({ parentId: folderId, name: newName.trim() });
      setNewName('');
      router.push(`/folders/${created.id}`);
    } catch (e) {
      setError(apiErrorMessage(e, 'יצירת התיקייה נכשלה'));
    } finally {
      setBusy(false);
    }
  }

  async function onRename() {
    if (!renameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.rename(folderId, renameValue.trim());
      setRenaming(false);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'שינוי השם נכשל'));
    } finally {
      setBusy(false);
    }
  }

  /** Dispatches to the right API call based on what the open picker is moving — the current folder, one of its subfolders, or one of its documents. */
  async function onConfirmMove(destinationFolderId: string) {
    if (!moveTarget) return;
    if (moveTarget.kind === 'currentFolder') {
      await foldersApi.move(folderId, destinationFolderId);
    } else if (moveTarget.kind === 'subfolder') {
      await foldersApi.move(moveTarget.id, destinationFolderId);
    } else {
      await foldersApi.moveDocument(moveTarget.id, destinationFolderId);
    }
    await load();
  }

  async function onRenameSubfolder(id: string) {
    if (!subfolderRenameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.rename(id, subfolderRenameValue.trim());
      setRenamingSubfolderId(null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'שינוי השם נכשל'));
    } finally {
      setBusy(false);
    }
  }

  async function onRenameDocument(id: string) {
    if (!documentRenameValue.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.renameDocument(id, documentRenameValue.trim());
      setRenamingDocumentId(null);
      await load();
    } catch (e) {
      setError(apiErrorMessage(e, 'שינוי השם נכשל'));
    } finally {
      setBusy(false);
    }
  }

  /**
   * Pilot-only caveat (native OCI object storage binding): unlike the S3-compatible bindings,
   * OciStorageProvider can't set a per-download filename — it forces a generic "attachment" name at
   * the browser level (see storage-provider.ts's OciStorageProvider doc comment for why). Shown once
   * per click, dismissed automatically, rather than baked into the download button's permanent label.
   */
  async function onDownload(documentId: string) {
    setDownloadingId(documentId);
    setError(null);
    try {
      const { url } = await foldersApi.documentDownloadUrl(documentId);
      window.open(url, '_blank', 'noopener,noreferrer');
      setDownloadNotice('בתקופת הפיילוט שם הקובץ שיורד יהיה גנרי — נא לשנות את שם הקובץ שהורדתם.');
      setTimeout(() => setDownloadNotice(null), 8000);
    } catch (e) {
      setError(apiErrorMessage(e, 'ההורדה נכשלה'));
    } finally {
      setDownloadingId(null);
    }
  }

  /**
   * Uploads immediately on selection — same single-step pattern as the CSV import on /users, no
   * separate "confirm" step. The backend endpoint (POST /documents) takes one file per request, so
   * a multi-file pick or drop uploads sequentially rather than in one call; one file failing (e.g. an
   * unsupported type) doesn't abort the rest — failures are collected and reported together at the end.
   */
  async function onUploadFiles(files: File[]) {
    if (files.length === 0) return;
    setUploading(true);
    setError(null);
    const failures: string[] = [];
    for (let i = 0; i < files.length; i++) {
      setUploadProgress({ done: i, total: files.length });
      try {
        await foldersApi.uploadDocument(folderId, files[i]);
      } catch (e) {
        failures.push(`${files[i].name}: ${apiErrorMessage(e, 'שגיאה')}`);
      }
    }
    setUploadProgress(null);
    setUploading(false);
    if (failures.length > 0) setError(`חלק מהקבצים לא הועלו:\n${failures.join('\n')}`);
    await load();
  }

  function onDragOverDropzone(e: DragEvent) {
    if (!canEdit) return;
    e.preventDefault();
    setIsDraggingOver(true);
  }

  function onDragLeaveDropzone(e: DragEvent) {
    e.preventDefault();
    setIsDraggingOver(false);
  }

  function onDropOnDropzone(e: DragEvent) {
    e.preventDefault();
    setIsDraggingOver(false);
    if (!canEdit || uploading) return;
    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) void onUploadFiles(files);
  }

  async function onDelete() {
    if (!window.confirm('למחוק את התיקייה? הפעולה אפשרית רק כשהתיקייה ריקה.')) return;
    setBusy(true);
    setError(null);
    try {
      await foldersApi.remove(folderId);
      router.push(folder?.parentId ? `/folders/${folder.parentId}` : '/folders');
    } catch (e) {
      setError(apiErrorMessage(e, 'המחיקה נכשלה — ודאו שהתיקייה ריקה'));
      setBusy(false);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;
  if (notFound) {
    return (
      <AppShell session={session} active="folders">
        <p className="font-body-md text-body-md text-on-surface mb-4">התיקייה לא נמצאה, או שאין לך הרשאה לצפות בה.</p>
        <Link href="/folders" className="text-primary hover:underline">
          חזרה לתיקיות
        </Link>
      </AppShell>
    );
  }
  if (!folder || !children || !documents) {
    return (
      <AppShell session={session} active="folders">
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      </AppShell>
    );
  }

  const canEdit = folder.tier === 'edit' || folder.tier === 'manage';
  const canManage = folder.tier === 'manage';

  return (
    <AppShell session={session} active="folders">
      <nav className="mb-4 flex flex-wrap gap-1 font-body-sm text-body-sm text-on-surface-variant">
        <Link href="/folders" className="hover:text-primary">
          תיקיות
        </Link>
        {folder.path.map((ancestor) => (
          <span key={ancestor.id}>
            {' / '}
            <Link href={`/folders/${ancestor.id}`} className="hover:text-primary">
              {ancestor.name}
            </Link>
          </span>
        ))}
        {' / '}
        <span className="text-on-surface">{folder.name}</span>
      </nav>

      <div className="flex items-center gap-2 mb-1">
        <h1 className="font-headline-md text-headline-md text-on-surface">{folder.name}</h1>
        {folder.isPublic && (
          <span className="font-label-xs text-label-xs bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full">ציבורי</span>
        )}
        {folder.broaderThanParent && (
          <span
            title={folder.addedGroups.join(', ')}
            className="font-label-xs text-label-xs bg-error-container text-on-error-container px-2 py-0.5 rounded-full flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[14px]">warning</span>
            הרשאות מורחבות ביחס לתיקיית האב
          </span>
        )}
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 my-4 font-body-sm text-body-sm">{error}</p>}
      {downloadNotice && (
        <p role="status" className="bg-surface-container-high text-on-surface rounded-DEFAULT px-3 py-2.5 my-4 font-body-sm text-body-sm">
          {downloadNotice}
        </p>
      )}

      <div className="flex gap-2 flex-wrap my-4">
        {canManage && (
          <>
            {renaming ? (
              <>
                <input
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  className="px-3 py-1.5 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                />
                <button
                  onClick={onRename}
                  disabled={busy}
                  className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-primary-container hover:text-on-primary-container transition-colors"
                >
                  שמור
                </button>
                <button
                  onClick={() => setRenaming(false)}
                  disabled={busy}
                  className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
                >
                  ביטול
                </button>
              </>
            ) : (
              <button
                onClick={() => setRenaming(true)}
                disabled={busy}
                className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
              >
                שנה שם
              </button>
            )}
            <button
              onClick={() => setMoveTarget({ kind: 'currentFolder' })}
              disabled={busy}
              className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors"
            >
              העבר
            </button>
            <button
              onClick={onDelete}
              disabled={busy}
              className="border border-outline-variant text-error font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-error-container transition-colors"
            >
              מחק
            </button>
            <Link
              href={`/folders/${folderId}/permissions`}
              className="border border-outline-variant text-on-surface font-title-sm text-title-sm px-4 py-1.5 rounded-DEFAULT hover:bg-surface-container-high transition-colors flex items-center"
            >
              ניהול הרשאות
            </Link>
          </>
        )}
      </div>

      {canEdit && (
        <div className="flex gap-2 my-4 flex-wrap">
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="שם תת-תיקייה חדשה"
            className="px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
          />
          <button
            onClick={onCreateSubfolder}
            disabled={busy || !newName.trim()}
            className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-sm">add</span>
            צור תת-תיקייה
          </button>
          <label
            className={`border border-outline-variant text-on-surface font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-surface-container-high transition-colors cursor-pointer ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <span className="material-symbols-outlined text-sm">upload_file</span>
            {uploading && uploadProgress ? `מעלה... (${uploadProgress.done}/${uploadProgress.total})` : uploading ? 'מעלה...' : 'העלה קבצים'}
            <input
              type="file"
              multiple
              accept="application/pdf,.docx,.doc,image/jpeg,image/png,.jpg,.jpeg,.png"
              disabled={uploading}
              className="hidden"
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                if (files.length > 0) void onUploadFiles(files);
                e.target.value = '';
              }}
            />
          </label>
        </div>
      )}

      <h2 className="font-title-sm text-title-sm text-on-surface mt-6 mb-2">תתי-תיקיות</h2>
      {children.length === 0 ? (
        <p className="font-body-sm text-body-sm text-on-surface-variant">אין תתי-תיקיות.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant divide-y divide-outline-variant overflow-hidden shadow-sm mb-6">
          {children.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 h-row-height-standard hover:bg-surface-container-high transition-colors group">
              {renamingSubfolderId === f.id ? (
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="material-symbols-outlined text-tertiary-container shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                    folder
                  </span>
                  <input
                    value={subfolderRenameValue}
                    onChange={(e) => setSubfolderRenameValue(e.target.value)}
                    autoFocus
                    className="flex-1 min-w-0 px-2 py-1 border border-primary rounded-DEFAULT text-body-md font-body-md bg-surface focus:outline-none"
                  />
                  <button
                    onClick={() => onRenameSubfolder(f.id)}
                    disabled={busy}
                    className="font-label-xs text-label-xs text-primary hover:underline shrink-0"
                  >
                    שמור
                  </button>
                  <button
                    onClick={() => setRenamingSubfolderId(null)}
                    disabled={busy}
                    className="font-label-xs text-label-xs text-on-surface-variant hover:underline shrink-0"
                  >
                    ביטול
                  </button>
                </div>
              ) : (
                <>
                  <Link href={`/folders/${f.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="material-symbols-outlined text-tertiary-container shrink-0" style={{ fontVariationSettings: "'FILL' 1" }}>
                      folder
                    </span>
                    <span className="font-body-md text-body-md text-on-surface truncate">{f.name}</span>
                    {f.isPublic && (
                      <span className="font-label-xs text-label-xs bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full shrink-0">
                        ציבורי
                      </span>
                    )}
                    {f.broaderThanParent && (
                      <span
                        title={f.addedGroups.join(', ')}
                        className="font-label-xs text-label-xs bg-error-container text-on-error-container px-2 py-0.5 rounded-full shrink-0"
                      >
                        הרשאות מורחבות
                      </span>
                    )}
                  </Link>
                  {f.tier === 'manage' && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button
                        onClick={() => {
                          setRenamingSubfolderId(f.id);
                          setSubfolderRenameValue(f.name);
                        }}
                        title="שנה שם"
                        aria-label="שנה שם"
                        className="p-1.5 text-on-surface-variant hover:bg-surface-container-highest rounded transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">edit</span>
                      </button>
                      <button
                        onClick={() => setMoveTarget({ kind: 'subfolder', id: f.id, name: f.name })}
                        title="העבר"
                        aria-label="העבר"
                        className="p-1.5 text-on-surface-variant hover:bg-surface-container-highest rounded transition-colors"
                      >
                        <span className="material-symbols-outlined text-[18px]">drive_file_move</span>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <h2 className="font-title-sm text-title-sm text-on-surface mt-6 mb-2">מסמכים</h2>
      <div
        onDragOver={onDragOverDropzone}
        onDragLeave={onDragLeaveDropzone}
        onDrop={onDropOnDropzone}
        className={
          canEdit && isDraggingOver
            ? 'rounded-lg border-2 border-dashed border-primary bg-primary-container/20 transition-colors'
            : canEdit
              ? 'rounded-lg border-2 border-dashed border-transparent transition-colors'
              : undefined
        }
      >
        {canEdit && isDraggingOver && (
          <p className="font-body-sm text-body-sm text-primary text-center py-3 pointer-events-none">
            שחררו כאן להעלאת הקבצים
          </p>
        )}
        {documents.length === 0 ? (
          <p className="font-body-sm text-body-sm text-on-surface-variant p-3">
            אין מסמכים בתיקייה זו.{canEdit && !isDraggingOver && ' ניתן לגרור קבצים לכאן להעלאה.'}
          </p>
        ) : (
          <div className="bg-surface-container-lowest rounded-lg border border-outline-variant overflow-hidden shadow-sm">
            <table className="w-full text-right border-collapse">
              <thead className="bg-surface-container-low border-b border-outline-variant font-title-sm text-title-sm text-on-surface-variant">
                <tr>
                  <th className="p-3 font-medium">שם</th>
                  <th className="p-3 font-medium">גודל</th>
                  <th className="p-3 font-medium">גרסה</th>
                  <th className="p-3 font-medium">סטטוס</th>
                  <th className="p-3 font-medium">זמן העלאה</th>
                  <th className="p-3 font-medium">עודכן לאחרונה</th>
                  <th className="p-3 font-medium">נפתח לאחרונה</th>
                  <th className="p-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="font-body-sm text-body-sm text-on-surface divide-y divide-outline-variant">
                {documents.map((d) => (
                  <tr key={d.id} className="hover:bg-surface-container-high transition-colors group">
                    <td className="p-3">
                      {renamingDocumentId === d.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={documentRenameValue}
                            onChange={(e) => setDocumentRenameValue(e.target.value)}
                            autoFocus
                            className="px-2 py-1 border border-primary rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none"
                          />
                          <button
                            onClick={() => onRenameDocument(d.id)}
                            disabled={busy}
                            className="font-label-xs text-label-xs text-primary hover:underline"
                          >
                            שמור
                          </button>
                          <button
                            onClick={() => setRenamingDocumentId(null)}
                            disabled={busy}
                            className="font-label-xs text-label-xs text-on-surface-variant hover:underline"
                          >
                            ביטול
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-outlined text-on-surface-variant text-[20px]">description</span>
                          {d.name}
                        </div>
                      )}
                    </td>
                    <td className="p-3 text-on-surface-variant">{formatSize(d.sizeBytes)}</td>
                    <td className="p-3 text-on-surface-variant">{d.latestVersionNumber}</td>
                    <td className="p-3">
                      <span className="font-label-xs text-label-xs bg-surface-variant text-on-surface-variant px-2 py-0.5 rounded-full">
                        {STATUS_LABEL[d.status]}
                      </span>
                    </td>
                    <td className="p-3 text-on-surface-variant" dir="ltr">
                      {formatDate(d.createdAt)}
                    </td>
                    <td className="p-3 text-on-surface-variant" dir="ltr">
                      {formatDate(d.updatedAt)}
                    </td>
                    <td className="p-3 text-on-surface-variant" dir="ltr">
                      {formatDate(d.lastOpenedAt)}
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button
                          onClick={() => onDownload(d.id)}
                          disabled={downloadingId === d.id}
                          className="text-primary hover:underline disabled:opacity-60 font-label-xs text-label-xs"
                        >
                          {downloadingId === d.id ? 'מוריד...' : 'הורדה'}
                        </button>
                        {canEdit && renamingDocumentId !== d.id && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => {
                                setRenamingDocumentId(d.id);
                                setDocumentRenameValue(d.name);
                              }}
                              title="שנה שם"
                              aria-label="שנה שם"
                              className="p-1.5 text-on-surface-variant hover:bg-surface-container-highest rounded transition-colors"
                            >
                              <span className="material-symbols-outlined text-[18px]">edit</span>
                            </button>
                            <button
                              onClick={() => setMoveTarget({ kind: 'document', id: d.id, name: d.name })}
                              title="העבר"
                              aria-label="העבר"
                              className="p-1.5 text-on-surface-variant hover:bg-surface-container-highest rounded transition-colors"
                            >
                              <span className="material-symbols-outlined text-[18px]">drive_file_move</span>
                            </button>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {moveTarget && (
        <FolderPicker
          isOpen
          onClose={() => setMoveTarget(null)}
          onMove={onConfirmMove}
          itemLabel={moveTarget.kind === 'currentFolder' ? folder.name : moveTarget.name}
          excludeFolderId={
            moveTarget.kind === 'currentFolder' ? folderId : moveTarget.kind === 'subfolder' ? moveTarget.id : folderId
          }
        />
      )}
    </AppShell>
  );
}

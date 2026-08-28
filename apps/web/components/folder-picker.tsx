'use client';

import { useEffect, useState } from 'react';
import { FolderSummary, foldersApi } from '../lib/folders-api';

const ROOT_KEY = '__root__';

/**
 * Shared "move to" modal for both folder-move and document-move (document-file-actions plan,
 * 2026-08-28) — a lazily-expanded folder tree, matching the design reference's per-level fetch
 * shape rather than loading the whole tenant tree upfront. No search box: the backend has no
 * "search folders by name across the tenant" capability to back one, and a decorative
 * non-functional search box would be worse than omitting it (see the plan's scope-cut note).
 */
export function FolderPicker({
  isOpen,
  onClose,
  onMove,
  excludeFolderId,
  itemLabel,
}: {
  isOpen: boolean;
  onClose: () => void;
  onMove: (destinationFolderId: string) => Promise<void>;
  /** The folder/document's own current folder — excluded from selection so "move" always changes something. Also excludes a folder from selecting itself as its own destination. */
  excludeFolderId?: string;
  /** Shown in the header, e.g. a file or folder name — "מעביר את X". */
  itemLabel?: string;
}) {
  const [childrenByParent, setChildrenByParent] = useState<Record<string, FolderSummary[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSelectedId(null);
    setError(null);
    if (!childrenByParent[ROOT_KEY]) void loadChildren(ROOT_KEY, undefined);
  }, [isOpen]);

  async function loadChildren(key: string, parentId: string | undefined) {
    setLoadingKey(key);
    try {
      const list = await foldersApi.list(parentId);
      setChildrenByParent((prev) => ({ ...prev, [key]: list }));
    } catch {
      setError('טעינת התיקיות נכשלה');
    } finally {
      setLoadingKey(null);
    }
  }

  function toggleExpand(folder: FolderSummary) {
    const isExpanded = !!expanded[folder.id];
    setExpanded((prev) => ({ ...prev, [folder.id]: !isExpanded }));
    if (!isExpanded && !childrenByParent[folder.id]) void loadChildren(folder.id, folder.id);
  }

  async function onConfirm() {
    if (!selectedId) return;
    setMoving(true);
    setError(null);
    try {
      await onMove(selectedId);
      onClose();
    } catch {
      setError('ההעברה נכשלה');
    } finally {
      setMoving(false);
    }
  }

  if (!isOpen) return null;

  function renderNode(folder: FolderSummary, depth: number) {
    const isExcluded = folder.id === excludeFolderId;
    const isSelected = folder.id === selectedId;
    const isExpandedNow = !!expanded[folder.id];
    const children = childrenByParent[folder.id];

    return (
      <li key={folder.id}>
        <div
          className={`flex items-center gap-2 p-2 rounded-DEFAULT transition-colors ${
            isExcluded
              ? 'opacity-40 cursor-not-allowed'
              : isSelected
                ? 'bg-primary-container text-on-primary-container cursor-pointer'
                : 'hover:bg-surface-container-low cursor-pointer text-on-surface'
          }`}
          style={{ paddingInlineStart: `${depth * 20 + 8}px` }}
          onClick={() => !isExcluded && setSelectedId(folder.id)}
        >
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleExpand(folder);
            }}
            className="text-on-surface-variant shrink-0"
            aria-label={isExpandedNow ? 'כווץ' : 'הרחב'}
          >
            <span className={`material-symbols-outlined text-[20px] transition-transform ${isExpandedNow ? '' : '-rotate-90'}`}>
              expand_more
            </span>
          </button>
          <span className="material-symbols-outlined text-[20px] shrink-0">folder</span>
          <span className="font-body-md text-body-md select-none flex-1 truncate">{folder.name}</span>
          {isSelected && <span className="material-symbols-outlined text-[18px] shrink-0">check</span>}
        </div>
        {isExpandedNow && (
          <ul>
            {loadingKey === folder.id && (
              <li className="font-body-sm text-body-sm text-on-surface-variant p-2" style={{ paddingInlineStart: `${(depth + 1) * 20 + 8}px` }}>
                טוען...
              </li>
            )}
            {children?.length === 0 && (
              <li className="font-body-sm text-body-sm text-on-surface-variant p-2" style={{ paddingInlineStart: `${(depth + 1) * 20 + 8}px` }}>
                אין תתי-תיקיות.
              </li>
            )}
            {children?.map((child) => renderNode(child, depth + 1))}
          </ul>
        )}
      </li>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-surface-container-high w-full max-w-lg rounded-xl shadow-lg border border-outline-variant flex flex-col max-h-[80vh] overflow-hidden m-4">
        <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
          <div>
            <h2 className="font-title-sm text-title-sm text-on-surface mb-1">העבר אל</h2>
            {itemLabel && (
              <p className="font-body-sm text-body-sm text-on-surface-variant flex items-center gap-1">
                <span className="material-symbols-outlined text-[16px]">folder_copy</span>
                {itemLabel}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-on-surface-variant hover:text-on-surface transition-colors p-2 rounded-DEFAULT hover:bg-surface-container-highest"
            aria-label="סגור"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {error && <p className="bg-error-container text-on-error-container px-4 py-2 font-body-sm text-body-sm">{error}</p>}

        <div className="flex-1 overflow-y-auto p-2 bg-surface-container-lowest">
          {loadingKey === ROOT_KEY && childrenByParent[ROOT_KEY] === undefined ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant p-2">טוען...</p>
          ) : childrenByParent[ROOT_KEY]?.length === 0 ? (
            <p className="font-body-sm text-body-sm text-on-surface-variant p-2">אין תיקיות.</p>
          ) : (
            <ul className="space-y-1">{childrenByParent[ROOT_KEY]?.map((folder) => renderNode(folder, 0))}</ul>
          )}
        </div>

        <div className="px-6 py-4 border-t border-outline-variant bg-surface-container-low flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={moving}
            className="px-4 py-2 rounded-DEFAULT font-label-xs text-label-xs text-on-surface-variant hover:bg-surface-container-highest transition-colors disabled:opacity-60"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!selectedId || moving}
            className="px-6 py-2 rounded-DEFAULT font-label-xs text-label-xs bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">drive_file_move</span>
            {moving ? 'מעביר...' : 'העבר לכאן'}
          </button>
        </div>
      </div>
    </div>
  );
}

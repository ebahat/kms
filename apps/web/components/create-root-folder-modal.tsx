'use client';

import { useEffect, useState } from 'react';
import { groupsApi, GroupSummary } from '../lib/groups-api';
import { FolderGroupGrant, foldersApi } from '../lib/folders-api';

const TIER_LABEL: Record<'read' | 'edit' | 'manage', string> = { read: 'צפייה', edit: 'עריכה', manage: 'ניהול' };

/**
 * Root-folder creation with a group-access picker (product-gaps batch, 2026-08-29 item 6) — matches
 * FolderPicker's own modal shape (fixed inset-0 overlay, header/body/footer). Group-only, matching
 * CreateFolderRequestSchema's own restriction — a per-user grant can still be added afterward via the
 * existing /folders/[id]/permissions screen.
 */
export function CreateRootFolderModal({ isOpen, onClose, onCreated }: { isOpen: boolean; onClose: () => void; onCreated: (folderId: string) => void }) {
  const [name, setName] = useState('');
  const [groups, setGroups] = useState<GroupSummary[] | null>(null);
  const [selected, setSelected] = useState<Record<string, 'read' | 'edit' | 'manage'>>({});
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setName('');
    setSelected({});
    setError(null);
    groupsApi
      .list()
      .then(setGroups)
      .catch(() => setError('טעינת הקבוצות נכשלה'));
  }, [isOpen]);

  function toggleGroup(groupId: string, checked: boolean) {
    setSelected((prev) => {
      const next = { ...prev };
      if (checked) next[groupId] = next[groupId] ?? 'read';
      else delete next[groupId];
      return next;
    });
  }

  async function onCreate() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const grants: FolderGroupGrant[] = Object.entries(selected).map(([principalId, access]) => ({ principalType: 'group', principalId, access }));
      const created = await foldersApi.create({ parentId: null, name: name.trim(), grants: grants.length > 0 ? grants : undefined });
      onCreated(created.id);
    } catch {
      setError('יצירת התיקייה נכשלה');
    } finally {
      setCreating(false);
    }
  }

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 backdrop-blur-sm" role="dialog" aria-modal="true">
      <div className="bg-surface-container-high w-full max-w-lg rounded-xl shadow-lg border border-outline-variant flex flex-col max-h-[80vh] overflow-hidden m-4">
        <div className="px-6 py-4 border-b border-outline-variant flex items-center justify-between bg-surface-container-low">
          <h2 className="font-title-sm text-title-sm text-on-surface">צור תיקיית שורש</h2>
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="text-on-surface-variant hover:text-on-surface transition-colors p-2 rounded-DEFAULT hover:bg-surface-container-highest"
            aria-label="סגור"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {error && <p className="bg-error-container text-on-error-container px-4 py-2 font-body-sm text-body-sm">{error}</p>}

        <div className="flex-1 overflow-y-auto p-4 bg-surface-container-lowest space-y-4">
          <div>
            <label className="block font-label-xs text-label-xs text-on-surface-variant mb-1">שם התיקייה</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
              className="w-full px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
            />
          </div>

          <div>
            <label className="block font-label-xs text-label-xs text-on-surface-variant mb-2">הרשאות קבוצות (אופציונלי)</label>
            {groups === null ? (
              <p className="font-body-sm text-body-sm text-on-surface-variant">טוען...</p>
            ) : groups.length === 0 ? (
              <p className="font-body-sm text-body-sm text-on-surface-variant">אין קבוצות בארגון.</p>
            ) : (
              <ul className="space-y-1">
                {groups.map((g) => {
                  const access = selected[g.id];
                  return (
                    <li key={g.id} className="flex items-center gap-3 p-2 rounded-DEFAULT hover:bg-surface-container-low">
                      <input
                        type="checkbox"
                        checked={access !== undefined}
                        onChange={(e) => toggleGroup(g.id, e.target.checked)}
                        className="w-4 h-4 rounded border-outline-variant text-primary focus:ring-primary"
                      />
                      <span className="flex-1 font-body-sm text-body-sm text-on-surface">{g.name}</span>
                      {access !== undefined && (
                        <select
                          value={access}
                          onChange={(e) => setSelected((prev) => ({ ...prev, [g.id]: e.target.value as 'read' | 'edit' | 'manage' }))}
                          className="bg-surface border border-outline-variant rounded-DEFAULT py-1 px-2 font-label-xs text-label-xs text-on-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        >
                          {(['read', 'edit', 'manage'] as const).map((tier) => (
                            <option key={tier} value={tier}>
                              {TIER_LABEL[tier]}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-outline-variant bg-surface-container-low flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="px-4 py-2 rounded-DEFAULT font-label-xs text-label-xs text-on-surface-variant hover:bg-surface-container-highest transition-colors disabled:opacity-60"
          >
            ביטול
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={!name.trim() || creating}
            className="px-6 py-2 rounded-DEFAULT font-label-xs text-label-xs bg-primary text-on-primary hover:bg-primary/90 transition-colors disabled:opacity-60 flex items-center gap-2 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add</span>
            {creating ? 'יוצר...' : 'צור תיקייה'}
          </button>
        </div>
      </div>
    </div>
  );
}

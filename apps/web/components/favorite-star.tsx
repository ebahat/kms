'use client';

import { useEffect, useState } from 'react';
import { favoritesApi } from '../lib/favorites-api';
import { apiErrorMessage } from '../lib/api';

/**
 * Self-contained toggle — manages its own optimistic state and API calls, so parent pages don't
 * need to thread favorite state through their own (already large) local state. Always visible,
 * unlike the rename/move icon-buttons it sits next to — a favorite is meaningful at any tier
 * (read included), not just edit/manage.
 */
export function FavoriteStar({
  targetType,
  targetId,
  initialFavorite,
  onToggled,
  onError,
}: {
  targetType: 'document' | 'folder';
  targetId: string;
  initialFavorite: boolean;
  /** Called after a successful add/remove — e.g. the /favorites list uses this to drop the row immediately on unfavorite. */
  onToggled?: (isFavorite: boolean) => void;
  /** Called on a failed add/remove, after the optimistic update is rolled back — parent pages surface this the same way as their other mutations. */
  onError?: (message: string) => void;
}) {
  const [isFavorite, setIsFavorite] = useState(initialFavorite);
  const [busy, setBusy] = useState(false);

  // The folder list and the favorites list load via two independent effects on the parent page;
  // the folder list (one query) almost always resolves before the favorites list (N+1 permission
  // resolution), so `initialFavorite` is `false` on first mount even for an already-favorited row.
  // Sync whenever the parent's resolved value changes, but only while this star hasn't been
  // toggled locally (`busy` brackets a toggle) — otherwise a slow parent re-render could stomp an
  // optimistic update the user just made.
  // Deliberately keyed on `initialFavorite` alone, not `busy` — re-running this when `busy` flips
  // back to false after a toggle would stomp the just-completed optimistic update with the
  // parent's still-stale prop value (this project's ESLint config has no react-hooks plugin, so
  // there's no exhaustive-deps rule to satisfy here).
  useEffect(() => {
    if (!busy) setIsFavorite(initialFavorite);
  }, [initialFavorite]);

  async function onClick(e: React.MouseEvent) {
    // Rows this sits in are often wrapped in a <Link> — never let the click bubble into navigation.
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    const next = !isFavorite;
    setIsFavorite(next);
    try {
      if (next) await favoritesApi.add(targetType, targetId);
      else await favoritesApi.remove(targetType, targetId);
      onToggled?.(next);
    } catch (err) {
      setIsFavorite(!next);
      onError?.(apiErrorMessage(err, 'עדכון המועדפים נכשל'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={onClick}
      disabled={busy}
      title={isFavorite ? 'הסר ממועדפים' : 'הוסף למועדפים'}
      aria-label={isFavorite ? 'הסר ממועדפים' : 'הוסף למועדפים'}
      aria-pressed={isFavorite}
      className={`p-1.5 rounded transition-colors shrink-0 ${isFavorite ? 'text-tertiary-container' : 'text-on-surface-variant hover:bg-surface-container-highest'}`}
    >
      <span className="material-symbols-outlined text-[18px]" style={isFavorite ? { fontVariationSettings: "'FILL' 1" } : undefined}>
        {isFavorite ? 'star' : 'star_border'}
      </span>
    </button>
  );
}

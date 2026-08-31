'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AppShell } from '../../components/app-shell';
import { FavoriteStar } from '../../components/favorite-star';
import { apiErrorMessage } from '../../lib/api';
import { FavoriteSummary, favoritesApi } from '../../lib/favorites-api';
import { useSession } from '../../lib/use-session';

/** Product-gaps batch, 2026-08-29 item 7. `FavoritesController.list()` already drops any entry whose target was deleted or whose read access has since been revoked, so every row here is guaranteed currently accessible — no additional filtering needed client-side. */
export default function FavoritesPage() {
  const session = useSession();
  const [favorites, setFavorites] = useState<FavoriteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    favoritesApi
      .list()
      .then(setFavorites)
      .catch((e) => setError(apiErrorMessage(e, 'שגיאה בטעינת המועדפים')));
  }, []);

  function onRemoved(id: string) {
    setFavorites((prev) => prev?.filter((f) => f.id !== id) ?? prev);
  }

  if (!session) return <div className="min-h-screen bg-background" />;

  return (
    <AppShell session={session} active="favorites">
      <div className="pb-4 border-b border-outline-variant mb-6">
        <h2 className="font-display-lg text-display-lg text-on-surface">מועדפים</h2>
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

      {favorites === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      ) : favorites.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">
          אין פריטים מועדפים עדיין. ניתן לסמן תיקיות ומסמכים ככוכב מתוך דפדפן המסמכים.
        </p>
      ) : (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant divide-y divide-outline-variant overflow-hidden shadow-sm">
          {favorites.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-4 h-row-height-standard hover:bg-surface-container-high transition-colors">
              <Link href={`/folders/${f.folderId}`} className="flex items-center gap-3 flex-1 min-w-0">
                <span className="material-symbols-outlined text-on-surface-variant shrink-0">
                  {f.targetType === 'folder' ? 'folder' : 'description'}
                </span>
                <span className="font-body-md text-body-md text-on-surface truncate">{f.name}</span>
              </Link>
              <FavoriteStar
                targetType={f.targetType}
                targetId={f.targetId}
                initialFavorite
                onToggled={(isFavorite) => {
                  if (!isFavorite) onRemoved(f.id);
                }}
                onError={setError}
              />
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

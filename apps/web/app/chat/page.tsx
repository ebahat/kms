'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../components/app-shell';
import { apiErrorMessage } from '../../lib/api';
import { chatApi, ConversationSummary } from '../../lib/chat-api';
import { useSession } from '../../lib/use-session';

/** UI spec B6's conversation-list half — view/resume/delete (PRD §10). */
export default function ChatListPage() {
  const session = useSession();
  const router = useRouter();
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    chatApi
      .listConversations()
      .then(setConversations)
      .catch((e) => setError(apiErrorMessage(e, 'שגיאה בטעינת השיחות')));
  }, []);

  async function onNewConversation() {
    setCreating(true);
    setError(null);
    try {
      const created = await chatApi.createConversation();
      router.push(`/chat/${created.id}`);
    } catch (e) {
      setError(apiErrorMessage(e, 'יצירת שיחה נכשלה'));
    } finally {
      setCreating(false);
    }
  }

  async function onDelete(id: string) {
    setDeletingId(id);
    setError(null);
    try {
      await chatApi.deleteConversation(id);
      setConversations((prev) => prev?.filter((c) => c.id !== id) ?? null);
    } catch (e) {
      setError(apiErrorMessage(e, 'מחיקת השיחה נכשלה'));
    } finally {
      setDeletingId(null);
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;

  return (
    <AppShell session={session} active="chat">
      <div className="flex justify-between items-end pb-4 border-b border-outline-variant mb-6">
        <h2 className="font-display-lg text-display-lg text-on-surface">צ'אט</h2>
        <button
          onClick={onNewConversation}
          disabled={creating}
          className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          שיחה חדשה
        </button>
      </div>

      {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-4 font-body-sm text-body-sm">{error}</p>}

      {conversations === null ? (
        <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
      ) : conversations.length === 0 ? (
        <p className="font-body-md text-body-md text-on-surface-variant">אין שיחות עדיין. התחילו שיחה חדשה כדי לשאול שאלה על המסמכים שלכם.</p>
      ) : (
        <div className="bg-surface-container-lowest rounded-lg border border-outline-variant divide-y divide-outline-variant overflow-hidden shadow-sm">
          {conversations.map((c) => (
            <div key={c.id} className="flex items-center gap-3 px-4 h-row-height-standard hover:bg-surface-container-high transition-colors group">
              <Link href={`/chat/${c.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <span className="material-symbols-outlined text-tertiary-container" style={{ fontVariationSettings: "'FILL' 1" }}>
                  chat_bubble
                </span>
                <span className="font-body-md text-body-md text-on-surface truncate">{c.title}</span>
              </Link>
              <button
                onClick={() => onDelete(c.id)}
                disabled={deletingId === c.id}
                className="opacity-0 group-hover:opacity-100 text-on-surface-variant hover:text-error transition-opacity p-1.5 rounded-DEFAULT hover:bg-error-container disabled:opacity-60"
                aria-label="מחק שיחה"
              >
                <span className="material-symbols-outlined text-[18px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </AppShell>
  );
}

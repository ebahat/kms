'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { AppShell } from '../../../components/app-shell';
import { ChatAnswer } from '../../../components/chat-answer';
import { ApiError, apiErrorMessage } from '../../../lib/api';
import { chatApi, ChatMessageSummary, Citation } from '../../../lib/chat-api';
import { useSession } from '../../../lib/use-session';

type DisplayMessage = ChatMessageSummary | { id: string; role: 'assistant'; content: string; citations: Citation[]; ts: Date; streaming: true };

/** UI spec B6's thread half — streaming answers, citations, the "not found" first-class state, rate-limit/budget banners (PRD §10). */
export default function ChatThreadPage() {
  const session = useSession();
  const params = useParams<{ id: string }>();
  const conversationId = params.id;

  const [messages, setMessages] = useState<DisplayMessage[] | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limitBanner, setLimitBanner] = useState<{ code: string; message: string } | null>(null);
  const streamedTextRef = useRef('');

  useEffect(() => {
    chatApi
      .listMessages(conversationId)
      .then(setMessages)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 404) setNotFound(true);
        else setError(apiErrorMessage(e, 'שגיאה בטעינת השיחה'));
      });
  }, [conversationId]);

  async function onSend() {
    const text = input.trim();
    if (!text || sending) return;

    setInput('');
    setSending(true);
    setError(null);
    setLimitBanner(null);
    streamedTextRef.current = '';

    const userMessage: DisplayMessage = { id: `local-${Date.now()}`, role: 'user', content: text, citations: [], ts: new Date() };
    const assistantId = `streaming-${Date.now()}`;
    setMessages((prev) => [
      ...(prev ?? []),
      userMessage,
      { id: assistantId, role: 'assistant', content: '', citations: [], ts: new Date(), streaming: true },
    ]);

    await chatApi.streamMessage(conversationId, text, {
      onToken: (token) => {
        streamedTextRef.current += token;
        setMessages((prev) => (prev ?? []).map((m) => (m.id === assistantId ? { ...m, content: streamedTextRef.current } : m)));
      },
      onDone: (payload) => {
        setMessages((prev) =>
          (prev ?? []).map((m) =>
            m.id === assistantId ? { id: payload.messageId, role: 'assistant', content: streamedTextRef.current, citations: payload.citations, ts: new Date() } : m,
          ),
        );
        setSending(false);
      },
      onError: (e) => {
        setMessages((prev) => (prev ?? []).filter((m) => m.id !== assistantId));
        if (e instanceof ApiError && (e.body as { error?: string })?.error === 'RATE_LIMITED') {
          setLimitBanner({ code: 'RATE_LIMITED', message: 'הגעת למגבלת ההודעות השעתית. נסו שוב בעוד זמן קצר.' });
        } else if (e instanceof ApiError && (e.body as { error?: string })?.error === 'BUDGET_EXHAUSTED') {
          setLimitBanner({ code: 'BUDGET_EXHAUSTED', message: 'תקציב הצ\'אט של הארגון מוצה לתקופה הנוכחית. חיפוש במסמכים עדיין זמין.' });
        } else {
          setError(apiErrorMessage(e, 'שליחת ההודעה נכשלה'));
        }
        setSending(false);
      },
    });
  }

  async function onCitationClick(citation: Citation) {
    try {
      const resolved = await chatApi.citation(citation.chunkId);
      window.open(`/folders`, '_blank'); // no in-app document preview exists — resolved.documentId/documentName confirm the citation is still valid; full document viewing is the folder browser's job
      void resolved;
    } catch (e) {
      setError(apiErrorMessage(e, 'המסמך אינו נגיש עוד'));
    }
  }

  if (!session) return <div className="min-h-screen bg-background" />;

  if (notFound) {
    return (
      <AppShell session={session} active="chat">
        <p className="font-body-md text-body-md text-on-surface-variant">השיחה לא נמצאה.</p>
      </AppShell>
    );
  }

  return (
    <AppShell session={session} active="chat">
      <div className="flex flex-col h-[calc(100vh-var(--row-height-standard,56px)-4rem)]">
        <div className="flex-1 overflow-y-auto space-y-4 pb-4">
          {messages === null ? (
            <p className="font-body-md text-body-md text-on-surface-variant">טוען...</p>
          ) : (
            messages.map((m) => {
              const isNotFoundAnswer = m.role === 'assistant' && !('streaming' in m) && m.citations.length === 0 && m.content.length > 0;
              return (
                <div key={m.id} className={`flex ${m.role === 'user' ? 'justify-start' : 'justify-end'}`}>
                  <div
                    className={`max-w-2xl rounded-lg px-4 py-3 ${
                      m.role === 'user'
                        ? 'bg-primary-container text-on-primary-container'
                        : isNotFoundAnswer
                          ? 'bg-surface-container text-on-surface-variant border border-outline-variant'
                          : 'bg-surface-container-high text-on-surface'
                    }`}
                  >
                    {m.role === 'user' ? (
                      <p className="font-body-md text-body-md whitespace-pre-wrap">{m.content}</p>
                    ) : (
                      <ChatAnswer content={m.content || '…'} citations={m.citations} onCitationClick={onCitationClick} />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {limitBanner && (
          <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-2 font-body-sm text-body-sm">{limitBanner.message}</p>
        )}
        {error && <p className="bg-error-container text-on-error-container rounded-DEFAULT px-3 py-2.5 mb-2 font-body-sm text-body-sm">{error}</p>}

        <div className="flex gap-2 pt-2 border-t border-outline-variant">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSend()}
            disabled={sending || limitBanner?.code === 'BUDGET_EXHAUSTED'}
            placeholder="שאלו שאלה על המסמכים שלכם..."
            className="flex-1 px-3 py-2 border border-outline-variant rounded-DEFAULT text-body-md font-body-md bg-surface focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary disabled:opacity-60"
          />
          <button
            onClick={onSend}
            disabled={sending || !input.trim() || limitBanner?.code === 'BUDGET_EXHAUSTED'}
            className="bg-primary text-on-primary-dynamic font-title-sm text-title-sm py-2 px-4 rounded-DEFAULT flex items-center gap-2 hover:bg-primary-container hover:text-on-primary-container transition-colors disabled:opacity-60"
          >
            <span className="material-symbols-outlined text-sm">send</span>
            שלח
          </button>
        </div>
      </div>
    </AppShell>
  );
}

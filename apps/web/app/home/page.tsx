'use client';

import { AppShell } from '../../components/app-shell';
import { useSession } from '../../lib/use-session';

/**
 * Edition-driven navigation shell (ADR-0009 G2) — a KB tenant never sees OCR nav and vice versa.
 * Restyled onto AppShell (Phase B, 2026-08-22); the bento-grid "recent documents / processing
 * status / knowledge graph" placeholder cards from b1_app_shell are deliberately not built here —
 * none of that has real data behind it yet (documents indexing/chat are Phase 3/4).
 */
export default function HomePage() {
  const session = useSession();

  if (!session) return <div className="min-h-screen bg-background" />;

  return (
    <AppShell session={session} active={null}>
      <div className="max-w-3xl">
        <h2 className="font-display-lg text-display-lg text-on-surface mb-2">
          ברוך/ה הבא/ה{session.tenantName ? ` ל${session.tenantName}` : ''}
        </h2>
        <p className="font-body-md text-body-md text-on-surface-variant mb-6">
          מהדורת {session.edition === 'kb' ? 'ניהול ידע' : 'OCR חכם'}.
        </p>
      </div>
    </AppShell>
  );
}

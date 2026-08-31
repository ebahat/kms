'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { tenantApi } from '../lib/api';
import type { SessionInfo } from '../lib/use-session';

export type NavKey = 'folders' | 'groups' | 'chat' | 'favorites' | 'queue' | 'admin';

type NavItem = {
  key: NavKey;
  label: string;
  icon: string;
  href?: string; // omitted for not-yet-built screens (processing queue — Phase 3/4; chat and favorites now built)
};

const NAV_ITEMS: NavItem[] = [
  { key: 'folders', label: 'דפדפן מסמכים', icon: 'folder_open', href: '/folders' },
  { key: 'chat', label: "צ'אט", icon: 'chat_bubble', href: '/chat' },
  { key: 'favorites', label: 'מועדפים', icon: 'star', href: '/favorites' },
  { key: 'queue', label: 'תור עיבוד', icon: 'slow_motion_video' },
  // Moved to the end, grouped visually next to the admin-only users link below (2026-08-30 —
  // mirrors the stitch mockup's grouping of group/user management together, short of building
  // the mockup's full expand/collapse nesting).
  { key: 'groups', label: 'קבוצות', icon: 'group', href: '/groups' },
];

/**
 * Simple relative-luminance check (WCAG-style), not a full contrast-ratio calculation — good
 * enough to avoid the real failure mode this guards against (a light superuser-chosen theme color
 * producing illegible white-on-white buttons), see the Phase C plan's C1.4 "contrast risk" note.
 */
function computeOnPrimaryColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.5 ? '#000000' : '#ffffff';
}

/**
 * Design-token app shell (Phase B, docs/plans/master-gaps-design-superuser-22-08-2026-plan.md) —
 * matches stitch_automated_document_reviewer/b1_app_shell's sidebar+header structure, real data
 * (tenantName from /auth/session) instead of mock placeholders. Search and the language switch
 * are visual chrome only, matching the mockups themselves — neither has real behavior specified
 * or built anywhere in this app yet.
 *
 * Phase C (C1.3/C1.4) added tenant branding: a superuser-uploaded logo (replacing the generic
 * "domain" icon when set) and a per-tenant theme color, applied by overriding --color-primary
 * (and the paired --color-on-primary-dynamic, computed for contrast safety) on this root element
 * — every bg-primary/text-on-primary-dynamic descendant utility inherits it automatically, with
 * zero changes needed to any consuming screen beyond switching text-on-primary to
 * text-on-primary-dynamic where it's paired with bg-primary.
 */
export function AppShell({ session, active, children }: { session: SessionInfo; active: NavKey | null; children: React.ReactNode }) {
  const router = useRouter();

  async function onLogout() {
    await tenantApi.post('/auth/logout');
    router.push('/login');
  }

  const themeStyle = session.themeColorRgb
    ? ({ '--color-primary': session.themeColorRgb, '--color-on-primary-dynamic': computeOnPrimaryColor(session.themeColorRgb) } as React.CSSProperties)
    : undefined;

  return (
    <div className="min-h-screen flex bg-background" dir="rtl" style={themeStyle}>
      <nav className="hidden md:flex flex-col bg-surface-container-low border-l border-outline-variant fixed right-0 top-0 h-screen w-nav-width-expanded pt-4 z-40">
        <div className="px-container-padding pb-6 mb-2 border-b border-outline-variant flex items-center gap-3">
          {session.logoUrl ? (
            // Plain <img>, not next/image: the signed URL is short-lived (5 min, ADR-0006) and
            // re-issued every session load, not a build-time-known static asset next/image can cache.
            <img src={session.logoUrl} alt="" className="w-10 h-10 rounded-lg object-contain shrink-0 bg-surface-container-lowest" />
          ) : (
            <div className="w-10 h-10 rounded-lg bg-primary-container flex items-center justify-center text-on-primary-container shrink-0">
              <span className="material-symbols-outlined">domain</span>
            </div>
          )}
          <div className="min-w-0">
            <h2 className="font-title-sm text-title-sm text-on-surface truncate">{session.tenantName || 'הארגון שלי'}</h2>
            <p className="font-label-xs text-label-xs text-on-surface-variant">ניהול ידע ארגוני</p>
          </div>
        </div>

        {session.edition === 'kb' && (
          <div className="flex-1 overflow-y-auto px-4 flex flex-col gap-1 pt-4">
            {NAV_ITEMS.map((item) => {
              const isActive = item.key === active;
              const content = (
                <>
                  <span className="material-symbols-outlined" style={isActive ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                    {item.icon}
                  </span>
                  <span>{item.label}</span>
                </>
              );
              const className = isActive
                ? 'flex items-center gap-3 px-4 h-row-height-standard bg-secondary-container text-on-secondary-container font-bold rounded-lg'
                : 'flex items-center gap-3 px-4 h-row-height-standard text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors';

              return item.href ? (
                <Link key={item.key} href={item.href} className={className}>
                  {content}
                </Link>
              ) : (
                <span key={item.key} className={className.replace('hover:bg-surface-container-high', '') + ' opacity-60 cursor-default'} title="בקרוב">
                  {content}
                </span>
              );
            })}
            {session.role === 'admin' && (
              <Link
                href="/users"
                className={
                  active === 'admin'
                    ? 'flex items-center gap-3 px-4 h-row-height-standard bg-secondary-container text-on-secondary-container font-bold rounded-lg'
                    : 'flex items-center gap-3 px-4 h-row-height-standard text-on-surface-variant hover:bg-surface-container-high rounded-lg transition-colors'
                }
              >
                <span className="material-symbols-outlined" style={active === 'admin' ? { fontVariationSettings: "'FILL' 1" } : undefined}>
                  admin_panel_settings
                </span>
                <span>משתמשים</span>
              </Link>
            )}
          </div>
        )}
        {session.edition === 'ocr' && (
          <div className="flex-1 px-4 pt-4">
            <span className="flex items-center gap-3 px-4 h-row-height-standard text-on-surface-variant opacity-60">
              <span className="material-symbols-outlined">document_scanner</span>
              <span>סריקת OCR</span>
            </span>
          </div>
        )}

        <div className="p-4 mt-auto">
          <button
            onClick={onLogout}
            className="w-full border border-outline-variant text-on-surface font-title-sm text-title-sm h-row-height-standard rounded-DEFAULT flex items-center justify-center gap-2 hover:bg-surface-container-high transition-colors"
          >
            <span className="material-symbols-outlined text-sm">logout</span>
            יציאה
          </button>
        </div>
      </nav>

      <div className="flex-1 flex flex-col md:mr-nav-width-expanded min-h-screen">
        <header className="bg-surface-container shadow-sm flex flex-row-reverse justify-between items-center w-full px-container-padding h-row-height-standard sticky top-0 z-30 border-b border-outline-variant">
          <div className="flex items-center gap-4 flex-row-reverse">
            <div className="relative hidden md:block w-64">
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-on-surface-variant text-[20px]">search</span>
              <input
                readOnly
                className="w-full pr-9 pl-3 h-9 bg-surface-container-low border border-outline-variant rounded-DEFAULT text-body-sm font-body-sm text-on-surface-variant placeholder:text-on-surface-variant"
                placeholder="חיפוש..."
                type="text"
              />
            </div>
            <div className="h-6 w-px bg-outline-variant" />
            <span className="text-on-surface-variant font-title-sm text-title-sm px-2">עברית / English</span>
          </div>
          <h1 className="font-headline-md text-headline-md text-primary">Enterprise Knowledge Base</h1>
        </header>
        <main className="flex-1 p-container-padding overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}

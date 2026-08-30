'use client';

import Link from 'next/link';

/**
 * Circular icon back-button (2026-08-29, from the c1.2_updated_group_controls Stitch mockup) —
 * replaces the plain breadcrumb text link previously used on detail/edit screens. `arrow_forward`
 * is deliberate, not a typo: this app is RTL-only (Hebrew-first), and in RTL "back" points toward
 * the trailing edge, i.e. visually rightward — the same direction `arrow_forward` renders.
 */
export function BackButton({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      aria-label={label}
      title={label}
      className="text-on-surface-variant hover:bg-surface-container-high rounded-full w-8 h-8 flex items-center justify-center transition-colors shrink-0"
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        arrow_forward
      </span>
    </Link>
  );
}

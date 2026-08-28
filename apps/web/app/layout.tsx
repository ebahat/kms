import './globals.css';

export const metadata = {
  title: 'KMS',
};

/**
 * Hebrew-first, RTL default (UI spec §screens A1-A4). Also serves the
 * platform-admin portal on the admin.… hostname (ADR-0004, design review
 * finding 8) — the /admin/* routes share this same root layout.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <head>
        {/* Design-token system (Phase B, docs/plans/master-gaps-design-superuser-22-08-2026-plan.md)
            — plain <link> tags rather than next/font/google to match the approved Stitch mockups'
            own loading method exactly and avoid a build-time network dependency. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Courier+Prime&display=swap" rel="stylesheet" />
        <link href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:wght,FILL@100..700,0..1&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}

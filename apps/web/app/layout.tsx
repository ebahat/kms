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
      <body>{children}</body>
    </html>
  );
}

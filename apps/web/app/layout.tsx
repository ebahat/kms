export const metadata = {
  title: 'KMS',
};

/**
 * Hebrew-first, RTL default (UI spec). Direction/locale switching lands
 * with the P0 login screens in Phase 1.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="he" dir="rtl">
      <body>{children}</body>
    </html>
  );
}

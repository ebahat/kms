import { redirect } from 'next/navigation';

/** Tenant hostname root — the admin hostname never reaches this file (middleware.ts rewrites it to /admin/home). */
export default function RootPage() {
  redirect('/login');
}

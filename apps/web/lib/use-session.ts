'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { tenantApi } from './api';

export type SessionInfo = { role: 'user' | 'admin'; edition: 'kb' | 'ocr' };

/** Same whoami + redirect-on-401 pattern as app/home/page.tsx, extracted since folders/groups screens all need it. */
export function useSession(): SessionInfo | null {
  const router = useRouter();
  const [session, setSession] = useState<SessionInfo | null>(null);

  useEffect(() => {
    tenantApi
      .get<SessionInfo>('/auth/session')
      .then(setSession)
      .catch(() => router.push('/login'));
  }, [router]);

  return session;
}

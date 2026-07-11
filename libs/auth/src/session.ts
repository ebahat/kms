export type Realm = 'tenant' | 'platform';

export type SessionRecord = {
  userId: string;
  tenantId?: string; // absent for platform realm
  role: 'user' | 'admin';
  edition?: 'kb' | 'ocr'; // absent for platform realm
  createdAt: string; // ISO — absolute-lifetime clock
  lastSeenAt: string; // ISO — idle clock
  mfaVerified: boolean;
};

export const REALM_COOKIE_NAME: Record<Realm, string> = {
  tenant: '__Host-kms_sess',
  platform: '__Host-kms_padm',
};

export const REALM_CLOCKS: Record<Realm, { idleMs: number; absoluteMs: number }> = {
  tenant: { idleMs: 30 * 60_000, absoluteMs: 12 * 60 * 60_000 },
  platform: { idleMs: 15 * 60_000, absoluteMs: 12 * 60 * 60_000 },
};

export function sessionKey(realm: Realm, sessionId: string): string {
  return `sess:${realm}:${sessionId}`;
}

export function userSessionIndexKey(realm: Realm, userId: string): string {
  return `user-sess:${realm}:${userId}`;
}

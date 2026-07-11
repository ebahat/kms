import { Types } from 'mongoose';

/**
 * The platform-admin realm's identity contract — deliberately NOT the
 * tenant Scope type (ADR-0004): a platform admin has no tenantId, no
 * edition, no role beyond "platform admin." Kept in its own CLS namespace so
 * a portal session can never be mistaken for a tenant scope (or vice versa).
 */
export type PlatformScope = {
  adminId: Types.ObjectId;
};

export const PLATFORM_SCOPE_CLS_KEY = 'platformScope' as const;

export function platformScopeFromId(adminId: string): PlatformScope {
  return { adminId: new Types.ObjectId(adminId) };
}

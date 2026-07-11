import { Types } from 'mongoose';

/**
 * The complete per-request identity contract (ADR-0001).
 * Downstream consumers read only these fields — anything else a handler
 * needs is data, not scope.
 */
export type Scope = {
  tenantId: Types.ObjectId;
  userId: Types.ObjectId;
  role: 'user' | 'admin';
  edition: 'kb' | 'ocr';
  ownerUserId?: Types.ObjectId;
};

export const SCOPE_CLS_KEY = 'scope' as const;

/**
 * The only place a string-id session record becomes a typed Scope — kept
 * here (not in libs/auth) because only libs/data may import mongoose
 * (ADR-0001). Callers (the auth guard) pass plain strings from the session.
 */
export function scopeFromIds(data: {
  userId: string;
  tenantId: string;
  role: Scope['role'];
  edition: Scope['edition'];
  ownerUserId?: string;
}): Scope {
  return {
    userId: new Types.ObjectId(data.userId),
    tenantId: new Types.ObjectId(data.tenantId),
    role: data.role,
    edition: data.edition,
    ownerUserId: data.ownerUserId ? new Types.ObjectId(data.ownerUserId) : undefined,
  };
}

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/**
 * Tenant-realm audit trail (ADR-0002 "Audit store", sec §8.1) — append-only
 * by construction: AuditEventsRepository exposes only `record`/`find*`, no
 * update or delete method exists to call. `ts` (not `createdAt`) matches the
 * ADR's own field name and its `{tenantId, ts}` index.
 *
 * ADR-0002 also specifies a platform-realm variant (`scope: 'platform'`,
 * `tenantId: null`, indexed `{scope, ts}`) for portal-api actions — not
 * built here since nothing consumes it yet; portal-api's audit today is
 * log-only (PlatformAudit logger). Add it when that becomes real.
 */
@Schema({ collection: 'auditEvents', timestamps: { createdAt: 'ts', updatedAt: false } })
export class AuditEvent {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  actorUserId!: Types.ObjectId;

  /** e.g. "document.download" — a short, stable, dot-namespaced action string (PRD §12 coverage list). */
  @Prop({ required: true, trim: true })
  action!: string;

  @Prop({ type: Types.ObjectId, default: null })
  targetId!: Types.ObjectId | null;

  @Prop({ type: Object, default: {} })
  metadata!: Record<string, unknown>;
}

export type AuditEventDocument = HydratedDocument<AuditEvent> & { _id: Types.ObjectId };
export const AuditEventSchema = SchemaFactory.createForClass(AuditEvent);
AuditEventSchema.index({ tenantId: 1, ts: 1 });
AuditEventSchema.plugin(tenantScopeBackstopPlugin);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * The tenant registry itself (ADR-0002). NOT tenant-scoped — a tenant document
 * has no tenantId to scope by, it IS the tenant. Managed only from the
 * platform-admin realm (PRD §5) via TenantsRepository, which is a plain
 * (non-ScopedRepository) wrapper — deliberately, since ScopedRepository's
 * contract assumes every document carries a tenantId.
 */
@Schema({ collection: 'tenants', timestamps: true })
export class Tenant {
  @Prop({ required: true })
  name!: string;

  @Prop({ required: true, enum: ['kb', 'ocr'], default: 'kb' })
  edition!: 'kb' | 'ocr';

  @Prop({ required: true, enum: ['active', 'suspended'], default: 'active' })
  status!: 'active' | 'suspended';

  @Prop({ required: true, default: 1_073_741_824 }) // 1 GiB default (PRD §4)
  storageQuotaBytes!: number;

  @Prop({ type: [String], default: [] })
  featureToggles!: string[];

  @Prop()
  tosVersion?: string;

  /**
   * Unique DNS label for real per-tenant subdomain routing (Phase C, ADR pending — see
   * docs/plans/superuser-subdomain-provisioning-22-08-2026-plan.md C1.1/C2). Optional so every
   * tenant created before this field existed keeps working unrouted; enforced unique at the API
   * layer (reserved-word + uniqueness checks) as well as by the sparse index below.
   */
  @Prop({ trim: true, lowercase: true })
  subdomain?: string;

  /** Object Storage key for the tenant's branding logo (Phase C, C1.3) — same bucket/provider as documents. */
  @Prop()
  logoObjectKey?: string;

  /** '#rrggbb' branding color (Phase C, C1.4) — validated by zod on write, never trusted raw from the DB on read. */
  @Prop()
  themeColorRgb?: string;
}

export type TenantDocument = HydratedDocument<Tenant> & { _id: Types.ObjectId };
export const TenantSchema = SchemaFactory.createForClass(Tenant);
// sparse: the many tenants with no subdomain set (subdomain: undefined) must not collide with
// each other under a unique index — sparse unique indexes ignore documents missing the field.
TenantSchema.index({ subdomain: 1 }, { unique: true, sparse: true });

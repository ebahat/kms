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
}

export type TenantDocument = HydratedDocument<Tenant> & { _id: Types.ObjectId };
export const TenantSchema = SchemaFactory.createForClass(Tenant);

import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/** Tenant user groups grantable on folders (PRD §7, ADR-0002/0005). */
@Schema({ collection: 'groups', timestamps: true })
export class Group {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  @Prop({ required: true, type: [Types.ObjectId], default: [] })
  memberUserIds!: Types.ObjectId[];
}

export type GroupDocument = HydratedDocument<Group> & { _id: Types.ObjectId };
export const GroupSchema = SchemaFactory.createForClass(Group);
GroupSchema.index({ tenantId: 1 });
GroupSchema.plugin(tenantScopeBackstopPlugin);

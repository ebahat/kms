import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

/** A member's role within one group — caps whatever tier a folder grants that group (never widens
 * it), per the user-management plan (2026-08-24). Maps 1:1 onto the folder access tiers. */
export type GroupMemberRole = 'viewer' | 'editor' | 'manager';

export class GroupMember {
  @Prop({ required: true, type: Types.ObjectId })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: ['viewer', 'editor', 'manager'] })
  role!: GroupMemberRole;
}

/** Tenant user groups grantable on folders (PRD §7, ADR-0002/0005). */
@Schema({ collection: 'groups', timestamps: true })
export class Group {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, trim: true })
  name!: string;

  /**
   * Replaces the flat `memberUserIds: ObjectId[]` (2026-08-24, user-management plan) — each member
   * now carries a role. `$addToSet` cannot be used to add/update these (two objects for the same
   * userId with different roles are distinct values to Mongo) — see GroupsRepository.setMember()'s
   * explicit $pull-then-$push instead.
   */
  @Prop({ required: true, type: [GroupMember], default: [] })
  members!: GroupMember[];
}

export type GroupDocument = HydratedDocument<Group> & { _id: Types.ObjectId };
export const GroupSchema = SchemaFactory.createForClass(Group);
GroupSchema.index({ tenantId: 1 });
GroupSchema.index({ tenantId: 1, 'members.userId': 1 });
// Defense-in-depth alongside GroupsController's own pre-write check: two groups with the same
// name in the same tenant must never exist, even under a race between two concurrent creates.
GroupSchema.index({ tenantId: 1, name: 1 }, { unique: true });
GroupSchema.plugin(tenantScopeBackstopPlugin);

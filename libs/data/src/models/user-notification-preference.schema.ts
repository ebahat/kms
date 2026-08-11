import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { tenantScopeBackstopPlugin } from '../backstop.plugin';

export type PreferenceScope = 'off' | 'mine' | 'all';

export const NOTIFICATION_PREFERENCE_FIELDS = [
  'fileAdded',
  'fileDeleted',
  'taskAdded',
  'taskDeleted',
  'taskStatusChanged',
] as const;

export type NotificationPreferenceField = (typeof NOTIFICATION_PREFERENCE_FIELDS)[number];

/** One document per user, all fields default 'off' — opt-in (Phase 2A design, decision 9). */
@Schema({ collection: 'userNotificationPreferences', timestamps: true })
export class UserNotificationPreference {
  @Prop({ required: true, type: Types.ObjectId })
  tenantId!: Types.ObjectId;

  @Prop({ required: true, type: Types.ObjectId })
  userId!: Types.ObjectId;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  fileAdded!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  fileDeleted!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  taskAdded!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  taskDeleted!: PreferenceScope;

  @Prop({ required: true, enum: ['off', 'mine', 'all'], default: 'off' })
  taskStatusChanged!: PreferenceScope;
}

export type UserNotificationPreferenceDocument = HydratedDocument<UserNotificationPreference> & { _id: Types.ObjectId };
export const UserNotificationPreferenceSchema = SchemaFactory.createForClass(UserNotificationPreference);
UserNotificationPreferenceSchema.index({ tenantId: 1, userId: 1 }, { unique: true });
UserNotificationPreferenceSchema.plugin(tenantScopeBackstopPlugin);

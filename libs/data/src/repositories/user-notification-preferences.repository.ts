import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClsService } from 'nestjs-cls';
import { Model, Types } from 'mongoose';
import { ScopedRepository } from '../scoped-repository';
import {
  NotificationPreferenceField,
  PreferenceScope,
  UserNotificationPreference,
  UserNotificationPreferenceDocument,
} from '../models/user-notification-preference.schema';

@Injectable()
export class UserNotificationPreferencesRepository extends ScopedRepository<UserNotificationPreference> {
  constructor(
    @InjectModel(UserNotificationPreference.name) model: Model<UserNotificationPreference>,
    cls: ClsService,
  ) {
    super(model, cls);
  }

  /**
   * Create-on-first-read. A single atomic upsert rather than find-then-create:
   * concurrent first reads for the same user would otherwise both insert and
   * one would violate the {tenantId,userId} unique index.
   */
  findOrCreateForUser(userId: Types.ObjectId): Promise<UserNotificationPreferenceDocument> {
    return this.model.findOneAndUpdate(
      { userId, ...this.scope() },
      {
        $setOnInsert: {
          fileAdded: 'off',
          fileDeleted: 'off',
          taskAdded: 'off',
          taskDeleted: 'off',
          taskStatusChanged: 'off',
        },
      },
      { upsert: true, new: true },
    ) as unknown as Promise<UserNotificationPreferenceDocument>;
  }

  /** Callers must have ensured the row exists (findOrCreateForUser) — this never upserts. */
  updateForUser(
    userId: Types.ObjectId,
    patch: Partial<Record<NotificationPreferenceField, PreferenceScope>>,
  ): Promise<UserNotificationPreferenceDocument | null> {
    return this.model.findOneAndUpdate(
      { userId, ...this.scope() },
      { $set: patch },
      { new: true },
    ) as unknown as Promise<UserNotificationPreferenceDocument | null>;
  }

  findAllWithPreference(
    field: NotificationPreferenceField,
    value: Exclude<PreferenceScope, 'off'>,
  ): Promise<UserNotificationPreferenceDocument[]> {
    return this.find({ [field]: value }) as unknown as Promise<UserNotificationPreferenceDocument[]>;
  }
}
import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { Edition } from '@kms/contracts';
import {
  NOTIFICATION_PREFERENCE_FIELDS,
  NotificationPreferenceField,
  PreferenceScope,
  SCOPE_CLS_KEY,
  Scope,
  UserNotificationPreferencesRepository,
} from '@kms/data';

const PREFERENCE_SCOPES: readonly PreferenceScope[] = ['off', 'mine', 'all'];

type PreferencePatch = Partial<Record<NotificationPreferenceField, PreferenceScope>>;

/** No `@Module` gate — core document notifications aren't an opt-in module (Phase 2A design). */
@Controller('users/me/notification-preferences')
@Edition('kb')
export class NotificationPreferencesController {
  constructor(
    private readonly cls: ClsService,
    private readonly preferences: UserNotificationPreferencesRepository,
  ) {}

  @Get()
  async get() {
    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    return this.preferences.findOrCreateForUser(scope.userId);
  }

  @Patch()
  async update(@Body() patch: Record<string, unknown>) {
    const entries = Object.entries(patch ?? {});
    if (entries.length === 0) {
      throw new BadRequestException('patch must include at least one preference field');
    }
    for (const [field, value] of entries) {
      if (!NOTIFICATION_PREFERENCE_FIELDS.includes(field as NotificationPreferenceField)) {
        throw new BadRequestException(`unknown preference field: ${field}`);
      }
      if (!PREFERENCE_SCOPES.includes(value as PreferenceScope)) {
        throw new BadRequestException(`invalid value for ${field}: ${String(value)}`);
      }
    }

    const scope = this.cls.get<Scope>(SCOPE_CLS_KEY)!;
    await this.preferences.findOrCreateForUser(scope.userId);
    return this.preferences.updateForUser(scope.userId, patch as PreferencePatch);
  }
}

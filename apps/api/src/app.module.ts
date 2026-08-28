import { Module } from '@nestjs/common';
import { APP_GUARD, DiscoveryModule } from '@nestjs/core';
import { MongooseModule } from '@nestjs/mongoose';
import { ClsModule } from 'nestjs-cls';
import {
  Tenant,
  TenantSchema,
  User,
  UserSchema,
  TenantsRepository,
  UsersRepository,
  Folder,
  FolderSchema,
  Group,
  GroupSchema,
  FoldersRepository,
  GroupsRepository,
  Document,
  DocumentSchema,
  DocumentVersion,
  DocumentVersionSchema,
  DocumentsRepository,
  DocumentVersionsRepository,
  Chunk,
  ChunkSchema,
  ChunksRepository,
  Conversation,
  ConversationSchema,
  ConversationsRepository,
  ChatMessage,
  ChatMessageSchema,
  ChatMessagesRepository,
  AuditEvent,
  AuditEventSchema,
  AuditEventsRepository,
  RecycleBinEntry,
  RecycleBinEntrySchema,
  RecycleBinEntriesRepository,
  DeletionVerification,
  DeletionVerificationSchema,
  DeletionVerificationsRepository,
  Event,
  EventSchema,
  EventsRepository,
  Task,
  TaskSchema,
  TasksRepository,
  UserNotificationPreference,
  UserNotificationPreferenceSchema,
  UserNotificationPreferencesRepository,
} from '@kms/data';
import { HealthController } from './health/health.controller';
import { AuthController } from './auth/auth.controller';
import { TenantUsersAdminController } from './tenant-admin/tenant-users-admin.controller';
import { UserLookupController } from './users/user-lookup.controller';
import { FoldersController } from './folders/folders.controller';
import { DocumentsController } from './documents/documents.controller';
import { DocumentsPermissionsService } from './documents/documents-permissions.service';
import { ChatController } from './chat/chat.controller';
import { embeddingProviderProvider as chatEmbeddingProviderProvider, chatProviderProvider, retrievalProviderProvider } from './chat/chat.providers';
import { EventsController } from './groups/events.controller';
import { TasksController } from './groups/tasks.controller';
import { CalendarController } from './groups/calendar.controller';
import { GroupsController } from './groups/groups.controller';
import { GroupsMembershipService } from './groups/groups-membership.service';
import { NotificationDispatchService } from './notifications/notification-dispatch.service';
import { NotificationPreferencesController } from './notifications/notification-preferences.controller';
import { storageProviderProvider, ingestionQueueProvider } from './documents/documents.providers';
import { notificationProviderProvider } from './notifications/notifications.providers';
import { SessionAuthGuard } from './auth/session-auth.guard';
import {
  passwordPepperProvider,
  kmsKeyProviderProvider,
  rateLimiterProvider,
  captchaVerifierProvider,
  securityAlertSinkProvider,
} from './auth/auth.providers';
import { MfaGateGuard } from './common/mfa-gate.guard';
import { TosGateGuard } from './common/tos-gate.guard';
import { EditionGuard } from './common/edition.guard';
import { ModuleGuard } from './common/module.guard';
import { AdminOnlyGuard } from './common/admin-only.guard';
import { redisAppProvider, sessionServiceProvider, permissionCacheProvider } from './redis.provider';

@Module({
  imports: [
    DiscoveryModule,
    ClsModule.forRoot({
      global: true,
      middleware: { mount: true },
    }),
    MongooseModule.forRoot(process.env.MONGO_URI ?? 'mongodb://localhost:27017/kms'),
    MongooseModule.forFeature([
      { name: Tenant.name, schema: TenantSchema },
      { name: User.name, schema: UserSchema },
      { name: Folder.name, schema: FolderSchema },
      { name: Group.name, schema: GroupSchema },
      { name: Document.name, schema: DocumentSchema },
      { name: DocumentVersion.name, schema: DocumentVersionSchema },
      { name: Chunk.name, schema: ChunkSchema },
      { name: Conversation.name, schema: ConversationSchema },
      { name: ChatMessage.name, schema: ChatMessageSchema },
      { name: AuditEvent.name, schema: AuditEventSchema },
      { name: RecycleBinEntry.name, schema: RecycleBinEntrySchema },
      { name: DeletionVerification.name, schema: DeletionVerificationSchema },
      { name: Event.name, schema: EventSchema },
      { name: Task.name, schema: TaskSchema },
      { name: UserNotificationPreference.name, schema: UserNotificationPreferenceSchema },
    ]),
    // Feature modules (chat, ...) register here starting later Phase 2/3 items.
  ],
  controllers: [
    HealthController,
    AuthController,
    TenantUsersAdminController,
    UserLookupController,
    FoldersController,
    GroupsController,
    DocumentsController,
    ChatController,
    EventsController,
    TasksController,
    CalendarController,
    NotificationPreferencesController,
  ],
  providers: [
    redisAppProvider,
    sessionServiceProvider,
    permissionCacheProvider,
    storageProviderProvider,
    ingestionQueueProvider,
    notificationProviderProvider,
    passwordPepperProvider,
    kmsKeyProviderProvider,
    rateLimiterProvider,
    captchaVerifierProvider,
    securityAlertSinkProvider,
    TenantsRepository,
    UsersRepository,
    FoldersRepository,
    GroupsRepository,
    DocumentsRepository,
    DocumentVersionsRepository,
    ChunksRepository,
    ConversationsRepository,
    ChatMessagesRepository,
    chatEmbeddingProviderProvider,
    chatProviderProvider,
    retrievalProviderProvider,
    AuditEventsRepository,
    RecycleBinEntriesRepository,
    DeletionVerificationsRepository,
    DocumentsPermissionsService,
    EventsRepository,
    TasksRepository,
    UserNotificationPreferencesRepository,
    GroupsMembershipService,
    NotificationDispatchService,
    AdminOnlyGuard,
    // Order matters: SessionAuthGuard populates the CLS scope (and the mfaVerified/
    // tosVersion flags); MfaGateGuard blocks the interim pre-TOTP session from
    // reaching anything but /auth/totp + logout; TosGateGuard routes a stale-ToS
    // user to re-acceptance; EditionGuard 404s a mismatched-edition route; ModuleGuard
    // 404s a route whose opt-in module isn't in the tenant's featureToggles last.
    { provide: APP_GUARD, useClass: SessionAuthGuard },
    { provide: APP_GUARD, useClass: MfaGateGuard },
    { provide: APP_GUARD, useClass: TosGateGuard },
    { provide: APP_GUARD, useClass: EditionGuard },
    { provide: APP_GUARD, useClass: ModuleGuard },
  ],
})
export class AppModule {}

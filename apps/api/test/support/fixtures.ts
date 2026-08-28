import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { FoldersRepository, GroupsRepository, EventsRepository, TasksRepository, SCOPE_CLS_KEY, Scope, newObjectId } from '@kms/data';
import { SessionService, REALM_COOKIE_NAME } from '@kms/auth';
import { CURRENT_TOS_VERSION } from '@kms/contracts';
import { SESSION_SERVICE } from '../../src/auth/session-auth.guard';

type ObjectId = ReturnType<typeof newObjectId>;

/**
 * Seeds fixture data the same way apps/api/src/bootstrap/seed.ts does: a
 * manually-set CLS scope around a real repository `.create()` call, not a
 * raw model insert — this exercises the same tenantScopeBackstopPlugin path
 * production code goes through, rather than bypassing it.
 */
export async function withScope<T>(cls: ClsService, scope: Scope, fn: () => Promise<T>): Promise<T> {
  return cls.run(async () => {
    cls.set(SCOPE_CLS_KEY, scope);
    return fn();
  });
}

export function scopeFor(tenantId: ObjectId, userId: ObjectId): Scope {
  return { tenantId, userId, role: 'admin', edition: 'kb', featureToggles: ['calendar', 'kanban'] };
}

type GroupMemberRole = 'viewer' | 'editor' | 'manager';

/**
 * `memberUserIds` (pre-2026-08-24) stays supported for every existing call site, defaulting each
 * id to `manager` — the uncapped tier, preserving exactly the old "every member gets whatever the
 * group is granted" behavior. Pass `members` directly when a test needs specific per-member roles
 * (e.g. the permission-matrix suite's viewer/editor/manager capping cases).
 */
export async function seedGroup(
  app: INestApplication,
  opts: { tenantId: ObjectId; memberUserIds?: ObjectId[]; members?: { userId: ObjectId; role: GroupMemberRole }[]; name?: string },
) {
  const cls = app.get(ClsService);
  const groups = app.get(GroupsRepository);
  const members = opts.members ?? (opts.memberUserIds ?? []).map((userId) => ({ userId, role: 'manager' as const }));
  return withScope(cls, scopeFor(opts.tenantId, members[0]?.userId ?? newObjectId()), () =>
    groups.create({ name: opts.name ?? 'Test Group', members }),
  );
}

export async function seedEvent(
  app: INestApplication,
  opts: { tenantId: ObjectId; groupId: ObjectId; createdBy: ObjectId; title?: string },
) {
  const cls = app.get(ClsService);
  const events = app.get(EventsRepository);
  return withScope(cls, scopeFor(opts.tenantId, opts.createdBy), () =>
    events.create({
      groupId: opts.groupId,
      title: opts.title ?? 'Test Event',
      startAt: new Date('2026-09-01T09:00:00Z'),
      endAt: new Date('2026-09-01T10:00:00Z'),
      createdBy: opts.createdBy,
    }),
  );
}

export async function seedTask(
  app: INestApplication,
  opts: { tenantId: ObjectId; groupId: ObjectId; createdBy: ObjectId; title?: string },
) {
  const cls = app.get(ClsService);
  const tasks = app.get(TasksRepository);
  return withScope(cls, scopeFor(opts.tenantId, opts.createdBy), () =>
    tasks.create({
      groupId: opts.groupId,
      title: opts.title ?? 'Test Task',
      column: 'todo',
      createdBy: opts.createdBy,
    }),
  );
}

/**
 * Seeds a folder via FoldersRepository.createFolder() (real depth/cardinality checks, real path
 * computation) — not a raw model insert. `isPublic`/`grants` are applied as follow-up repository
 * calls (upsertGrant/setPublic) so hasExplicitGrants flips exactly the way the real controller
 * routes would flip it, for the Phase 2 UI plan's permission-matrix suite (Task 7).
 */
export async function seedFolder(
  app: INestApplication,
  opts: {
    tenantId: ObjectId;
    parentId?: ObjectId | null;
    name?: string;
    isPublic?: boolean;
    grants?: { principalType: 'user' | 'group'; principalId: ObjectId; access: 'read' | 'edit' | 'manage' }[];
  },
) {
  const cls = app.get(ClsService);
  const folders = app.get(FoldersRepository);
  const scope = scopeFor(opts.tenantId, newObjectId());

  return withScope(cls, scope, async () => {
    const folder = await folders.createFolder({ name: opts.name ?? 'Test Folder', parentId: opts.parentId ?? null });
    if (opts.isPublic) await folders.setPublic(folder._id, true);
    if (opts.grants) {
      for (const grant of opts.grants) await folders.upsertGrant(folder._id, grant);
    }
    return (await folders.findById(folder._id))!;
  });
}

export interface SessionFixture {
  userId: ObjectId;
  tenantId: ObjectId;
  role?: 'user' | 'admin';
  edition?: 'kb' | 'ocr';
  featureToggles?: string[];
  mfaVerified?: boolean;
  tosVersion?: string;
}

/** Mints a real session in the fake redis-app and returns the cookie header value to attach to a supertest request. */
export async function mintSessionCookie(app: INestApplication, fixture: SessionFixture): Promise<string> {
  const sessions = app.get<SessionService>(SESSION_SERVICE);
  const sessionId = await sessions.create('tenant', {
    userId: fixture.userId.toString(),
    tenantId: fixture.tenantId.toString(),
    role: fixture.role ?? 'user',
    edition: fixture.edition ?? 'kb',
    featureToggles: fixture.featureToggles ?? ['calendar', 'kanban'],
    mfaVerified: fixture.mfaVerified ?? true,
    tosVersion: fixture.tosVersion ?? CURRENT_TOS_VERSION,
  });
  return `${REALM_COOKIE_NAME.tenant}=${sessionId}`;
}

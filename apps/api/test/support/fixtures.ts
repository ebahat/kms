import { INestApplication } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import { GroupsRepository, EventsRepository, TasksRepository, SCOPE_CLS_KEY, Scope, newObjectId } from '@kms/data';
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
async function withScope<T>(cls: ClsService, scope: Scope, fn: () => Promise<T>): Promise<T> {
  return cls.run(async () => {
    cls.set(SCOPE_CLS_KEY, scope);
    return fn();
  });
}

function scopeFor(tenantId: ObjectId, userId: ObjectId): Scope {
  return { tenantId, userId, role: 'admin', edition: 'kb', featureToggles: ['calendar', 'kanban'] };
}

export async function seedGroup(
  app: INestApplication,
  opts: { tenantId: ObjectId; memberUserIds: ObjectId[]; name?: string },
) {
  const cls = app.get(ClsService);
  const groups = app.get(GroupsRepository);
  return withScope(cls, scopeFor(opts.tenantId, opts.memberUserIds[0] ?? newObjectId()), () =>
    groups.create({ name: opts.name ?? 'Test Group', memberUserIds: opts.memberUserIds }),
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

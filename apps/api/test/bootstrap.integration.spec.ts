import { assertEditionCoverage } from '../src/common/assert-edition-coverage';
import { buildTestApp, closeTestApp, TestAppContext } from './support/test-app';

/**
 * Retro action 1 (2026-08-21 deploy retro): `main.ts`'s real bootstrap() calls
 * assertEditionCoverage() before listen(), but buildTestApp() (used by every other integration
 * spec) never did — so a controller missing @Edition()/@EditionExempt() only ever failed at real
 * production boot, not in CI. That's exactly what happened 2026-08-19 with
 * Folders/Groups/Events/Tasks/Calendar/NotificationPreferences controllers. This test closes that
 * gap by calling the same assertion against the same real app instance every other integration
 * spec already builds.
 */
describe('bootstrap (ADR-0009 G2 edition coverage)', () => {
  let ctx: TestAppContext;

  afterEach(async () => {
    if (ctx) await closeTestApp(ctx);
  });

  it('assertEditionCoverage does not throw against the real, fully-wired AppModule', async () => {
    ctx = await buildTestApp();
    await expect(assertEditionCoverage(ctx.app)).resolves.toBeUndefined();
  }, 30_000); // default 5s is too tight once run alongside every other integration suite's own MongoMemoryServer instance under parallel Jest workers (document-chat-rag plan — one more suite added to that parallel mix, found this flake surface)
});

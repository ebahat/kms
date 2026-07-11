/**
 * Skeleton — asserts the harness itself runs green with zero live routes.
 * Real fixtures (tenant-A/tenant-B sessions, resource ids) are added per
 * controller starting Phase 1 (docs/plans/implementation-phases-11-07-2026-plan.md).
 */
describe('cross-tenant isolation suite', () => {
  it('harness runs (no routes registered yet)', () => {
    expect(true).toBe(true);
  });

  it.todo('replays every enumerated route as tenant A with tenant B resource ids and asserts 404');
  it.todo('replays Smart-OCR routes as user A with user B file ids and asserts 404');
  it.todo('replays KB-only routes under an OCR-edition tenant and asserts 404 (ADR-0009 G2)');
  it.todo('replays OCR-only routes under a KB-edition tenant and asserts 404 (ADR-0009 G2)');
});

import { Types } from 'mongoose';
import { isProperlyScopedFirstStage } from './backstop.plugin';

describe('isProperlyScopedFirstStage (ADR-0001 backstop, aggregate hook — Atlas $vectorSearch/$search extension, document-chat-rag plan §1)', () => {
  const tenantId = new Types.ObjectId();
  const otherTenantId = new Types.ObjectId();

  it('accepts a $match-first stage with the correct tenantId (ScopedRepository.aggregate()\'s normal shape)', () => {
    expect(isProperlyScopedFirstStage({ $match: { tenantId } }, tenantId)).toBe(true);
  });

  it('rejects a $match-first stage with the wrong tenantId', () => {
    expect(isProperlyScopedFirstStage({ $match: { tenantId: otherTenantId } }, tenantId)).toBe(false);
  });

  it('accepts a $vectorSearch stage whose filter carries the correct tenantId (Atlas Vector Search cannot be preceded by $match)', () => {
    expect(isProperlyScopedFirstStage({ $vectorSearch: { filter: { tenantId } } }, tenantId)).toBe(true);
  });

  it('rejects a $vectorSearch stage with no filter at all', () => {
    expect(isProperlyScopedFirstStage({ $vectorSearch: { index: 'chunks_vector' } }, tenantId)).toBe(false);
  });

  it('rejects a $vectorSearch stage whose filter has the wrong tenantId', () => {
    expect(isProperlyScopedFirstStage({ $vectorSearch: { filter: { tenantId: otherTenantId } } }, tenantId)).toBe(false);
  });

  it('accepts a $search compound-filter stage with a matching tenantId equals clause', () => {
    const first = { $search: { compound: { filter: [{ equals: { path: 'tenantId', value: tenantId } }] } } };
    expect(isProperlyScopedFirstStage(first, tenantId)).toBe(true);
  });

  it('rejects a $search stage with no tenantId equals clause in its filter array', () => {
    const first = { $search: { compound: { filter: [{ equals: { path: 'folderId', value: 'x' } }] } } };
    expect(isProperlyScopedFirstStage(first, tenantId)).toBe(false);
  });

  it('rejects an undefined first stage (empty pipeline)', () => {
    expect(isProperlyScopedFirstStage(undefined, tenantId)).toBe(false);
  });

  it('rejects a first stage that is none of the three recognized shapes', () => {
    expect(isProperlyScopedFirstStage({ $sort: { name: 1 } }, tenantId)).toBe(false);
  });
});

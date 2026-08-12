import { z } from 'zod';
import { FolderCycleError, FolderDepthExceededError, FolderLimitExceededError, FolderNotEmptyError, FolderParentNotFoundError } from '@kms/data';
import { FolderExceptionFilter } from './folder-exception.filter';

function fakeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { host: { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as any, status, json };
}

describe('FolderExceptionFilter (Phase 2 plan Task 4)', () => {
  const filter = new FolderExceptionFilter();

  it('maps FolderLimitExceededError to 409', () => {
    const { host, status } = fakeHost();
    filter.catch(new FolderLimitExceededError(2000), host);
    expect(status).toHaveBeenCalledWith(409);
  });

  it('maps FolderDepthExceededError to 400', () => {
    const { host, status } = fakeHost();
    filter.catch(new FolderDepthExceededError(10), host);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('maps FolderParentNotFoundError to 404 with no leaked detail', () => {
    const { host, status, json } = fakeHost();
    filter.catch(new FolderParentNotFoundError(), host);
    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ statusCode: 404 }));
  });

  it('maps FolderCycleError to 400', () => {
    const { host, status } = fakeHost();
    filter.catch(new FolderCycleError(), host);
    expect(status).toHaveBeenCalledWith(400);
  });

  it('maps FolderNotEmptyError to 409', () => {
    const { host, status } = fakeHost();
    filter.catch(new FolderNotEmptyError(), host);
    expect(status).toHaveBeenCalledWith(409);
  });

  it('maps a raw ZodError to 400 (the pattern every SomeRequestSchema.parse(body) call site relies on)', () => {
    const { host, status, json } = fakeHost();
    const schema = z.object({ name: z.string().min(1) });
    let caught: unknown;
    try {
      schema.parse({ name: '' });
    } catch (e) {
      caught = e;
    }

    filter.catch(caught as Error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
  });
});

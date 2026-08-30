import { z } from 'zod';
import { ZodExceptionFilter } from './zod-exception.filter';

function fakeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { host: { switchToHttp: () => ({ getResponse: () => ({ status }) }) } as any, status, json };
}

describe('ZodExceptionFilter (2026-08-30 — tenant-rename 500 fix)', () => {
  const filter = new ZodExceptionFilter();

  it('maps a raw ZodError to 400 instead of the opaque 500 Nest\'s default handler would produce', () => {
    const { host, status, json } = fakeHost();
    const schema = z.object({ subdomain: z.string().regex(/^[a-z0-9]+$/, 'invalid subdomain') });
    let caught: unknown;
    try {
      schema.parse({ subdomain: '' });
    } catch (e) {
      caught = e;
    }

    filter.catch(caught as any, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR', message: expect.stringContaining('invalid subdomain') }));
  });
});

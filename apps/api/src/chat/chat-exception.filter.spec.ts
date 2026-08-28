import { z } from 'zod';
import { ChatExceptionFilter } from './chat-exception.filter';
import { ChatBudgetExhaustedError, ChatRateLimitedError } from './chat-errors';

function fakeHost() {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const setHeader = jest.fn();
  return { host: { switchToHttp: () => ({ getResponse: () => ({ status, setHeader }) }) } as any, status, json, setHeader };
}

describe('ChatExceptionFilter', () => {
  const filter = new ChatExceptionFilter();

  it('maps a raw ZodError to 400', () => {
    const { host, status, json } = fakeHost();
    const schema = z.object({ text: z.string().min(1) });
    let caught: unknown;
    try {
      schema.parse({ text: '' });
    } catch (e) {
      caught = e;
    }

    filter.catch(caught as Error, host);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'VALIDATION_ERROR' }));
  });

  it('maps ChatRateLimitedError to 429 with a Retry-After header and a machine-readable code', () => {
    const { host, status, json, setHeader } = fakeHost();

    filter.catch(new ChatRateLimitedError(120), host);

    expect(status).toHaveBeenCalledWith(429);
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '120');
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'RATE_LIMITED', retryAfterSeconds: 120 }));
  });

  it('maps ChatBudgetExhaustedError to 402 with a machine-readable code the frontend can switch on', () => {
    const { host, status, json } = fakeHost();

    filter.catch(new ChatBudgetExhaustedError(), host);

    expect(status).toHaveBeenCalledWith(402);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'BUDGET_EXHAUSTED' }));
  });
});

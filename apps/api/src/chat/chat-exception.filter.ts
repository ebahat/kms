import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';
import { ChatBudgetExhaustedError, ChatRateLimitedError } from './chat-errors';

/** Mirrors `FolderExceptionFilter`'s precedent — one small per-controller filter, not a global one, since nothing else in this API throws these. Every mapped response carries a machine-readable `error` code the frontend switches on, matching this codebase's other 409-style structured-conflict responses. */
@Catch(ZodError, ChatRateLimitedError, ChatBudgetExhaustedError)
export class ChatExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const mapped = ChatExceptionFilter.map(exception);
    const response = host.switchToHttp().getResponse<Response>();
    if (exception instanceof ChatRateLimitedError) {
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));
    }
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private static map(exception: Error): HttpException {
    if (exception instanceof ZodError) {
      return new BadRequestException({ error: 'VALIDATION_ERROR', message: exception.issues.map((i) => i.message).join('; ') });
    }
    if (exception instanceof ChatRateLimitedError) {
      return new HttpException({ error: 'RATE_LIMITED', message: 'too many chat messages — try again shortly', retryAfterSeconds: exception.retryAfterSeconds }, HttpStatus.TOO_MANY_REQUESTS);
    }
    return new HttpException({ error: 'BUDGET_EXHAUSTED', message: 'this tenant\'s chat budget is exhausted for this period — search remains available' }, HttpStatus.PAYMENT_REQUIRED);
  }
}

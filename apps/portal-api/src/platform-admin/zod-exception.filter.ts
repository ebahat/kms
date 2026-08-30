import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';

/**
 * Every `SomeRequestSchema.parse(body)` call in this controller (provision, update, ...) throws a
 * raw, uncaught ZodError on invalid input, which Nest's default handler turns into an opaque 500 —
 * same pre-existing, cross-cutting gap apps/api's FolderExceptionFilter documents and fixes for its
 * own controllers (2026-08-13). Confirmed here 2026-08-30: a tenant with no `subdomain` set (e.g.
 * one created before the subdomain field existed) submits an empty string on any edit via the
 * superuser screen, which fails the subdomain regex and surfaced as "Internal server error" with no
 * indication of what actually went wrong.
 */
@Catch(ZodError)
export class ZodExceptionFilter implements ExceptionFilter {
  catch(exception: ZodError, host: ArgumentsHost) {
    const mapped: HttpException = new BadRequestException({
      error: 'VALIDATION_ERROR',
      message: exception.issues.map((i) => i.message).join('; '),
    });
    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}

import { ArgumentsHost, BadRequestException, Catch, ConflictException, ExceptionFilter, HttpException, NotFoundException } from '@nestjs/common';
import { Response } from 'express';
import { ZodError } from 'zod';
import { FolderCycleError, FolderDepthExceededError, FolderLimitExceededError, FolderNotEmptyError, FolderParentNotFoundError } from '@kms/data';

/**
 * FoldersRepository's domain errors (Phase 2 plan Task 4) were caught by
 * nothing before this filter — they'd surface as raw 500s with no useful
 * body. Applied via @UseFilters on both FoldersController and
 * GroupsController (the folder-domain branches are simply never reached from
 * Groups routes), mirroring MulterExceptionFilter's precedent
 * (apps/api/src/documents/multer-exception.filter.ts) rather than a global
 * filter, since nothing else in this API throws these.
 *
 * Also catches ZodError: every `SomeRequestSchema.parse(body)` call in this
 * codebase (AuthController, DocumentsController) throws a raw, uncaught
 * ZodError on invalid input — there is no global Zod exception handling
 * anywhere in apps/api, so today that surfaces as a 500, not the 400 the
 * "validate every request body" pattern is supposed to produce, and nothing
 * has ever tested the malformed-body path to notice. That's a real,
 * pre-existing, cross-cutting gap, not something new here — fixed for
 * FoldersController's and GroupsController's own routes since both already
 * need this filter anyway, but deliberately not retrofitted onto
 * AuthController/DocumentsController, which is outside this plan's scope.
 * Flagged in the task report as a recorded-but-deferred finding, same
 * discipline as Task 11's request-validation gap.
 */
@Catch(FolderLimitExceededError, FolderDepthExceededError, FolderParentNotFoundError, FolderCycleError, FolderNotEmptyError, ZodError)
export class FolderExceptionFilter implements ExceptionFilter {
  catch(exception: Error, host: ArgumentsHost) {
    const mapped: HttpException = FolderExceptionFilter.map(exception);
    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }

  private static map(exception: Error): HttpException {
    if (exception instanceof ZodError) {
      return new BadRequestException({ error: 'VALIDATION_ERROR', message: exception.issues.map((i) => i.message).join('; ') });
    }
    if (exception instanceof FolderLimitExceededError) {
      return new ConflictException({ error: 'FOLDER_LIMIT_EXCEEDED', message: exception.message });
    }
    if (exception instanceof FolderDepthExceededError) {
      return new BadRequestException({ error: 'FOLDER_DEPTH_EXCEEDED', message: exception.message });
    }
    if (exception instanceof FolderParentNotFoundError) {
      return new NotFoundException();
    }
    if (exception instanceof FolderCycleError) {
      return new BadRequestException({ error: 'FOLDER_CYCLE', message: exception.message });
    }
    return new ConflictException({ error: 'FOLDER_NOT_EMPTY', message: exception.message });
  }
}

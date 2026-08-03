import { ArgumentsHost, Catch, ExceptionFilter, HttpException, PayloadTooLargeException, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';
import { MAX_UPLOAD_BYTES } from './upload-limits';

/**
 * multer's own limits.fileSize enforcement (sec §4.4 — bound memory usage to
 * the 50 MB cap before any GCS write) throws a raw MulterError that Nest
 * doesn't map to a clean response by default. Scoped to the documents
 * controller only via @UseFilters — not a global filter, since nothing else
 * in this API touches multer.
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const mapped: HttpException =
      exception.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException({
            error: 'FILE_TOO_LARGE',
            message: `Files must be ${Math.floor(MAX_UPLOAD_BYTES / (1024 * 1024))} MB or smaller.`,
          })
        : new BadRequestException({ error: 'UPLOAD_ERROR', message: exception.message });

    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}

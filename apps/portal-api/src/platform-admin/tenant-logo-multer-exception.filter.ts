import { ArgumentsHost, Catch, ExceptionFilter, HttpException, PayloadTooLargeException, BadRequestException } from '@nestjs/common';
import { Response } from 'express';
import { MulterError } from 'multer';

const MAX_LOGO_UPLOAD_BYTES = 2 * 1024 * 1024;

/**
 * multer's own limits.fileSize enforcement throws a raw MulterError that Nest doesn't map to a
 * clean response by default — same fix as apps/api's MulterExceptionFilter (documents upload),
 * duplicated rather than shared since portal-api has its own, smaller logo size cap (2 MB vs 50 MB).
 */
@Catch(MulterError)
export class MulterExceptionFilter implements ExceptionFilter {
  catch(exception: MulterError, host: ArgumentsHost) {
    const mapped: HttpException =
      exception.code === 'LIMIT_FILE_SIZE'
        ? new PayloadTooLargeException({
            error: 'FILE_TOO_LARGE',
            message: `Files must be ${Math.floor(MAX_LOGO_UPLOAD_BYTES / (1024 * 1024))} MB or smaller.`,
          })
        : new BadRequestException({ error: 'UPLOAD_ERROR', message: exception.message });

    const response = host.switchToHttp().getResponse<Response>();
    response.status(mapped.getStatus()).json(mapped.getResponse());
  }
}

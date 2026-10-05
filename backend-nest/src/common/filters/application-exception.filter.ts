import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { ApplicationError } from '../errors/application.error';

@Catch()
export class ApplicationExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApplicationExceptionFilter.name);
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host
      .switchToHttp()
      .getResponse<{ status(code: number): { json(body: object): void } }>();
    const request = host.switchToHttp().getRequest<{ url: string; requestId?: string }>();
    let status = 500;
    let title = 'Unexpected error';
    let detail = 'An unexpected error occurred.';
    let code: string | undefined;
    if (exception instanceof ApplicationError) {
      status = exception.status;
      title = exception.title;
      detail = exception.message;
      code = exception.code;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      title = exception.name;
      detail = exception.message;
    } else if (
      exception instanceof QueryFailedError &&
      (exception.driverError as { code?: string }).code === '23505'
    ) {
      status = 409;
      title = 'Conflict';
      detail = 'A record with the same unique identifier already exists.';
    } else
      this.logger.error({
        event: 'UnhandledRequestError',
        correlationId: request.requestId,
        errorType: exception instanceof Error ? exception.name : 'unknown',
      });
    response
      .status(status)
      .json({
        status,
        title,
        detail,
        ...(code ? { code } : {}),
        instance: request.url,
        ...(request.requestId ? { correlationId: request.requestId } : {}),
      });
  }
}

import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { IngestionContext } from './ingestion-context';
export const IngestionTenant = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<{ ingestion: IngestionContext }>().ingestion,
);

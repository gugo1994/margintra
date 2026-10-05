import { Global, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { OperationalRedisService } from './operational-redis.service';
import { OperationsController } from './operations.controller';
import { RequestObservabilityMiddleware } from './request-observability.middleware';

@Global()
@Module({
  controllers: [OperationsController],
  providers: [MetricsService, OperationalRedisService, RequestObservabilityMiddleware],
  exports: [MetricsService, OperationalRedisService],
})
export class OperationsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestObservabilityMiddleware).forRoutes('*');
  }
}

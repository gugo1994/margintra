import 'reflect-metadata';
import { RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  app.disable('x-powered-by');
  app.set('trust proxy', config.getOrThrow<number>('app.trustProxyHops'));
  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'metrics', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableCors({
    origin: config.getOrThrow<string>('app.origin'),
    credentials: false,
    allowedHeaders: ['Content-Type', 'Authorization', 'Stripe-Signature', 'X-Request-Id'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });
  app.enableShutdownHooks();
  await app.listen(config.getOrThrow<number>('app.port'));
}
void bootstrap();

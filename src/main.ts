import { NestFactory, Reflector } from '@nestjs/core';
import {
  ClassSerializerInterceptor,
  Logger,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import express from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { join } from 'path';
import { AppModule } from './app.module';
import { loadConfig } from './config/app-config';
import { buildCorsOptions } from './config/cors';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bufferLogs: false,
  });

  // Trust reverse proxy hops (Nginx, Cloudflare, etc.) so req.ip and protocol are correct.
  app.set('trust proxy', config.trustProxyHops);

  // Security headers
  app.use(
    helmet({
      contentSecurityPolicy:
        config.nodeEnv === 'production'
          ? {
              useDefaults: true,
              directives: {
                'default-src': ["'self'"],
                'script-src': ["'self'", "'unsafe-inline'"],
                'style-src': ["'self'", "'unsafe-inline'"],
              },
            }
          : false,
    }),
  );

  // Body parsers with strict size limit (100 KB by default)
  const bodyLimit = `${config.payload.httpBodyLimitBytes}b`;
  app.use(express.json({ limit: bodyLimit }));
  app.use(express.urlencoded({ extended: true, limit: bodyLimit }));
  app.use(cookieParser());

  // CORS
  app.enableCors(buildCorsOptions(config));

  // Static + EJS for admin UI
  app.useStaticAssets(join(__dirname, '..', 'public'));
  app.setBaseViewsDir(join(__dirname, '..', 'views'));
  app.setViewEngine('ejs');

  // Validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // URL versioning: only routes that opt-in via @Controller({ version: '1' })
  // get the /v1 prefix. Health and admin remain unversioned.
  app.enableVersioning({ type: VersioningType.URI });

  // Note: PublicIngestionLimiterGuard and AdminLoginLimiterGuard are applied
  // at the controller level so they only run on the routes they protect.

  await app.listen(config.port);
  logger.log(`Public Form Logger listening on :${config.port} (env=${config.nodeEnv})`);
  logger.log(`CORS bare domains: ${JSON.stringify(config.cors.origins)}`);
  logger.log(`CORS explicit origins: ${JSON.stringify(config.cors.explicitOrigins)}`);
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[bootstrap] fatal:', err);
  process.exit(1);
});

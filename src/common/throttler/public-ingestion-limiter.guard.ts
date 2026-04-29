import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/app-config';
import { InMemoryWindowLimiter } from './in-memory-window-limiter';

/**
 * Composite limiter for `POST /v1/public-form-logs`:
 *  - per-IP bucket (e.g. 60/min)
 *  - per-public_token bucket (e.g. 100/min) — only if token present in body
 *
 * Either bucket exceeded → 429.
 */
@Injectable()
export class PublicIngestionLimiterGuard implements CanActivate, OnModuleDestroy {
  private readonly ipLimiter: InMemoryWindowLimiter;
  private readonly tokenLimiter: InMemoryWindowLimiter;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    const oneMinute = 60_000;
    this.ipLimiter = new InMemoryWindowLimiter(config.rateLimit.publicPerIp, oneMinute);
    this.tokenLimiter = new InMemoryWindowLimiter(config.rateLimit.publicPerToken, oneMinute);
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const ip = req.ip ?? 'unknown';
    const ipResult = this.ipLimiter.hit(`ip:${ip}`);
    if (!ipResult.allowed) {
      res.setHeader('Retry-After', String(ipResult.retryAfterSec));
      throw new HttpException('Too many requests (IP)', HttpStatus.TOO_MANY_REQUESTS);
    }

    const token = (req.body as { public_token?: unknown } | undefined)?.public_token;
    if (typeof token === 'string' && token.length > 0 && token.length <= 256) {
      const tokenResult = this.tokenLimiter.hit(`tok:${token}`);
      if (!tokenResult.allowed) {
        res.setHeader('Retry-After', String(tokenResult.retryAfterSec));
        throw new HttpException('Too many requests (token)', HttpStatus.TOO_MANY_REQUESTS);
      }
    }

    return true;
  }

  onModuleDestroy(): void {
    this.ipLimiter.destroy();
    this.tokenLimiter.destroy();
  }
}

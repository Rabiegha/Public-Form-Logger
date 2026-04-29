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
 * Limiter for POST /admin/auth/login.
 * Default: 5 attempts / 15 min / IP.
 */
@Injectable()
export class AdminLoginLimiterGuard implements CanActivate, OnModuleDestroy {
  private readonly limiter: InMemoryWindowLimiter;

  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.limiter = new InMemoryWindowLimiter(
      config.rateLimit.loginMax,
      config.rateLimit.loginWindowMin * 60_000,
    );
  }

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const res = ctx.switchToHttp().getResponse<Response>();

    const ip = req.ip ?? 'unknown';
    const result = this.limiter.hit(`login:${ip}`);
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      throw new HttpException('Too many login attempts', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }

  onModuleDestroy(): void {
    this.limiter.destroy();
  }
}

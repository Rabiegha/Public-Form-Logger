import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request } from 'express';
import { AdminAuthService, AdminJwtPayload } from './admin-auth.service';

export const ADMIN_COOKIE_NAME = 'pfl_admin_session';

declare module 'express' {
  interface Request {
    adminUser?: AdminJwtPayload;
  }
}

@Injectable()
export class AdminAuthGuard implements CanActivate {
  constructor(@Inject(AdminAuthService) private readonly auth: AdminAuthService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<Request>();
    const token = (req.cookies as Record<string, string> | undefined)?.[ADMIN_COOKIE_NAME];
    if (!token) {
      throw new UnauthorizedException('Not authenticated');
    }
    try {
      req.adminUser = this.auth.verifyToken(token);
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
  }
}

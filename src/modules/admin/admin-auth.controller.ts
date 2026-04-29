import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminAuthService } from './admin-auth.service';
import { AdminLoginDto } from './dto/admin-login.dto';
import { AdminLoginLimiterGuard } from '../../common/throttler/admin-login-limiter.guard';
import { AdminAuthGuard, ADMIN_COOKIE_NAME } from './admin-auth.guard';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/app-config';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly auth: AdminAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminLoginLimiterGuard)
  async login(
    @Body() dto: AdminLoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'ok' }> {
    const payload = await this.auth.validateCredentials(dto.email, dto.password);
    const token = this.auth.signToken(payload);

    res.cookie(ADMIN_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.admin.cookieSecure,
      sameSite: this.config.admin.cookieSameSite,
      path: this.config.basePath || '/',
      maxAge: this.cookieMaxAgeMs(),
    });
    return { status: 'ok' };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @UseGuards(AdminAuthGuard)
  logout(@Req() _req: Request, @Res({ passthrough: true }) res: Response): { status: 'ok' } {
    res.clearCookie(ADMIN_COOKIE_NAME, { path: this.config.basePath || '/' });
    return { status: 'ok' };
  }

  private cookieMaxAgeMs(): number {
    // Cheap parse: support "Nh" / "Nm" / "Ns" / raw seconds.
    const raw = this.config.admin.jwtExpiresIn;
    const m = /^(\d+)\s*([smhd])?$/i.exec(raw.trim());
    if (!m) return 8 * 60 * 60 * 1000;
    const n = Number(m[1]);
    const unit = (m[2] ?? 's').toLowerCase();
    const factor = unit === 's' ? 1000 : unit === 'm' ? 60_000 : unit === 'h' ? 3_600_000 : 86_400_000;
    return n * factor;
  }
}

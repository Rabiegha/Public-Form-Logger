import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../prisma/prisma.module';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/app-config';

export interface AdminJwtPayload {
  sub: string;
  email: string;
  role: string;
}

@Injectable()
export class AdminAuthService {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async validateCredentials(email: string, password: string): Promise<AdminJwtPayload> {
    const normalized = email.trim().toLowerCase();
    const user = await this.prisma.adminUser.findUnique({ where: { email: normalized } });

    // Always run bcrypt to mitigate user-enumeration timing differences
    const hashToCheck = user?.passwordHash ?? '$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidinv';
    const ok = await bcrypt.compare(password, hashToCheck);

    if (!user || !ok) {
      this.logger.warn(`admin.login.failed email=${normalized}`);
      throw new UnauthorizedException('Invalid credentials');
    }

    this.logger.log(`admin.login.success email=${normalized}`);
    return { sub: user.id, email: user.email, role: user.role };
  }

  signToken(payload: AdminJwtPayload): string {
    return this.jwt.sign(payload, {
      secret: this.config.admin.jwtSecret,
      expiresIn: this.config.admin.jwtExpiresIn,
    });
  }

  verifyToken(token: string): AdminJwtPayload {
    return this.jwt.verify<AdminJwtPayload>(token, {
      secret: this.config.admin.jwtSecret,
    });
  }
}

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AdminAuthService } from './admin-auth.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AdminAuthController } from './admin-auth.controller';
import { AdminLogsController } from './admin-logs.controller';
import { AdminUiController } from './admin-ui.controller';
import { AdminLoginLimiterGuard } from '../../common/throttler/admin-login-limiter.guard';
import { PublicFormLogsModule } from '../public-form-logs/public-form-logs.module';
import { AttendeeModule } from '../attendee/attendee.module';

@Module({
  imports: [JwtModule.register({}), PublicFormLogsModule, AttendeeModule],
  controllers: [AdminAuthController, AdminLogsController, AdminUiController],
  providers: [AdminAuthService, AdminAuthGuard, AdminLoginLimiterGuard],
  exports: [AdminAuthService],
})
export class AdminModule {}

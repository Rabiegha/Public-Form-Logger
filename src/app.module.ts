import { Module } from '@nestjs/common';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { PublicFormLogsModule } from './modules/public-form-logs/public-form-logs.module';
import { AdminModule } from './modules/admin/admin.module';

@Module({
  imports: [ConfigModule, PrismaModule, HealthModule, PublicFormLogsModule, AdminModule],
})
export class AppModule {}

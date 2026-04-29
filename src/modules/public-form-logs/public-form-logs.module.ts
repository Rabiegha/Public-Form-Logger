import { Module } from '@nestjs/common';
import { PublicFormLogsController } from './public-form-logs.controller';
import { PublicFormLogsService } from './public-form-logs.service';
import { LogExportService } from './log-export.service';
import { PublicIngestionLimiterGuard } from '../../common/throttler/public-ingestion-limiter.guard';

@Module({
  controllers: [PublicFormLogsController],
  providers: [PublicFormLogsService, LogExportService, PublicIngestionLimiterGuard],
  exports: [PublicFormLogsService, LogExportService],
})
export class PublicFormLogsModule {}

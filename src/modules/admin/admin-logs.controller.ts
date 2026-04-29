import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { PublicFormLogsService } from '../public-form-logs/public-form-logs.service';
import { AdminAuthGuard } from './admin-auth.guard';

@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminLogsController {
  constructor(private readonly logs: PublicFormLogsService) {}

  @Get('public-form-logs')
  async list(
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('publicToken') publicToken?: string,
    @Query('submissionId') submissionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const pageNum = clampInt(page, 1, 1, 100_000);
    const sizeNum = clampInt(pageSize, 25, 1, 200);
    const fromDate = parseOptionalDate(from, 'from');
    const toDate = parseOptionalDate(to, 'to');

    const { items, total } = await this.logs.findManyForAdmin({
      page: pageNum,
      pageSize: sizeNum,
      publicToken: publicToken?.trim() || undefined,
      submissionId: submissionId?.trim() || undefined,
      from: fromDate,
      to: toDate,
    });

    return {
      page: pageNum,
      pageSize: sizeNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / sizeNum)),
      items,
    };
  }

  @Get('public-form-logs/:id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const log = await this.logs.findByIdForAdmin(id);
    if (!log) throw new NotFoundException('Log not found');
    return log;
  }

  @Get('stats')
  async stats() {
    return this.logs.getStats();
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function parseOptionalDate(raw: string | undefined, label: string): Date | undefined {
  if (!raw) return undefined;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid ${label} date: ${raw}`);
  }
  return d;
}

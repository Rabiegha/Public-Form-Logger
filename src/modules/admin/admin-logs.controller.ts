import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { PublicFormLogsService } from '../public-form-logs/public-form-logs.service';
import {
  BUILT_IN_COLUMNS,
  BuiltInColumn,
  ExportFormat,
  LogExportService,
} from '../public-form-logs/log-export.service';
import { AdminAuthGuard } from './admin-auth.guard';
import { AttendeeApiClient } from '../attendee/attendee-api.client';
import { toAdminRow } from './admin-row.mapper';

const VALID_PAGE_SIZES = [10, 25, 50, 100] as const;

@Controller('admin/api')
@UseGuards(AdminAuthGuard)
export class AdminLogsController {
  constructor(
    private readonly logs: PublicFormLogsService,
    private readonly exporter: LogExportService,
    private readonly attendee: AttendeeApiClient,
  ) {}

  @Get('events')
  async listEvents() {
    const groups = await this.logs.listEventGroups();
    const meta = await this.attendee.getMany(groups.map((g) => g.publicToken));
    return {
      items: groups.map((g) => {
        const m = meta.get(g.publicToken);
        return {
          publicToken: g.publicToken,
          count: g.count,
          lastReceivedAt: g.lastReceivedAt.toISOString(),
          eventName: m?.name ?? null,
          eventCode: m?.code ?? null,
          eventStartAt: m?.startAt?.toISOString() ?? null,
          eventEndAt: m?.endAt?.toISOString() ?? null,
        };
      }),
    };
  }

  @Get('events/:publicToken/logs')
  async listEventLogs(
    @Param('publicToken') publicToken: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ) {
    const sizeNum = clampPageSize(pageSize);
    const pageNum = clampInt(page, 1, 1, 100_000);
    const meta = await this.attendee.getEventInfo(publicToken);
    const { items, total } = await this.logs.findEventLogs({
      publicToken,
      page: pageNum,
      pageSize: sizeNum,
      search: search?.trim() || undefined,
    });

    return {
      event: {
        publicToken,
        eventName: meta.name,
        eventCode: meta.code,
        eventStartAt: meta.startAt?.toISOString() ?? null,
        eventEndAt: meta.endAt?.toISOString() ?? null,
      },
      page: pageNum,
      pageSize: sizeNum,
      total,
      totalPages: Math.max(1, Math.ceil(total / sizeNum)),
      items: items.map(toAdminRow),
    };
  }

  @Get('events/:publicToken/export')
  async exportEventLogs(
    @Res() res: Response,
    @Param('publicToken') publicToken: string,
    @Query('format') format?: string,
    @Query('search') search?: string,
    @Query('ids') ids?: string,
    @Query('builtIn') builtIn?: string,
    @Query('payloadKeys') payloadKeys?: string,
  ): Promise<void> {
    const fmt: ExportFormat = format === 'csv' ? 'csv' : 'xlsx';
    const idList = parseList(ids);
    const builtInCols = parseBuiltInList(builtIn);
    const payloadKeyCols = parseList(payloadKeys);

    if (builtInCols.length === 0 && payloadKeyCols.length === 0) {
      throw new BadRequestException('At least one column is required');
    }

    const logs = await this.logs.findForExport({
      publicToken,
      ids: idList.length > 0 ? idList : undefined,
      search: search?.trim() || undefined,
    });

    const { buffer, filename, mime } = await this.exporter.buildExport(
      logs,
      { builtIn: builtInCols, payloadKeys: payloadKeyCols },
      fmt,
    );

    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(buffer);
  }

  @Get('public-form-logs/:id')
  async detail(@Param('id', new ParseUUIDPipe()) id: string) {
    const log = await this.logs.findByIdForAdmin(id);
    if (!log) throw new NotFoundException('Log not found');
    return toAdminRow(log);
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

function clampPageSize(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return 25;
  if ((VALID_PAGE_SIZES as readonly number[]).includes(n)) return n;
  return 25;
}

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function parseBuiltInList(raw: string | undefined): BuiltInColumn[] {
  return parseList(raw).filter((s): s is BuiltInColumn =>
    (BUILT_IN_COLUMNS as readonly string[]).includes(s),
  );
}

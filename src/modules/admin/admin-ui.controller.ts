import {
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Query,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PublicFormLogsService } from '../public-form-logs/public-form-logs.service';
import { AdminAuthGuard, ADMIN_COOKIE_NAME } from './admin-auth.guard';
import { AdminAuthService } from './admin-auth.service';
import { AttendeeApiClient } from '../attendee/attendee-api.client';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/app-config';
import { toAdminRow } from './admin-row.mapper';

const VALID_PAGE_SIZES = [10, 25, 50, 100] as const;
const DEFAULT_VISIBLE_PAYLOAD_KEYS = 8;

/**
 * Server-rendered admin UI (EJS).
 *  - GET  /admin                              → redirect (events or login)
 *  - GET  /admin/login                        → login page
 *  - GET  /admin/events                       → list of events (groupBy public_token)
 *  - GET  /admin/events/:publicToken          → logs for that event (table view)
 *  - GET  /admin/logs/:id                     → log detail
 *  - GET  /admin/dashboard                    → backwards-compat redirect to /admin/events
 */
@Controller('admin')
export class AdminUiController {
  constructor(
    private readonly logs: PublicFormLogsService,
    private readonly auth: AdminAuthService,
    private readonly attendee: AttendeeApiClient,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  root(@Req() req: Request, @Res() res: Response): void {
    const token = (req.cookies as Record<string, string> | undefined)?.[ADMIN_COOKIE_NAME];
    if (token) {
      try {
        this.auth.verifyToken(token);
        return res.redirect('/admin/events');
      } catch {
        // fallthrough
      }
    }
    res.redirect('/admin/login');
  }

  @Get('dashboard')
  legacyDashboard(@Res() res: Response): void {
    res.redirect('/admin/events');
  }

  @Get('login')
  @Render('admin/login')
  loginPage(@Query('error') error?: string): Record<string, unknown> {
    return { error: error ? 'Invalid credentials' : null };
  }

  @Get('events')
  @UseGuards(AdminAuthGuard)
  async events(@Req() req: Request, @Res() res: Response): Promise<void> {
    const groups = await this.logs.listEventGroups();
    const meta = await this.attendee.getMany(groups.map((g) => g.publicToken));
    const stats = await this.logs.getStats();

    const items = groups.map((g) => {
      const m = meta.get(g.publicToken);
      return {
        publicToken: g.publicToken,
        count: g.count,
        lastReceivedAt: g.lastReceivedAt,
        eventName: m?.name ?? null,
        eventCode: m?.code ?? null,
        eventStartAt: m?.startAt ?? null,
        eventEndAt: m?.endAt ?? null,
      };
    });

    res.render('admin/events', { user: req.adminUser, items, stats });
  }

  @Get('events/:publicToken')
  @UseGuards(AdminAuthGuard)
  async eventLogs(
    @Req() req: Request,
    @Res() res: Response,
    @Param('publicToken') publicToken: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('search') search?: string,
  ): Promise<void> {
    const sizeNum = clampPageSize(pageSize);
    const pageNum = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);

    const meta = await this.attendee.getEventInfo(publicToken);
    const { items, total } = await this.logs.findEventLogs({
      publicToken,
      page: pageNum,
      pageSize: sizeNum,
      search: search?.trim() || undefined,
    });
    const rows = items.map(toAdminRow);

    // Build the payload-key list in landing-page order:
    //   first occurrence wins, no alphabetic re-sort.
    const seen = new Set<string>();
    const payloadKeys: string[] = [];
    for (const row of rows) {
      for (const k of row.payloadKeys) {
        if (!seen.has(k)) {
          seen.add(k);
          payloadKeys.push(k);
        }
      }
    }
    const defaultVisiblePayloadKeys = payloadKeys.slice(0, DEFAULT_VISIBLE_PAYLOAD_KEYS);

    res.render('admin/event-logs', {
      user: req.adminUser,
      event: {
        publicToken,
        eventName: meta.name,
        eventCode: meta.code,
        eventStartAt: meta.startAt,
        eventEndAt: meta.endAt,
      },
      rows,
      payloadKeys,
      defaultVisiblePayloadKeys,
      page: pageNum,
      pageSize: sizeNum,
      pageSizes: [...VALID_PAGE_SIZES],
      total,
      totalPages: Math.max(1, Math.ceil(total / sizeNum)),
      search: search ?? '',
    });
  }

  @Get('logs/:id')
  @UseGuards(AdminAuthGuard)
  async detail(
    @Req() req: Request,
    @Res() res: Response,
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<void> {
    const log = await this.logs.findByIdForAdmin(id);
    if (!log) throw new NotFoundException('Log not found');
    const meta = await this.attendee.getEventInfo(log.publicToken);
    const row = toAdminRow(log);
    res.render('admin/detail', {
      user: req.adminUser,
      log,
      row,
      eventName: meta.name,
      payloadJson: JSON.stringify(log.formPayload, null, 2),
    });
  }
}

function clampPageSize(raw: string | undefined): number {
  const n = Number.parseInt(raw ?? '', 10);
  if (!Number.isFinite(n)) return 25;
  if ((VALID_PAGE_SIZES as readonly number[]).includes(n)) return n;
  return 25;
}

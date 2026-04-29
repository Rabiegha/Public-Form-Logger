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
    const bp = this.config.basePath;
    const token = (req.cookies as Record<string, string> | undefined)?.[ADMIN_COOKIE_NAME];
    if (token) {
      try {
        this.auth.verifyToken(token);
        return res.redirect(`${bp}/admin/events`);
      } catch {
        // fallthrough
      }
    }
    res.redirect(`${bp}/admin/login`);
  }

  @Get('dashboard')
  legacyDashboard(@Res() res: Response): void {
    res.redirect(`${this.config.basePath}/admin/events`);
  }

  @Get('login')
  @Render('admin/login')
  loginPage(@Query('error') error?: string): Record<string, unknown> {
    return { error: error ? 'Invalid credentials' : null };
  }

  @Get('events')
  @UseGuards(AdminAuthGuard)
  async events(
    @Req() req: Request,
    @Res() res: Response,
    @Query('q') q?: string,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<void> {
    const search = (q ?? '').trim();
    const hasSearch = search.length > 0;
    const from = hasSearch ? null : parseDateInput(fromStr, false);
    const to = hasSearch ? null : parseDateInput(toStr, true);
    const sizeNum = clampPageSize(pageSize);
    const pageNum = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);

    // 1) DB groups (date window only). Search is applied after meta resolution
    //    so q can match event name/code/public token consistently.
    const groups = await this.logs.listEventGroups({
      from: from ?? undefined,
      to: to ?? undefined,
    });

    // 2) Resolve event meta from Attendee for the resulting tokens
    const meta = await this.attendee.getMany(groups.map((g) => g.publicToken), {
      // During search, bypass cache to avoid stale negative entries masking
      // event names/codes and producing false "no results".
      forceRefresh: !!search,
    });

    // 3) Build items, then optionally filter by event name (only meaningful
    //    once the meta is resolved, since name is not in our DB)
    let items = groups.map((g) => {
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

    if (search) {
      const needle = search.toLowerCase();
      items = items.filter(
        (it) =>
          it.publicToken.toLowerCase().includes(needle) ||
          (it.eventName ?? '').toLowerCase().includes(needle) ||
          (it.eventCode ?? '').toLowerCase().includes(needle),
      );
    }

    // 4) Paginate in-memory (event count expected small; <= a few hundred)
    const total = items.length;
    const totalPages = Math.max(1, Math.ceil(total / sizeNum));
    const safePage = Math.min(pageNum, totalPages);
    const start = (safePage - 1) * sizeNum;
    const pageItems = items.slice(start, start + sizeNum);

    const stats = await this.logs.getStats();

    res.render('admin/events', {
      user: req.adminUser,
      items: pageItems,
      stats,
      filters: {
        q: search,
        from: fromStr ?? '',
        to: toStr ?? '',
      },
      page: safePage,
      pageSize: sizeNum,
      pageSizes: [...VALID_PAGE_SIZES],
      total,
      totalPages,
    });
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

/**
 * Parse an HTML <input type="date"> value (YYYY-MM-DD).
 *  - returns null on empty / invalid input
 *  - inclusive=true → end-of-day (23:59:59.999) for upper bound
 */
function parseDateInput(raw: string | undefined, inclusive: boolean): Date | null {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]) - 1;
  const day = Number(m[3]);
  const d = new Date(Date.UTC(year, month, day, inclusive ? 23 : 0, inclusive ? 59 : 0, inclusive ? 59 : 0, inclusive ? 999 : 0));
  return Number.isNaN(d.getTime()) ? null : d;
}

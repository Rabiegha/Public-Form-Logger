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
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/app-config';

/**
 * Server-rendered admin UI (EJS). Routes:
 *  - GET  /admin           → redirect to /admin/dashboard or /admin/login
 *  - GET  /admin/login     → login page
 *  - GET  /admin/dashboard → list of logs + stats summary
 *  - GET  /admin/logs/:id  → log detail with JSON viewer
 */
@Controller('admin')
export class AdminUiController {
  constructor(
    private readonly logs: PublicFormLogsService,
    private readonly auth: AdminAuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Get()
  root(@Req() req: Request, @Res() res: Response): void {
    const token = (req.cookies as Record<string, string> | undefined)?.[ADMIN_COOKIE_NAME];
    if (token) {
      try {
        this.auth.verifyToken(token);
        return res.redirect('/admin/dashboard');
      } catch {
        // fallthrough
      }
    }
    res.redirect('/admin/login');
  }

  @Get('login')
  @Render('admin/login')
  loginPage(@Query('error') error?: string): Record<string, unknown> {
    return { error: error ? 'Invalid credentials' : null };
  }

  @Get('dashboard')
  @UseGuards(AdminAuthGuard)
  async dashboard(
    @Req() req: Request,
    @Res() res: Response,
    @Query('page') page?: string,
    @Query('publicToken') publicToken?: string,
    @Query('submissionId') submissionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const pageNum = Math.max(1, Number.parseInt(page ?? '1', 10) || 1);
    const pageSize = 25;

    const [{ items, total }, stats] = await Promise.all([
      this.logs.findManyForAdmin({
        page: pageNum,
        pageSize,
        publicToken: publicToken?.trim() || undefined,
        submissionId: submissionId?.trim() || undefined,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
      }),
      this.logs.getStats(),
    ]);

    res.render('admin/dashboard', {
      user: req.adminUser,
      items,
      total,
      pageSize,
      page: pageNum,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      filters: { publicToken: publicToken ?? '', submissionId: submissionId ?? '', from: from ?? '', to: to ?? '' },
      stats,
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
    res.render('admin/detail', {
      user: req.adminUser,
      log,
      payloadJson: JSON.stringify(log.formPayload, null, 2),
    });
  }
}

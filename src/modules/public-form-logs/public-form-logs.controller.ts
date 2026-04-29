import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CreatePublicFormLogDto } from './dto/create-public-form-log.dto';
import { PublicFormLogsService } from './public-form-logs.service';
import { PublicIngestionLimiterGuard } from '../../common/throttler/public-ingestion-limiter.guard';

@Controller({ path: 'public-form-logs', version: '1' })
@UseGuards(PublicIngestionLimiterGuard)
export class PublicFormLogsController {
  constructor(private readonly service: PublicFormLogsService) {}

  /**
   * Public ingestion endpoint. Idempotent on submission_id.
   *  - 201 Created      → new log inserted
   *  - 200 OK duplicate → submission_id already exists (frontend retry)
   *  - 400 Bad Request  → validation error (empty payload, bad token, etc.)
   *  - 503 Service Unavailable → DB down, frontend should retry with backoff
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() dto: CreatePublicFormLogDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ status: 'created' | 'duplicate'; id: string }> {
    const result = await this.service.create(dto, {
      ip: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
      referer: req.get('referer') ?? req.get('referrer') ?? undefined,
    });

    if (result.status === 'duplicate') {
      res.status(HttpStatus.OK);
    }
    return result;
  }
}

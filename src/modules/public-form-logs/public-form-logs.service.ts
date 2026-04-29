import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, PublicFormLog } from '@prisma/client';
import { v4 as uuidv4 } from 'uuid';
import { PrismaService } from '../../prisma/prisma.module';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/app-config';
import { CreatePublicFormLogDto } from './dto/create-public-form-log.dto';

/** Pattern of public_token issued by Attendee today (16 chars [A-Za-z0-9]). */
const ATTENDEE_TOKEN_PATTERN = /^[A-Za-z0-9]{16}$/;

export interface CreateContext {
  ip?: string;
  userAgent?: string;
  referer?: string;
}

export interface CreateResult {
  status: 'created' | 'duplicate';
  id: string;
}

@Injectable()
export class PublicFormLogsService {
  private readonly logger = new Logger(PublicFormLogsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async create(dto: CreatePublicFormLogDto, ctx: CreateContext): Promise<CreateResult> {
    // 1. Reject empty payload {} explicitly
    const keys = Object.keys(dto.form_payload);
    if (keys.length === 0) {
      throw new BadRequestException('form_payload must not be empty');
    }

    // 2. Reject too many top-level keys
    if (keys.length > this.config.payload.maxFormPayloadKeys) {
      throw new BadRequestException(
        `form_payload exceeds max ${this.config.payload.maxFormPayloadKeys} top-level keys`,
      );
    }

    // 3. Reject if serialized payload exceeds logical limit
    const serialized = JSON.stringify(dto.form_payload);
    const size = Buffer.byteLength(serialized, 'utf8');
    if (size > this.config.payload.maxFormPayloadBytes) {
      throw new BadRequestException(
        `form_payload exceeds max ${this.config.payload.maxFormPayloadBytes} bytes`,
      );
    }

    // 4. Soft warning if token format doesn't match Attendee's current pattern
    if (!ATTENDEE_TOKEN_PATTERN.test(dto.public_token)) {
      this.logger.warn(
        `public_token.format_mismatch token_length=${dto.public_token.length} prefix=${dto.public_token.slice(0, 4)}`,
      );
    }

    // 5. Build payload — submissionId may be either provided or generated.
    //    When generated server-side, no dedup is performed (still unique by chance).
    const submissionId = dto.submission_id ?? uuidv4();
    const isClientProvidedId = !!dto.submission_id;

    try {
      const created = await this.prisma.publicFormLog.create({
        data: {
          publicToken: dto.public_token,
          submissionId,
          formPayload: dto.form_payload as Prisma.InputJsonValue,
          formPayloadSize: size,
          landingPageUrl: dto.landing_page_url ?? null,
          referer: ctx.referer ?? null,
          userAgent: ctx.userAgent ?? null,
          ipAddress: ctx.ip ?? null,
          utmSource: dto.utm_source ?? null,
          utmMedium: dto.utm_medium ?? null,
          utmCampaign: dto.utm_campaign ?? null,
        },
        select: { id: true },
      });

      this.logger.log(
        `public_form_log.created id=${created.id} token=${dto.public_token.slice(0, 4)}*** keys=${keys.length} size=${size}B submission_id=${isClientProvidedId ? 'client' : 'server'}`,
      );

      return { status: 'created', id: created.id };
    } catch (err) {
      // P2002 = unique constraint failed (here, on submission_id)
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' &&
        isClientProvidedId
      ) {
        const existing = await this.prisma.publicFormLog.findUnique({
          where: { submissionId },
          select: { id: true },
        });
        if (existing) {
          this.logger.log(
            `public_form_log.duplicate id=${existing.id} token=${dto.public_token.slice(0, 4)}***`,
          );
          return { status: 'duplicate', id: existing.id };
        }
      }

      // Anything else (DB down, invalid SQL, etc.) → 503
      this.logger.error(
        `public_form_log.create_failed token=${dto.public_token.slice(0, 4)}*** error=${(err as Error).message}`,
      );
      throw new ServiceUnavailableException('Logger temporarily unavailable');
    }
  }

  // -- Admin queries ----------------------------------------------------------

  async findManyForAdmin(params: {
    page: number;
    pageSize: number;
    publicToken?: string;
    submissionId?: string;
    from?: Date;
    to?: Date;
  }): Promise<{ items: PublicFormLog[]; total: number }> {
    const where: Prisma.PublicFormLogWhereInput = {};
    if (params.publicToken) where.publicToken = params.publicToken;
    if (params.submissionId) where.submissionId = params.submissionId;
    if (params.from || params.to) {
      where.createdAt = {};
      if (params.from) where.createdAt.gte = params.from;
      if (params.to) where.createdAt.lte = params.to;
    }

    const [items, total] = await this.prisma.$transaction([
      this.prisma.publicFormLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.publicFormLog.count({ where }),
    ]);
    return { items, total };
  }

  async findByIdForAdmin(id: string): Promise<PublicFormLog | null> {
    return this.prisma.publicFormLog.findUnique({ where: { id } });
  }

  async getStats(): Promise<{ last24h: number; last7d: number; lastReceivedAt: Date | null }> {
    const now = new Date();
    const day = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const week = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [last24h, last7d, latest] = await this.prisma.$transaction([
      this.prisma.publicFormLog.count({ where: { createdAt: { gte: day } } }),
      this.prisma.publicFormLog.count({ where: { createdAt: { gte: week } } }),
      this.prisma.publicFormLog.findFirst({
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);
    return { last24h, last7d, lastReceivedAt: latest?.createdAt ?? null };
  }
}

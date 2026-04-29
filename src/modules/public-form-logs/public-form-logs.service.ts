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

  // -- Event grouping --------------------------------------------------------

  /**
   * Distinct public_token values with count + last received timestamp.
   * Used by the admin landing page to render the event list.
   *
   * Optional filters:
   *  - tokenSearch: ILIKE on publicToken (case-insensitive substring)
   *  - from / to:   restrict on log createdAt window before grouping
   *                 (= "events that received logs in [from, to]")
   */
  async listEventGroups(filters?: {
    tokenSearch?: string;
    from?: Date;
    to?: Date;
  }): Promise<Array<{ publicToken: string; count: number; lastReceivedAt: Date }>> {
    const where: Record<string, unknown> = {};
    if (filters?.tokenSearch && filters.tokenSearch.trim()) {
      where.publicToken = { contains: filters.tokenSearch.trim(), mode: 'insensitive' };
    }
    if (filters?.from || filters?.to) {
      const range: Record<string, Date> = {};
      if (filters.from) range.gte = filters.from;
      if (filters.to) range.lte = filters.to;
      where.createdAt = range;
    }

    const groups = await this.prisma.publicFormLog.groupBy({
      by: ['publicToken'],
      where: Object.keys(where).length ? (where as never) : undefined,
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _max: { createdAt: 'desc' } },
    });
    return groups
      .filter((g) => g._max.createdAt !== null)
      .map((g) => ({
        publicToken: g.publicToken,
        count: g._count._all,
        lastReceivedAt: g._max.createdAt as Date,
      }));
  }

  // -- Search by name / firstname / email within an event --------------------

  /**
   * Paginated list of logs for a given event (publicToken), with optional
   * full-text-ish search over the standard name / firstname / email payload
   * variants. Implemented via Postgres `jsonb` text cast + ILIKE for V1.
   */
  async findEventLogs(params: {
    publicToken: string;
    page: number;
    pageSize: number;
    search?: string;
  }): Promise<{ items: PublicFormLog[]; total: number }> {
    const { publicToken, page, pageSize, search } = params;
    const skip = (page - 1) * pageSize;

    if (!search || !search.trim()) {
      const [items, total] = await this.prisma.$transaction([
        this.prisma.publicFormLog.findMany({
          where: { publicToken },
          orderBy: { createdAt: 'desc' },
          skip,
          take: pageSize,
        }),
        this.prisma.publicFormLog.count({ where: { publicToken } }),
      ]);
      return { items, total };
    }

    // Search implementation: full-text-ish over the entire payload + UTM
    // metadata. We use a raw query to fetch the matching IDs (with the actual
    // snake_case table/column names from @@map), then re-hydrate via Prisma
    // so the returned objects have proper camelCase fields.
    const term = `%${search.trim().replace(/[%_]/g, '\\$&')}%`;
    const idsRaw = await this.prisma.$queryRawUnsafe<Array<{ id: string }>>(
      `SELECT id FROM public_form_logs
        WHERE public_token = $1
          AND (
                form_payload::text ILIKE $2
             OR coalesce(utm_source,   '') ILIKE $2
             OR coalesce(utm_medium,   '') ILIKE $2
             OR coalesce(utm_campaign, '') ILIKE $2
          )
        ORDER BY created_at DESC
        OFFSET ${skip} LIMIT ${pageSize}`,
      publicToken,
      term,
    );
    const totalRaw = await this.prisma.$queryRawUnsafe<Array<{ count: bigint }>>(
      `SELECT COUNT(*)::bigint AS count FROM public_form_logs
        WHERE public_token = $1
          AND (
                form_payload::text ILIKE $2
             OR coalesce(utm_source,   '') ILIKE $2
             OR coalesce(utm_medium,   '') ILIKE $2
             OR coalesce(utm_campaign, '') ILIKE $2
          )`,
      publicToken,
      term,
    );
    const total = Number(totalRaw[0]?.count ?? 0);
    if (idsRaw.length === 0) return { items: [], total };

    const ids = idsRaw.map((r) => r.id);
    const found = await this.prisma.publicFormLog.findMany({
      where: { id: { in: ids } },
    });
    // Preserve the order returned by the raw query (DESC by created_at).
    const byId = new Map(found.map((f) => [f.id, f] as const));
    const items = ids.map((id) => byId.get(id)).filter((x): x is PublicFormLog => Boolean(x));
    return { items, total };
  }

  /**
   * Bulk fetch for export. Either by IDs (selected rows) or all matching
   * the event + optional search filter. Hard-capped to avoid runaway exports.
   */
  async findForExport(params: {
    publicToken: string;
    ids?: string[];
    search?: string;
    limit?: number;
  }): Promise<PublicFormLog[]> {
    const limit = Math.min(params.limit ?? 10_000, 50_000);

    if (params.ids && params.ids.length > 0) {
      return this.prisma.publicFormLog.findMany({
        where: { publicToken: params.publicToken, id: { in: params.ids } },
        orderBy: { createdAt: 'desc' },
        take: limit,
      });
    }

    const { items } = await this.findEventLogs({
      publicToken: params.publicToken,
      page: 1,
      pageSize: limit,
      search: params.search,
    });
    return items;
  }
}

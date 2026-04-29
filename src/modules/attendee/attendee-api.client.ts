import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG } from '../../config/config.module';
import type { AppConfig } from '../../config/app-config';

export interface AttendeeEventInfo {
  publicToken: string;
  /** null means: lookup attempted but Attendee returned 404 / unreachable. */
  name: string | null;
  code: string | null;
  startAt: Date | null;
  endAt: Date | null;
  fetchedAt: Date;
}

interface CacheEntry {
  value: AttendeeEventInfo;
  expiresAt: number;
}

/**
 * Best-effort client to fetch event metadata from the Attendee API.
 * - Uses a small in-memory TTL cache (per public_token).
 * - Never throws to callers: a failure returns name=null and is cached briefly
 *   so we don't hammer the API.
 */
@Injectable()
export class AttendeeApiClient {
  private readonly logger = new Logger(AttendeeApiClient.name);
  private readonly cache = new Map<string, CacheEntry>();
  /** Negative-cache duration when the upstream call fails (avoid hammering). */
  private readonly negativeTtlMs = 60_000;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async getEventInfo(publicToken: string): Promise<AttendeeEventInfo> {
    const now = Date.now();
    const cached = this.cache.get(publicToken);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const value = await this.fetchOnce(publicToken);
    const ttlMs = value.name
      ? this.config.attendee.eventCacheTtlSec * 1000
      : this.negativeTtlMs;
    this.cache.set(publicToken, { value, expiresAt: now + ttlMs });
    return value;
  }

  /** Resolves multiple tokens in parallel, deduplicated. */
  async getMany(publicTokens: string[]): Promise<Map<string, AttendeeEventInfo>> {
    const unique = Array.from(new Set(publicTokens));
    const results = await Promise.all(unique.map((t) => this.getEventInfo(t)));
    const map = new Map<string, AttendeeEventInfo>();
    results.forEach((info, i) => map.set(unique[i], info));
    return map;
  }

  invalidate(publicToken?: string): void {
    if (publicToken) this.cache.delete(publicToken);
    else this.cache.clear();
  }

  private async fetchOnce(publicToken: string): Promise<AttendeeEventInfo> {
    const base = this.config.attendee.apiBaseUrl;
    const url = `${base}/api/public/events/${encodeURIComponent(publicToken)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.attendee.httpTimeoutMs);

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (res.status === 404) {
        return this.empty(publicToken);
      }
      if (!res.ok) {
        this.logger.warn(
          `attendee.event_lookup_failed token=${maskToken(publicToken)} status=${res.status}`,
        );
        return this.empty(publicToken);
      }

      const body = (await res.json()) as Record<string, unknown>;
      return {
        publicToken,
        name: typeof body.name === 'string' ? body.name : null,
        code: typeof body.code === 'string' ? body.code : null,
        startAt: parseDate(body.start_at),
        endAt: parseDate(body.end_at),
        fetchedAt: new Date(),
      };
    } catch (err) {
      this.logger.warn(
        `attendee.event_lookup_error token=${maskToken(publicToken)} error=${(err as Error).message}`,
      );
      return this.empty(publicToken);
    } finally {
      clearTimeout(timeout);
    }
  }

  private empty(publicToken: string): AttendeeEventInfo {
    return {
      publicToken,
      name: null,
      code: null,
      startAt: null,
      endAt: null,
      fetchedAt: new Date(),
    };
  }
}

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

function maskToken(t: string): string {
  return t.length <= 4 ? t : `${t.slice(0, 4)}***`;
}

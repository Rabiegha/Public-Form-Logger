/**
 * Strongly-typed configuration loaded from environment variables.
 *
 * - JWT_SECRET is REQUIRED — the app crashes at boot if missing or too short.
 * - All numeric values fall back to safe defaults aligned with the V1 design.
 */
export interface AppConfig {
  nodeEnv: 'development' | 'production' | 'test';
  port: number;

  /**
   * Optional URL prefix when the app is mounted under a sub-path
   * (e.g. behind a shared reverse proxy at https://api.attendee.fr/logger).
   * Empty string '' means root mount. Always starts with '/' when set.
   */
  basePath: string;

  databaseUrl: string;

  cors: {
    /** Bare hostnames (no scheme). e.g. ["choyou.fr", "itforbusiness.fr"] */
    origins: string[];
    /** With scheme, e.g. ["http://localhost:3000"] — exact match only. */
    explicitOrigins: string[];
  };

  admin: {
    seedEmail: string;
    seedPassword: string;
    jwtSecret: string;
    jwtExpiresIn: string;
    cookieSecure: boolean;
    cookieSameSite: 'lax' | 'strict' | 'none';
  };

  rateLimit: {
    publicPerIp: number;
    publicPerToken: number;
    loginMax: number;
    loginWindowMin: number;
  };

  payload: {
    httpBodyLimitBytes: number;
    maxFormPayloadBytes: number;
    maxFormPayloadKeys: number;
  };

  trustProxyHops: number;

  attendee: {
    /** Base URL of the Attendee API (used to fetch event names by public_token). */
    apiBaseUrl: string;
    /** Cache TTL in seconds for Attendee event metadata. */
    eventCacheTtlSec: number;
    /** HTTP timeout in ms for outbound calls to Attendee. */
    httpTimeoutMs: number;
  };
}

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v || v.trim() === '') {
    throw new Error(`[config] Missing required env variable: ${key}`);
  }
  return v;
}

function parseInt10(v: string | undefined, fallback: number): number {
  if (!v) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): AppConfig {
  const nodeEnv = (process.env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  const jwtSecret = requireEnv('JWT_SECRET');
  if (jwtSecret.length < 32) {
    throw new Error('[config] JWT_SECRET must be at least 32 characters long.');
  }

  const databaseUrl = requireEnv('DATABASE_URL');

  const rawOrigins = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  const explicitOrigins: string[] = [];
  const origins: string[] = [];
  for (const o of rawOrigins) {
    if (o.startsWith('http://') || o.startsWith('https://')) {
      explicitOrigins.push(o);
    } else {
      origins.push(o.toLowerCase());
    }
  }

  // Normalise BASE_PATH: '' | '/logger' (no trailing slash, leading slash required)
  let basePath = (process.env.BASE_PATH ?? '').trim();
  if (basePath) {
    if (!basePath.startsWith('/')) basePath = '/' + basePath;
    basePath = basePath.replace(/\/+$/, '');
  }

  return {
    nodeEnv,
    port: parseInt10(process.env.PORT, 4001),
    basePath,
    databaseUrl,
    cors: { origins, explicitOrigins },
    admin: {
      seedEmail: process.env.ADMIN_EMAIL ?? '',
      seedPassword: process.env.ADMIN_PASSWORD ?? '',
      jwtSecret,
      jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '8h',
      cookieSecure: (process.env.COOKIE_SECURE ?? 'false').toLowerCase() === 'true',
      cookieSameSite: (process.env.COOKIE_SAMESITE ?? 'lax') as 'lax' | 'strict' | 'none',
    },
    rateLimit: {
      publicPerIp: parseInt10(process.env.RATE_LIMIT_PUBLIC_PER_IP, 60),
      publicPerToken: parseInt10(process.env.RATE_LIMIT_PUBLIC_PER_TOKEN, 100),
      loginMax: parseInt10(process.env.RATE_LIMIT_LOGIN_MAX, 5),
      loginWindowMin: parseInt10(process.env.RATE_LIMIT_LOGIN_WINDOW_MIN, 15),
    },
    payload: {
      httpBodyLimitBytes: parseInt10(process.env.HTTP_BODY_LIMIT_BYTES, 102400),
      maxFormPayloadBytes: parseInt10(process.env.MAX_FORM_PAYLOAD_BYTES, 32768),
      maxFormPayloadKeys: parseInt10(process.env.MAX_FORM_PAYLOAD_KEYS, 100),
    },
    trustProxyHops: parseInt10(process.env.TRUST_PROXY_HOPS, 1),
    attendee: {
      apiBaseUrl: (process.env.ATTENDEE_API_BASE_URL ?? 'https://api.attendee.fr').replace(/\/+$/, ''),
      eventCacheTtlSec: parseInt10(process.env.ATTENDEE_EVENT_CACHE_TTL_SEC, 3600),
      httpTimeoutMs: parseInt10(process.env.ATTENDEE_HTTP_TIMEOUT_MS, 3000),
    },
  };
}

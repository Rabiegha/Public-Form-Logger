import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { AppConfig } from './app-config';

/**
 * Build a CORS validator that allows:
 *  - exact match against `cors.explicitOrigins` (with scheme, e.g. http://localhost:3000)
 *  - host equal to a bare domain in `cors.origins`
 *  - host that ends with `.<bare domain>` (subdomain support)
 *
 * Origins without an HTTP origin (server-to-server, curl) pass through.
 */
export function buildCorsOptions(config: AppConfig): CorsOptions {
  const explicit = new Set(config.cors.explicitOrigins.map((o) => o.toLowerCase()));
  const bareDomains = config.cors.origins.map((d) => d.toLowerCase());

  return {
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    origin: (origin, callback) => {
      if (!origin) {
        // Same-origin / non-browser request
        return callback(null, true);
      }

      const lower = origin.toLowerCase();
      if (explicit.has(lower)) {
        return callback(null, true);
      }

      let host: string;
      try {
        host = new URL(origin).hostname.toLowerCase();
      } catch {
        return callback(new Error(`CORS: invalid Origin header: ${origin}`), false);
      }

      const allowed = bareDomains.some(
        (domain) => host === domain || host.endsWith(`.${domain}`),
      );
      if (allowed) {
        return callback(null, true);
      }

      return callback(new Error(`CORS: origin not allowed: ${origin}`), false);
    },
  };
}

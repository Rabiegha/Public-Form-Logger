import { PublicFormLog } from '@prisma/client';

/**
 * Shape returned to the JSON admin endpoints / used by EJS views.
 *
 * Design (V2):
 *   - No hardcoded "main fields" anymore.
 *   - All form values come from `payload`, in the original payload order
 *     (= the order of fields in the landing-page form).
 *   - System fields (timestamp, IP, submission_id, …) live in `metadata`.
 */
export interface AdminLogRow {
  id: string;
  publicToken: string;
  submissionId: string | null;
  createdAt: string;
  formPayloadSize: number;
  landingPageUrl: string | null;
  referer: string | null;
  userAgent: string | null;
  ipAddress: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  /** Ordered list of payload keys (preserves insertion order). */
  payloadKeys: string[];
  /** Stringified payload values keyed by their original key. */
  payloadValues: Record<string, string | null>;
}

export function toAdminRow(log: PublicFormLog): AdminLogRow {
  const payload = (log.formPayload as Record<string, unknown> | null) ?? {};
  const payloadKeys = Object.keys(payload);
  const payloadValues = payloadKeys.reduce<Record<string, string | null>>((acc, key) => {
    const value = payload[key];
    acc[key] =
      value == null
        ? null
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value);
    return acc;
  }, {});

  return {
    id: log.id,
    publicToken: log.publicToken,
    submissionId: log.submissionId ?? null,
    createdAt: log.createdAt.toISOString(),
    formPayloadSize: log.formPayloadSize,
    landingPageUrl: log.landingPageUrl ?? null,
    referer: log.referer ?? null,
    userAgent: log.userAgent ?? null,
    ipAddress: log.ipAddress ?? null,
    utmSource: log.utmSource ?? null,
    utmMedium: log.utmMedium ?? null,
    utmCampaign: log.utmCampaign ?? null,
    payloadKeys,
    payloadValues,
  };
}

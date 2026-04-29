import {
  IsObject,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
} from 'class-validator';

/**
 * DTO for POST /v1/public-form-logs
 *
 * Field naming follows the **public API contract** (snake_case),
 * which is what landing pages send. Mapping to camelCase happens in the service.
 */
export class CreatePublicFormLogDto {
  /**
   * Public token identifying the event/landing page (issued by Attendee).
   *
   * Soft validation: 8–128 chars, [A-Za-z0-9_-].
   * The Logger does NOT enforce Attendee's exact format (16 chars [A-Za-z0-9])
   * to remain forward-compatible. A warning is logged if format mismatches.
   */
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{8,128}$/, {
    message: 'public_token must be 8-128 chars matching [A-Za-z0-9_-]',
  })
  public_token!: string;

  /**
   * Idempotency key. When provided, duplicate POSTs return 200 with the existing log.
   * When absent, the server generates an internal UUID and accepts duplicates.
   */
  @IsOptional()
  @IsString()
  @MaxLength(128)
  submission_id?: string;

  /**
   * Raw form payload. Validated server-side:
   *  - must be a non-empty plain object
   *  - serialized JSON size <= MAX_FORM_PAYLOAD_BYTES (32 KB)
   *  - first-level key count <= MAX_FORM_PAYLOAD_KEYS (100)
   */
  @IsObject()
  form_payload!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl({ require_tld: false }, { message: 'landing_page_url must be a valid URL' })
  landing_page_url?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utm_source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utm_medium?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  utm_campaign?: string;
}

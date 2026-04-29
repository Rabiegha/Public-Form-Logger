/**
 * Resolves the "main" attendee fields from a free-form form_payload.
 *
 * Each logical field maps to a set of common variant keys (snake_case,
 * camelCase, FR, with/without accents). The first matching key wins.
 *
 * Returned values are always strings (or null if missing). Non-string values
 * are coerced via String() to keep table cells display-friendly.
 */

export type MainFieldKey =
  | 'first_name'
  | 'last_name'
  | 'email'
  | 'company'
  | 'phone'
  | 'job_title';

export const MAIN_FIELD_LABELS: Record<MainFieldKey, string> = {
  first_name: 'Prénom',
  last_name: 'Nom',
  email: 'Email',
  company: 'Société',
  phone: 'Téléphone',
  job_title: 'Poste',
};

/** Ordered list of variants, lowercased. The first match in the payload wins. */
const VARIANTS: Record<MainFieldKey, string[]> = {
  first_name: ['first_name', 'firstname', 'first name', 'prenom', 'prénom', 'givenname', 'given_name'],
  last_name: ['last_name', 'lastname', 'last name', 'nom', 'familyname', 'family_name', 'surname'],
  email: ['email', 'e_mail', 'e-mail', 'mail', 'courriel', 'emailaddress', 'email_address'],
  company: ['company', 'societe', 'société', 'organization', 'organisation', 'entreprise', 'employer'],
  phone: ['phone', 'phonenumber', 'phone_number', 'telephone', 'téléphone', 'tel', 'mobile', 'portable'],
  job_title: ['job_title', 'jobtitle', 'job', 'title', 'poste', 'fonction', 'role', 'position'],
};

const ALL_FIELDS: MainFieldKey[] = ['first_name', 'last_name', 'email', 'company', 'phone', 'job_title'];

export function getMainFieldKeys(): MainFieldKey[] {
  return [...ALL_FIELDS];
}

/** Extract main field values from a payload, applying variant matching. */
export function extractMainFields(payload: unknown): Record<MainFieldKey, string | null> {
  const result: Record<MainFieldKey, string | null> = {
    first_name: null,
    last_name: null,
    email: null,
    company: null,
    phone: null,
    job_title: null,
  };
  if (!payload || typeof payload !== 'object') return result;

  // Build a lowercase->original-key index ONCE per call.
  const obj = payload as Record<string, unknown>;
  const index = new Map<string, string>();
  for (const k of Object.keys(obj)) {
    index.set(k.toLowerCase(), k);
  }

  for (const field of ALL_FIELDS) {
    for (const variant of VARIANTS[field]) {
      const realKey = index.get(variant);
      if (!realKey) continue;
      const v = obj[realKey];
      if (v === null || v === undefined || v === '') continue;
      result[field] = typeof v === 'string' ? v : String(v);
      break;
    }
  }
  return result;
}

/**
 * Returns the keys of the payload that are NOT among the main fields
 * (used to populate the "more fields" dropdown / detail view).
 */
export function extractExtraFields(payload: unknown): Array<{ key: string; value: unknown }> {
  if (!payload || typeof payload !== 'object') return [];
  const obj = payload as Record<string, unknown>;
  const usedLower = new Set<string>();
  const indexLower = new Set<string>(Object.keys(obj).map((k) => k.toLowerCase()));

  for (const field of ALL_FIELDS) {
    for (const variant of VARIANTS[field]) {
      if (indexLower.has(variant)) {
        usedLower.add(variant);
        break;
      }
    }
  }

  const extras: Array<{ key: string; value: unknown }> = [];
  for (const k of Object.keys(obj)) {
    if (!usedLower.has(k.toLowerCase())) {
      extras.push({ key: k, value: obj[k] });
    }
  }
  return extras;
}

/**
 * ca-postal-intel: Canadian postal-code intelligence.
 *
 * Pure business logic — no MCP dependency. Data comes from a compact
 * FSA-level index (data/fsa-index.json) built at build time from the
 * community-sourced GeoNames CA dataset (CC-BY 4.0). All lookups are
 * FSA-level (first 3 characters of the postal code); nothing here is
 * Canada Post official data.
 */

import { readFileSync } from "node:fs";

// ============================================================================
// Index loading
// ============================================================================

export interface FsaRecord {
  province_code: string | null;
  province_name: string | null;
  communities: string[];
  latitude: number | null;
  longitude: number | null;
}

interface FsaIndex {
  meta: Record<string, unknown>;
  fsas: Record<string, FsaRecord>;
}

let index: FsaIndex | null = null;
let indexError: string | null = null;

function loadIndex(): FsaIndex {
  if (index) return index;
  if (indexError) throw new Error(indexError);
  try {
    const raw = readFileSync(new URL("../../data/fsa-index.json", import.meta.url), "utf8");
    index = JSON.parse(raw) as FsaIndex;
    if (!index.fsas || typeof index.fsas !== "object") {
      throw new Error("index file is missing the 'fsas' object");
    }
    return index;
  } catch (err) {
    indexError = `Postal index unavailable: ${err instanceof Error ? err.message : String(err)}`;
    throw new Error(indexError);
  }
}

export function indexStats(): { fsaCount: number; source: string } {
  const idx = loadIndex();
  return {
    fsaCount: Object.keys(idx.fsas).length,
    source: String(idx.meta?.source ?? "GeoNames.org"),
  };
}

// ============================================================================
// Static reference data (approximate — documented in README)
// ============================================================================

/**
 * Provincial timezone approximation. Marked approximate because several
 * provinces span more than one observed time zone:
 *  - ON: northwestern Ontario (e.g. Kenora) observes Central Time
 *  - BC: the Peace River / Creston areas observe Mountain Time
 *  - QC: the Lower North Shore observes Atlantic Time
 *  - NL: Labrador outside the island observes Atlantic Time
 *  - NU: spans Eastern, Central and Mountain Time
 */
const PROVINCE_TIMEZONES: Record<string, string> = {
  ON: "America/Toronto",
  QC: "America/Montreal",
  BC: "America/Vancouver",
  AB: "America/Edmonton",
  SK: "America/Regina",
  MB: "America/Winnipeg",
  NS: "America/Halifax",
  NB: "America/Moncton",
  NL: "America/St_Johns",
  PE: "America/Halifax",
  YT: "America/Whitehorse",
  NT: "America/Yellowknife",
  NU: "America/Iqaluit",
};

/**
 * NANP area codes mapped to province codes. Approximate: assignments shift
 * over time, 902 is shared between NS and PE, and 867 covers all three
 * territories. Some area codes are assigned but not yet widely in use.
 */
const AREA_CODE_PROVINCES: Record<string, string[]> = {
  "204": ["MB"],
  "226": ["ON"],
  "236": ["BC"],
  "249": ["ON"],
  "250": ["BC"],
  "263": ["QC"],
  "289": ["ON"],
  "306": ["SK"],
  "343": ["ON"],
  "354": ["QC"],
  "365": ["ON"],
  "367": ["QC"],
  "403": ["AB"],
  "416": ["ON"],
  "418": ["QC"],
  "428": ["NB"],
  "431": ["MB"],
  "437": ["ON"],
  "438": ["QC"],
  "450": ["QC"],
  "506": ["NB"],
  "514": ["QC"],
  "519": ["ON"],
  "548": ["ON"],
  "579": ["QC"],
  "581": ["QC"],
  "584": ["MB"],
  "587": ["AB"],
  "604": ["BC"],
  "613": ["ON"],
  "639": ["SK"],
  "647": ["ON"],
  "672": ["BC"],
  "705": ["ON"],
  "709": ["NL"],
  "778": ["BC"],
  "780": ["AB"],
  "782": ["NS"],
  "807": ["ON"],
  "819": ["QC"],
  "825": ["AB"],
  "867": ["NT", "YT", "NU"],
  "873": ["QC"],
  "879": ["NL"],
  "902": ["NS", "PE"],
  "905": ["ON"],
};

const PROVINCE_AREA_CODES: Record<string, string[]> = {};
for (const [code, provinces] of Object.entries(AREA_CODE_PROVINCES)) {
  for (const province of provinces) {
    if (!PROVINCE_AREA_CODES[province]) PROVINCE_AREA_CODES[province] = [];
    PROVINCE_AREA_CODES[province].push(code);
  }
}
for (const codes of Object.values(PROVINCE_AREA_CODES)) {
  codes.sort((a, b) => Number(a) - Number(b));
}

export function timezoneForProvince(provinceCode: string): string | null {
  return PROVINCE_TIMEZONES[provinceCode] ?? null;
}

export function areaCodesForProvince(provinceCode: string): string[] {
  return [...(PROVINCE_AREA_CODES[provinceCode] ?? [])];
}

// ============================================================================
// Normalization & classification
// ============================================================================

const FSA_RE = /^[A-Z]\d[A-Z]$/;
const FULL_CODE_RE = /^[A-Z]\d[A-Z]\d[A-Z]\d$/;

/**
 * Normalize a postal code input. Accepts "K1A 0B1", "k1a0b1", "K1A".
 * Returns "K1A 0B1" for full codes, "K1A" for FSA-only input, null when
 * the input is not a valid Canadian postal-code shape.
 */
export function normalizePostalCode(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const compact = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (FULL_CODE_RE.test(compact)) {
    return `${compact.slice(0, 3)} ${compact.slice(3)}`;
  }
  if (FSA_RE.test(compact)) {
    return compact;
  }
  return null;
}

/**
 * Rural FSAs have '0' as their second character per Canada Post convention
 * (e.g. T0A); everything else is urban.
 */
export function classifyUrbanRural(fsa: string): "urban" | "rural" {
  return fsa.length === 3 && fsa[1] === "0" ? "rural" : "urban";
}

// ============================================================================
// Tool implementations
// ============================================================================

export interface PostalLookupResult {
  [key: string]: unknown;
  postal_code: string;
  fsa: string;
  city: string;
  province_code: string | null;
  province_name: string | null;
  timezone: string | null;
  latitude: number | null;
  longitude: number | null;
  urban_rural: "urban" | "rural";
  area_codes: string[];
  granularity_note: string;
}

export function lookupPostalCode(postalCode: unknown): PostalLookupResult {
  const normalized = normalizePostalCode(postalCode);
  if (!normalized) {
    throw new Error(
      `Invalid postal code "${String(postalCode).slice(0, 40)}". ` +
        `Expected format "K1A 0B1" (or a 3-character FSA like "K1A").`
    );
  }
  const idx = loadIndex();
  const fsa = normalized.slice(0, 3);
  const record = idx.fsas[fsa];
  if (!record) {
    throw new Error(
      `FSA "${fsa}" not found in the postal index. ` +
        `The index covers ${Object.keys(idx.fsas).length} Canadian FSAs from community-sourced GeoNames data. ` +
        `Use validate_postal_code to check FSA coverage.`
    );
  }
  const provinceCode = record.province_code ?? "";
  return {
    postal_code: normalized,
    fsa,
    city: record.communities[0] ?? "",
    province_code: record.province_code,
    province_name: record.province_name,
    timezone: timezoneForProvince(provinceCode),
    latitude: record.latitude,
    longitude: record.longitude,
    urban_rural: classifyUrbanRural(fsa),
    area_codes: areaCodesForProvince(provinceCode),
    granularity_note: "FSA-level data",
  };
}

export interface PostalValidationResult {
  [key: string]: unknown;
  valid_format: boolean;
  fsa_exists: boolean;
  normalized: string | null;
}

export function validatePostalCode(postalCode: unknown): PostalValidationResult {
  const normalized = normalizePostalCode(postalCode);
  if (!normalized) {
    return { valid_format: false, fsa_exists: false, normalized: null };
  }
  const idx = loadIndex();
  const fsa = normalized.slice(0, 3);
  return {
    valid_format: true,
    fsa_exists: Boolean(idx.fsas[fsa]),
    normalized,
  };
}

export interface FsaRegionResult {
  [key: string]: unknown;
  fsa: string;
  province_code: string | null;
  province_name: string | null;
  region_name: string;
  communities: string[];
}

export function fsaToRegion(fsaInput: unknown): FsaRegionResult {
  if (typeof fsaInput !== "string" || !FSA_RE.test(fsaInput.trim().toUpperCase())) {
    throw new Error(
      `Invalid FSA "${String(fsaInput).slice(0, 40)}". ` +
        `An FSA is exactly 3 characters, e.g. "K1A", "M5V", "V6B".`
    );
  }
  const fsa = fsaInput.trim().toUpperCase();
  const idx = loadIndex();
  const record = idx.fsas[fsa];
  if (!record) {
    throw new Error(
      `FSA "${fsa}" not found in the postal index. ` +
        `Use validate_postal_code to check FSA coverage.`
    );
  }
  return {
    fsa,
    province_code: record.province_code,
    province_name: record.province_name,
    region_name: record.communities[0] ?? "",
    communities: [...record.communities],
  };
}

// ============================================================================
// Freemium quota (in-memory, per UTC day)
// ============================================================================

function freeDailyLimit(): number {
  const raw = process.env.FREE_DAILY_LIMIT;
  const parsed = raw !== undefined ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 50;
}

const dailyUsage = new Map<string, number>();

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function resetQuotaForTesting(): void {
  dailyUsage.clear();
}

/**
 * Throws a quota error when the free daily limit is exceeded.
 * The error message is the user-facing upsell copy.
 */
export function checkFreeQuota(): void {
  const limit = freeDailyLimit();
  const key = todayKey();
  const used = dailyUsage.get(key) ?? 0;
  if (used >= limit) {
    throw new QuotaExceededError(limit);
  }
  dailyUsage.set(key, used + 1);
}

export class QuotaExceededError extends Error {
  readonly limit: number;
  constructor(limit: number) {
    super(
      `Free quota exceeded (${limit}/day). Subscribe to Pro for unlimited access.`
    );
    this.name = "QuotaExceededError";
    this.limit = limit;
  }
}

export function quotaStatus(): { limit: number; usedToday: number } {
  return { limit: freeDailyLimit(), usedToday: dailyUsage.get(todayKey()) ?? 0 };
}

import { describe, it, expect, beforeEach } from "vitest";
import {
  lookupPostalCode,
  validatePostalCode,
  fsaToRegion,
  normalizePostalCode,
  classifyUrbanRural,
  areaCodesForProvince,
  timezoneForProvince,
  indexStats,
  checkFreeQuota,
  resetQuotaForTesting,
  QuotaExceededError,
} from "../src/lib/postal.js";
import {
  handleLookupPostalCode,
  handleValidatePostalCode,
  handleFsaToRegion,
} from "../src/tools.js";

describe("index", () => {
  it("loads ~1,650 FSAs from GeoNames", () => {
    const stats = indexStats();
    expect(stats.fsaCount).toBeGreaterThan(1600);
    expect(stats.source).toContain("GeoNames");
  });
});

describe("normalizePostalCode", () => {
  it("normalizes 'k1a 0b1' to 'K1A 0B1'", () => {
    expect(normalizePostalCode("k1a 0b1")).toBe("K1A 0B1");
  });
  it("accepts compact 'm5v2t6'", () => {
    expect(normalizePostalCode("m5v2t6")).toBe("M5V 2T6");
  });
  it("accepts FSA-only input", () => {
    expect(normalizePostalCode("v6b")).toBe("V6B");
  });
  it("rejects 'XYZ'", () => {
    expect(normalizePostalCode("XYZ")).toBeNull();
  });
  it("rejects empty string", () => {
    expect(normalizePostalCode("")).toBeNull();
  });
  it("rejects non-string", () => {
    expect(normalizePostalCode(null)).toBeNull();
  });
});

describe("classifyUrbanRural", () => {
  it("marks T0A rural (second char '0')", () => {
    expect(classifyUrbanRural("T0A")).toBe("rural");
  });
  it("marks M5V urban", () => {
    expect(classifyUrbanRural("M5V")).toBe("urban");
  });
});

describe("lookupPostalCode", () => {
  it("looks up K1A (Ottawa)", () => {
    const r = lookupPostalCode("K1A 0B1");
    expect(r.postal_code).toBe("K1A 0B1");
    expect(r.fsa).toBe("K1A");
    expect(r.province_code).toBe("ON");
    expect(r.province_name).toBe("Ontario");
    expect(r.timezone).toBe("America/Toronto");
    expect(r.urban_rural).toBe("urban");
    expect(typeof r.latitude).toBe("number");
    expect(typeof r.longitude).toBe("number");
    expect(r.area_codes.length).toBeGreaterThan(0);
    expect(r.area_codes).toContain("613");
    expect(r.granularity_note).toBe("FSA-level data");
    expect(r.city.length).toBeGreaterThan(0);
  });

  it("looks up M5V (Toronto)", () => {
    const r = lookupPostalCode("M5V");
    expect(r.postal_code).toBe("M5V");
    expect(r.fsa).toBe("M5V");
    expect(r.province_code).toBe("ON");
    expect(r.timezone).toBe("America/Toronto");
  });

  it("looks up V6B (Vancouver) with BC timezone and area codes", () => {
    const r = lookupPostalCode("v6b 1a1");
    expect(r.province_code).toBe("BC");
    expect(r.timezone).toBe("America/Vancouver");
    expect(r.area_codes).toContain("604");
  });

  it("marks rural FSA T0A as rural", () => {
    const r = lookupPostalCode("T0A");
    expect(r.urban_rural).toBe("rural");
    expect(r.province_code).toBe("AB");
  });

  it("throws friendly error for bad format 'XYZ'", () => {
    expect(() => lookupPostalCode("XYZ")).toThrow(/Invalid postal code/);
  });

  it("throws friendly error for empty input", () => {
    expect(() => lookupPostalCode("")).toThrow(/Invalid postal code/);
  });

  it("throws friendly error for valid format but unknown FSA 'D9A'", () => {
    expect(() => lookupPostalCode("D9A 1A1")).toThrow(/not found in the postal index/);
  });
});

describe("validatePostalCode", () => {
  it("validates 'M5V 2T6' as valid with existing FSA", () => {
    expect(validatePostalCode("M5V 2T6")).toEqual({
      valid_format: true,
      fsa_exists: true,
      normalized: "M5V 2T6",
    });
  });

  it("normalizes FSA-only 'k1a'", () => {
    expect(validatePostalCode("k1a")).toEqual({
      valid_format: true,
      fsa_exists: true,
      normalized: "K1A",
    });
  });

  it("flags 'D9A' as valid format but unknown FSA", () => {
    expect(validatePostalCode("D9A")).toEqual({
      valid_format: true,
      fsa_exists: false,
      normalized: "D9A",
    });
  });

  it("flags 'XYZ' as invalid format", () => {
    expect(validatePostalCode("XYZ")).toEqual({
      valid_format: false,
      fsa_exists: false,
      normalized: null,
    });
  });

  it("flags empty string as invalid", () => {
    expect(validatePostalCode("")).toEqual({
      valid_format: false,
      fsa_exists: false,
      normalized: null,
    });
  });
});

describe("fsaToRegion", () => {
  it("resolves K1A (Ottawa)", () => {
    const r = fsaToRegion("K1A");
    expect(r.fsa).toBe("K1A");
    expect(r.province_code).toBe("ON");
    expect(r.region_name.length).toBeGreaterThan(0);
    expect(r.communities.length).toBeGreaterThan(0);
  });

  it("resolves V6B (Vancouver)", () => {
    const r = fsaToRegion("v6b");
    expect(r.fsa).toBe("V6B");
    expect(r.province_code).toBe("BC");
    expect(r.province_name).toBe("British Columbia");
  });

  it("resolves rural T0A", () => {
    const r = fsaToRegion("T0A");
    expect(r.province_code).toBe("AB");
  });

  it("throws friendly error for 'XX'", () => {
    expect(() => fsaToRegion("XX")).toThrow(/Invalid FSA/);
  });

  it("throws friendly error for unknown FSA 'D9A'", () => {
    expect(() => fsaToRegion("D9A")).toThrow(/not found/);
  });
});

describe("reference mappings", () => {
  it("maps ON area codes including 416", () => {
    expect(areaCodesForProvince("ON")).toContain("416");
  });
  it("maps BC timezone to America/Vancouver", () => {
    expect(timezoneForProvince("BC")).toBe("America/Vancouver");
  });
  it("returns null timezone for unknown province", () => {
    expect(timezoneForProvince("XX")).toBeNull();
  });
});

describe("quota", () => {
  beforeEach(() => {
    resetQuotaForTesting();
  });

  it("enforces FREE_DAILY_LIMIT and produces upsell copy", () => {
    process.env.FREE_DAILY_LIMIT = "2";
    checkFreeQuota();
    checkFreeQuota();
    let err: unknown;
    try {
      checkFreeQuota();
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(QuotaExceededError);
    expect((err as Error).message).toContain("Free quota exceeded (2/day)");
    expect((err as Error).message).toContain("Subscribe to Pro");
    delete process.env.FREE_DAILY_LIMIT;
    resetQuotaForTesting();
  });

  it("defaults to 50 when env is unset", () => {
    delete process.env.FREE_DAILY_LIMIT;
    for (let i = 0; i < 50; i++) checkFreeQuota();
    expect(() => checkFreeQuota()).toThrow(QuotaExceededError);
    resetQuotaForTesting();
  });
});

describe("tool handlers (MCP response shape)", () => {
  beforeEach(() => {
    delete process.env.FREE_DAILY_LIMIT;
    resetQuotaForTesting();
  });

  it("handleLookupPostalCode returns content + structuredContent for K1A 0B1", async () => {
    const r = await handleLookupPostalCode({ postal_code: "K1A 0B1" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.fsa).toBe("K1A");
    expect(r.structuredContent.province_code).toBe("ON");
    const parsed = JSON.parse(r.content[0].text);
    expect(parsed.fsa).toBe("K1A");
  });

  it("handleLookupPostalCode returns isError for 'XYZ'", async () => {
    const r = await handleLookupPostalCode({ postal_code: "XYZ" });
    expect(r.isError).toBe(true);
    expect(String(r.structuredContent.error)).toContain("Invalid postal code");
  });

  it("handleValidatePostalCode returns structured result for 'M5V 2T6'", async () => {
    const r = await handleValidatePostalCode({ postal_code: "M5V 2T6" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent).toMatchObject({
      valid_format: true,
      fsa_exists: true,
      normalized: "M5V 2T6",
    });
  });

  it("handleValidatePostalCode returns isError:false shape for ''", async () => {
    const r = await handleValidatePostalCode({ postal_code: "" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.valid_format).toBe(false);
  });

  it("handleFsaToRegion resolves 'V6B'", async () => {
    const r = await handleFsaToRegion({ fsa: "V6B" });
    expect(r.isError).toBeUndefined();
    expect(r.structuredContent.province_code).toBe("BC");
    expect((r.structuredContent.communities as string[]).length).toBeGreaterThan(0);
  });

  it("handleFsaToRegion returns isError for 'XX'", async () => {
    const r = await handleFsaToRegion({ fsa: "XX" });
    expect(r.isError).toBe(true);
    expect(String(r.structuredContent.error)).toContain("Invalid FSA");
  });
});

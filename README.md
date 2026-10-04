# ca-postal-intel — Canadian Postal Code Intelligence

[![MCPize](https://mcpize.com/badge/@mcpize/mcpize?type=hosted)](https://mcpize.com)

MCP server that turns any Canadian postal code into actionable location intelligence:
community, province, approximate timezone, centroid coordinates, urban/rural classification,
and NANP area codes — from a bundled FSA-level index, no API calls, no API key.

## Tools

| Tool | Description | Input | Output highlights |
|------|-------------|-------|-------------------|
| `lookup_postal_code` | Look up a Canadian postal code (full code or 3-char FSA) | `postal_code`: string, e.g. `"K1A 0B1"`, `"k1a0b1"`, `"K1A"` | normalized code, FSA, city, province, approximate IANA timezone, centroid lat/lon, `urban`/`rural`, area codes |
| `validate_postal_code` | Validate format and check FSA coverage | `postal_code`: string | `valid_format`, `fsa_exists`, `normalized` |
| `fsa_to_region` | Resolve an FSA to its province and region name | `fsa`: 3-char string, e.g. `"K1A"` | FSA, province, region name, communities |

All tools return structured JSON via both `content` (text) and `structuredContent`.
All three tools count as lookups against the free quota (50/day).

## Data sources

- **GeoNames.org Canada postal dataset** — http://download.geonames.org/export/zip/CA.zip
  (License: [CC-BY 4.0](https://www.geonames.org)). At build time the full
  tab-separated dump is reduced to a compact FSA-level index
  (`data/fsa-index.json`) keyed by forward sortation area (~1,650 FSAs, all 13
  provinces/territories): representative community, centroid latitude/longitude,
  province. The raw dump is not bundled or loaded at runtime.
- **NANP area codes** — a small static mapping of North American Numbering Plan
  area codes to Canadian provinces, compiled from public NANP data and bundled
  in code (see `src/lib/postal.ts`). Approximate: assignments shift over time,
  `902` is shared between Nova Scotia and PEI, and `867` covers all three
  territories.
- **Timezones** — provincial IANA timezone approximations in code
  (e.g. ON → `America/Toronto`, BC → `America/Vancouver`).

## Limitations (read before relying on results)

1. **Community-sourced data, not Canada Post official.** The underlying dataset is
   GeoNames' volunteer-maintained CA dump (CC-BY 4.0), not Canada Post's official
   addressing data. FSA boundaries, community names, and coordinates are
   representative, not authoritative.
2. **FSA-level precision.** Results describe the first 3 characters of the postal
   code (e.g. `K1A`), not the full 6-character code. A city like Toronto has
   ~100 FSAs; a lookup for `M5V 2T6` returns data for `M5V` as a whole. Do not use
   this for delivery-level addressing, geocoding with street precision, or
   emergency/compliance purposes.
3. **Timezone is approximate.** Several provinces span more than one observed
   time zone: northwestern Ontario (e.g. Kenora) observes Central Time; parts of
   eastern BC (Peace River, Creston) observe Mountain Time; Quebec's Lower North
   Shore observes Atlantic Time; Labrador (outside the island) observes Atlantic
   Time; Nunavut spans three zones. The returned IANA zone is the province's
   majority zone — verify against a timezone service if it matters.

## Development

```bash
npm install
npm run dev     # Development mode with hot reload (port 8080)
npm test        # unit tests (vitest)
npm run build   # compile to dist/
node scripts/build-index.mjs /path/to/CA.txt data/fsa-index.json  # rebuild index
bash test-mcp.sh    # protocol smoke test (server must be running)
```

## Pricing

- **Free:** 50 lookups/day (enforced in code, configurable via `FREE_DAILY_LIMIT`)
- **Pro:** $9/mo, unlimited
- **x402:** $0.01/call on all tools

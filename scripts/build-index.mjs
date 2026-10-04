// Build-time script: converts the GeoNames CA postal dataset (CA.txt) into a
// compact FSA-level index JSON bundled with the server.
// Usage: node scripts/build-index.mjs <path-to-CA.txt> <output-json>
//
// GeoNames CA.txt columns (tab-separated):
//   country, postalcode, placename, admin1 name, admin1 code,
//   admin2 name, admin2 code, admin3 name, admin3 code,
//   latitude, longitude, accuracy
//
// NOTE: GeoNames' CA dataset is published at FSA granularity (e.g. "K1A"),
// not full 6-character postal codes. Two stray full-code rows are folded to
// their FSA and skipped when the FSA row already exists.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [srcPath, outPath] = process.argv.slice(2);
if (!srcPath || !outPath) {
  console.error("Usage: node scripts/build-index.mjs <CA.txt> <out.json>");
  process.exit(1);
}

const text = readFileSync(srcPath, "utf8");
const lines = text.split("\n");

const index = {};
let skipped = 0;

for (const line of lines) {
  if (!line.trim()) continue;
  const cols = line.split("\t");
  if (cols.length < 11) {
    skipped++;
    continue;
  }
  const [country, rawCode, placeName, admin1Name, admin1Code] = cols;
  if (country !== "CA") {
    skipped++;
    continue;
  }

  // Fold any full 6-char codes down to their FSA; skip if FSA already indexed.
  const code = rawCode.replace(/\s+/g, "").toUpperCase();
  if (!/^[A-Z]\d[A-Z](\d[A-Z]\d)?$/.test(code)) {
    skipped++;
    continue;
  }
  const fsa = code.slice(0, 3);
  if (index[fsa] && code.length > 3) {
    skipped++;
    continue;
  }
  if (index[fsa]) continue; // first (FSA-level) row wins

  const lat = parseFloat(cols[9]);
  const lon = parseFloat(cols[10]);
  index[fsa] = {
    province_code: admin1Code || null,
    province_name: admin1Name || null,
    // GeoNames CA rows carry one representative place name per FSA.
    communities: [placeName || null].filter(Boolean),
    latitude: Number.isFinite(lat) ? lat : null,
    longitude: Number.isFinite(lon) ? lon : null,
  };
}

const fsaCount = Object.keys(index).length;
const payload = {
  meta: {
    source: "GeoNames.org postal code dataset (Canada)",
    source_url: "http://download.geonames.org/export/zip/CA.zip",
    license: "CC-BY 4.0",
    license_url: "https://www.geonames.org",
    granularity: "FSA (forward sortation area, first 3 characters)",
    generated_at: new Date().toISOString().slice(0, 10),
    fsa_count: fsaCount,
  },
  fsas: index,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, JSON.stringify(payload, null, 2) + "\n");
console.log(`Wrote ${outPath}: ${fsaCount} FSAs, ${skipped} rows skipped.`);

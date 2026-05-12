/**
 * merge_use_case.js — Merge use_case_map.json vào catalog.json
 * 
 * Chạy: node tools/merge_use_case.js
 * 
 * - Đọc wiki/models/use_case_map.json
 * - Đọc wiki/models/catalog.json
 * - Gộp field "use_case" vào từng model theo slug
 * - Ghi đè catalog.json
 * - Report: matched, missing, extra
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG_PATH = path.join(ROOT, 'wiki/models/catalog.json');
const USE_CASE_PATH = path.join(ROOT, 'wiki/models/use_case_map.json');

// --- Load files ---
const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
const useCaseData = JSON.parse(fs.readFileSync(USE_CASE_PATH, 'utf8'));

// --- Validate use_case values ---
const VALID_USE_CASES = new Set(useCaseData._schema.valid_use_cases);

// Build slug → use_case map
const ucMap = new Map();
for (const entry of useCaseData.models) {
  const invalid = (entry.use_case || []).filter(uc => !VALID_USE_CASES.has(uc));
  if (invalid.length) {
    console.error(`❌ INVALID use_case for "${entry.slug}": ${invalid.join(', ')}`);
    process.exit(1);
  }
  ucMap.set(entry.slug, entry.use_case || []);
}

// --- Merge ---
let matched = 0;
let missing = [];
const catalogSlugs = new Set();

for (const model of catalog.models) {
  catalogSlugs.add(model.slug);
  if (ucMap.has(model.slug)) {
    model.use_case = ucMap.get(model.slug);
    matched++;
  } else {
    // Không có trong use_case_map → set rỗng
    model.use_case = [];
    missing.push(model.slug);
  }
}

// Check extra slugs in use_case_map mà không có trong catalog
const extra = [];
for (const slug of ucMap.keys()) {
  if (!catalogSlugs.has(slug)) {
    extra.push(slug);
  }
}

// --- Write ---
fs.writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n', 'utf8');

// --- Report ---
console.log('');
console.log('✅ Merge hoàn tất!');
console.log(`   📦 Total models in catalog: ${catalog.models.length}`);
console.log(`   ✅ Matched & merged: ${matched}`);
if (missing.length) {
  console.log(`   ⚠️  Missing in use_case_map (set []): ${missing.length}`);
  missing.forEach(s => console.log(`      - ${s}`));
}
if (extra.length) {
  console.log(`   ❌ Extra in use_case_map (not in catalog): ${extra.length}`);
  extra.forEach(s => console.log(`      - ${s}`));
}
console.log('');
console.log(`   📄 Updated: ${CATALOG_PATH}`);

// FILTER ENGINE + MARKDOWN TRIMMER + FAQ INTENT FILTER + COMPARISON + ROLLING PRICE CALC
// Paste vào n8n node: "Code in JavaScript" (sau Switch.SALES_LEAD)
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

// === Entity từ Router ===
const brand = (d.brand || "").toLowerCase().trim();
const model_slug = (d.model_slug || "").toLowerCase().trim();
const car_type = (d.car_type || "").toLowerCase().trim();
const seat_min = d.seat_min ? Number(d.seat_min) : null;
const fuel = (d.fuel || "").toLowerCase().trim();
const budget_max = d.budget_max ? Number(d.budget_max) : null;
const price_sort = (d.price_sort || "").toLowerCase().trim();
const qa_intents = Array.isArray(d.qa_intents) ? d.qa_intents : [];

// === Entity so sánh ===
const compare_target = (d.compare_target || "").toLowerCase().trim();
const compare_with_brand = (d.compare_with_brand || "").toLowerCase().trim();
const compare_with_model = (d.compare_with_model || "").trim();

const sales_subcategory = (d.sales_subcategory || "consultation").toLowerCase().trim();
const province = (d.province || "ho-chi-minh").toLowerCase().trim();

// === Đếm SALES_LEAD turn để trigger lead capture ===
const history = (d._prev?.history) || [];
const sales_turn_count = history.filter(h => h.intent === 'SALES_LEAD').length;
const should_capture_lead = sales_turn_count >= 2;

const THACO_BRANDS = ['kia', 'mazda', 'peugeot', 'bmw', 'mini', 'thaco-truck', 'thaco-bus'];

// =========================================================
// HELPER 1: Trim markdown — chỉ giữ section H2 trong allowlist
// =========================================================
function trimMarkdown(md, allowlist, opts = {}) {
  if (!md || typeof md !== 'string') return '';
  const maxChars = opts.maxChars || 3500;
  md = md.replace(/^---[\s\S]*?---\s*/m, '');
  md = md.replace(/^>.*$/gm, '');
  md = md.replace(/!\[[^\]]*\]\([^\)]*\)/g, '');
  const parts = md.split(/^## /m);
  const intro = parts.shift() || '';
  let kept = intro.trim() + '\n';
  for (const part of parts) {
    const heading = part.split('\n')[0].toLowerCase();
    if (allowlist.some(k => heading.includes(k.toLowerCase()))) {
      kept += '\n## ' + part.trim() + '\n';
    }
  }
  if (kept.length > maxChars) kept = kept.slice(0, maxChars) + '\n...[đã rút gọn]';
  return kept.trim();
}

// =========================================================
// HELPER 1B: Extract chỉ Tóm tắt + Trang bị nổi bật phiên bản đầu (cho compare)
// =========================================================
function extractCompareMd(md) {
  if (!md || typeof md !== 'string') return '';
  md = md.replace(/^---[\s\S]*?---\s*/m, '');
  md = md.replace(/^>.*$/gm, '');
  md = md.replace(/!\[[^\]]*\]\([^\)]*\)/g, '');

  // Split theo ^## để lấy từng section H2 — tránh dùng \Z (không hỗ trợ trong JS regex,
  // bị hiểu là literal Z và với /i flag thành [Zz] → cắt sai ở chữ z trong "mazda")
  const sections = md.split(/^## /m);
  let result = '';

  // 1. Section Tóm tắt
  for (const sec of sections.slice(1)) {
    const heading = sec.split('\n')[0].toLowerCase();
    if (heading.includes('tóm tắt') || heading.includes('tom tat')) {
      result += '## ' + sec.trim() + '\n\n';
      break;
    }
  }

  // 2. Section Trang bị nổi bật → chỉ giữ phiên bản H3 đầu tiên
  for (const sec of sections.slice(1)) {
    const heading = sec.split('\n')[0].toLowerCase();
    if (heading.includes('trang bị nổi bật')) {
      const h3Parts = sec.split(/^### /m);
      if (h3Parts.length >= 2) {
        const header = '## ' + h3Parts[0].trim();
        const firstVersion = h3Parts[1].trim();
        result += `${header}\n\n### ${firstVersion}\n`;
      } else {
        result += '## ' + sec.trim() + '\n';
      }
      break;
    }
  }

  return result.trim();
}

// =========================================================
// HELPER 1C: Tính giá lăn bánh — fetch policy + compute theo seat + brand
// =========================================================
let _rollingPolicy = null;
async function calcRollingPrice(modelPrice, provinceArg, seatArg, brandArg) {
  if (!modelPrice || modelPrice <= 0) return null;
  try {
    if (!_rollingPolicy) {
      const data = await this.helpers.httpRequest({
        method: 'GET',
        url: base + 'wiki/policies/rolling-price.json',
        json: true,
        returnFullResponse: false
      });
      _rollingPolicy = (typeof data === 'string') ? JSON.parse(data) : data;
    }
    const p = _rollingPolicy;

    // 1. Province → phí trước bạ % + phí biển số
    const provinceKey = (p.registration_fee_pct[provinceArg]) ? provinceArg : 'default';
    const reg_pct = p.registration_fee_pct[provinceKey];
    const plate = p.license_plate_fee_vnd[provinceKey];
    const reg_fee = Math.round(modelPrice * reg_pct);

    // 2. Bảo hiểm vật chất theo % giá xe
    const physical_ins = Math.round(modelPrice * p.physical_insurance_pct);

    // 3. TNDS theo SỐ CHỖ NGỒI
    const seatNum = Number(seatArg || 5);
    let tnds;
    let tnds_tier;
    if (seatNum <= 5) {
      tnds = p.tnds_insurance_yr_vnd['5_seat_or_less'];
      tnds_tier = '≤5 chỗ';
    } else if (seatNum <= 7) {
      tnds = p.tnds_insurance_yr_vnd['6_to_7_seat'];
      tnds_tier = '6-7 chỗ';
    } else {
      tnds = p.tnds_insurance_yr_vnd['8_seat_or_more'];
      tnds_tier = '≥8 chỗ';
    }

    // 4. Service fee theo BRAND
    const brandKey = (brandArg || '').toLowerCase().trim();
    const service_fee = p.service_fee_vnd.by_brand[brandKey] || p.service_fee_vnd.default;

    // 5. Phí cố định
    const inspection = p.fixed_fees_vnd.inspection;
    const road_maintenance = p.fixed_fees_vnd.road_maintenance_yr;

    // 6. Tổng
    const total = modelPrice + reg_fee + plate
      + inspection + road_maintenance + tnds + service_fee
      + physical_ins;

    return {
      province_used: provinceKey,
      registration_fee_pct: reg_pct,
      seat_used: seatNum,
      tnds_tier,
      brand_used: brandKey || 'default',
      breakdown: {
        model_price: modelPrice,
        registration_fee: reg_fee,
        license_plate: plate,
        inspection,
        road_maintenance,
        tnds_insurance: tnds,
        service_fee,
        physical_insurance: physical_ins
      },
      total,
      labels: p.fee_labels_vi,
      notes: p.notes
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Format helper VNĐ
function fmtVnd(n) {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('de-DE') + ' ₫';
}

// Format calc result thành text bundle
function formatRollingPriceBundle(modelName, calc) {
  if (!calc || calc.error) return `\n[LỖI tính giá lăn bánh: ${calc?.error || 'không có giá'}]`;
  const b = calc.breakdown;
  const L = calc.labels;
  const provinceText = calc.province_used === 'ho-chi-minh' ? 'HCM' :
    calc.province_used === 'ha-noi' ? 'HN' : 'tỉnh khác';
  return `\n\n=== GIÁ LĂN BÁNH ƯỚC TÍNH ${modelName} (đăng ký ${provinceText}, ${calc.seat_used} chỗ, brand=${calc.brand_used}) ===
- ${L.model_price}: ${fmtVnd(b.model_price)}
- ${L.registration_fee} (${(calc.registration_fee_pct * 100)}%): ${fmtVnd(b.registration_fee)}
- ${L.license_plate}: ${fmtVnd(b.license_plate)}
- ${L.inspection}: ${fmtVnd(b.inspection)}
- ${L.road_maintenance}: ${fmtVnd(b.road_maintenance)}
- ${L.tnds_insurance} [${calc.tnds_tier}]: ${fmtVnd(b.tnds_insurance)}
- ${L.service_fee} [brand ${calc.brand_used}]: ${fmtVnd(b.service_fee)}
- ${L.physical_insurance}: ${fmtVnd(b.physical_insurance)}
- **TỔNG GIÁ LĂN BÁNH ƯỚC TÍNH: ${fmtVnd(calc.total)}**

GHI CHÚ:
${calc.notes.map(n => '- ' + n).join('\n')}`;
}

// =========================================================
// HELPER 2: Load FAQ filtered by model + intent
// =========================================================
let _faqCatalog = null;
async function loadFaqFiltered(modelSlug, intents, maxQ = 5) {
  if (!modelSlug) return '';
  try {
    if (!_faqCatalog) {
      const cat = await this.helpers.httpRequest({
        method: 'GET',
        url: base + 'wiki/faq/catalog.json',
        json: true, returnFullResponse: false
      });
      _faqCatalog = (typeof cat === 'string' ? JSON.parse(cat) : cat);
    }
    let qs = (_faqCatalog.questions || []).filter(q => q.model_slug === modelSlug);
    if (!qs.length) return '';
    if (intents && intents.length) {
      const matched = qs.filter(q => q.intents.some(i => intents.includes(i)));
      if (matched.length) qs = matched;
    }
    qs = qs.slice(0, maxQ);
    return '\n\n=== FAQ ĐÃ FILTER (model=' + modelSlug
      + ', intents=[' + (intents || []).join(',') + '], '
      + qs.length + ' câu) ===\n'
      + qs.map(q =>
        `\n**Q${q.qno}: ${q.question}**\n_intents: ${q.intents.join(', ')}_\n${q.answer}`
      ).join('\n\n---\n');
  } catch (e) {
    return `\n[FAQ LỖI: ${e.message}]`;
  }
}

// =========================================================
// PROFILES
// =========================================================
const PROFILES = {
  detail: {
    model: ['tóm tắt', 'phiên bản', 'màu sắc', 'khuyến mãi', 'trang bị nổi bật'],
    faq_max_q: 5,
    model_max_chars: 3500
  },
  shortlist_small: {
    model: ['tóm tắt', 'phiên bản', 'khuyến mãi'],
    faq_max_q: 3,
    model_max_chars: 2000
  },
  shortlist_big: {},
  compare_internal: {
    model: ['tóm tắt', 'phiên bản', 'thông số', 'trang bị nổi bật', 'khuyến mãi'],
    faq_max_q: 3,
    model_max_chars: 3500
  },
  compare_external: {
    model: ['tóm tắt', 'phiên bản', 'trang bị nổi bật'],
    faq_max_q: 8,
    model_max_chars: 3500
  },
  // SUB-MODES of SALES_LEAD
  sub_consultation: {
    model: ['tóm tắt', 'phiên bản', 'màu sắc', 'khuyến mãi'],
    faq_max_q: 5,
    model_max_chars: 2500
  },
  sub_pricing_finance: {
    model: ['tóm tắt', 'phiên bản', 'khuyến mãi'],
    faq_max_q: 3,
    model_max_chars: 2000
  },
  sub_tech_specs: {
    model: ['tóm tắt', 'thông số', 'trang bị nổi bật', 'khác biệt', 'màu sắc'],
    faq_max_q: 4,
    model_max_chars: 4500
  },
  sub_close_deal: {
    model: ['tóm tắt'],
    faq_max_q: 0,
    model_max_chars: 800
  }
};

let mode = "unknown";
let files_used = [];
let shortlist = [];
let all_matches = [];
let bundle = '';

function fullSlug(slug, brandHint) {
  if (!slug) return '';
  if (brandHint && !slug.startsWith(brandHint)) return `${brandHint}-${slug}`;
  return slug;
}

// =========================================================
// MODE ROUTING
// =========================================================
if (model_slug && compare_target) {
  mode = "compare_internal";
  const slug_a = fullSlug(model_slug, brand);
  const slug_b = compare_target;
  files_used.push(`wiki/models/${slug_a}.md`);
  files_used.push(`wiki/models/${slug_b}.md`);

} else if (model_slug && compare_with_brand && !THACO_BRANDS.includes(compare_with_brand)) {
  mode = "compare_external";
  const slug_a = fullSlug(model_slug, brand);
  files_used.push(`wiki/models/${slug_a}.md`);

} else if (model_slug) {
  mode = "detail";
  const slug_a = fullSlug(model_slug, brand);
  files_used.push(`wiki/models/${slug_a}.md`);

} else if (brand || car_type || seat_min || fuel || budget_max) {
  let catalog;
  try {
    const raw = await this.helpers.httpRequest({
      method: 'GET',
      url: base + 'wiki/models/catalog.json',
      json: true, returnFullResponse: false
    });
    catalog = (typeof raw === 'string' ? JSON.parse(raw) : raw).models || [];
  } catch (e) { catalog = []; }

  let filtered = catalog.filter(m => {
    if (brand && (m.brand || "").toLowerCase() !== brand) return false;
    if (car_type && !(m.car_type || "").toLowerCase().includes(car_type)) return false;
    if (seat_min && Number(m.seat || 0) < seat_min) return false;
    if (fuel) {
      const f = (m.fuel || "").toLowerCase();
      const fuelMap = {
        'dầu': ['dầu', 'diesel'],
        'xăng': ['xăng', 'petrol', 'gasoline'],
        'hybrid': ['hybrid', 'hev'],
        'phev': ['phev', 'hybrid'],
        'ev': ['ev', 'điện']
      };
      if (!(fuelMap[fuel] || [fuel]).some(a => f.includes(a))) return false;
    }
    if (budget_max) {
      const p = Number(m.price_min_vnd || 0);
      const upper = budget_max * 1.05;
      const lower = budget_max > 1_000_000_000 ? budget_max * 0.65 : 0;
      if (p > upper) return false;
      if (lower && p < lower) return false;
    }
    return true;
  });

  if (budget_max) {
    filtered.sort((a, b) =>
      Math.abs(Number(a.price_min_vnd || 0) - budget_max) -
      Math.abs(Number(b.price_min_vnd || 0) - budget_max)
    );
  } else if (price_sort === 'desc') {
    filtered.sort((a, b) => (b.price_max_vnd || b.price_min_vnd || 0) - (a.price_max_vnd || a.price_min_vnd || 0));
  } else {
    filtered.sort((a, b) => (a.price_min_vnd || 0) - (b.price_min_vnd || 0));
  }

  all_matches = filtered.slice();
  shortlist = filtered.slice(0, price_sort ? 3 : 5);

  if (shortlist.length === 0) {
    mode = "ask_more";
    bundle = `[KHÔNG có model nào khớp filter: brand=${brand}, type=${car_type}, seat>=${seat_min}, fuel=${fuel}, budget=${budget_max}]\nGợi ý cho AI: xin lỗi khách, đề xuất nới 1 tiêu chí.`;
  } else {
    mode = shortlist.length <= 2 ? "shortlist_small" : "shortlist_big";
    bundle = `=== SHORTLIST (${shortlist.length} xe khớp tiêu chí, total ${all_matches.length}) ===\n`
      + shortlist.map(m =>
        `- ${m.name} (${m.car_type}${m.body_style_display ? '/' + m.body_style_display : ''}, ${m.seat} chỗ, ${m.fuel}) — Giá từ ${(m.price_min_vnd / 1e6).toFixed(0)} triệu — slug: ${m.slug}`
      ).join('\n');
    if (mode === "shortlist_small") {
      for (const m of shortlist) files_used.push(m.url);
    }
  }

} else {
  mode = "ask_more";
  bundle = "[Khách chưa đủ thông tin để filter. AI cần hỏi: thương hiệu? loại xe? số chỗ? ngân sách?]";
}

// =========================================================
// PROFILE OVERRIDE THEO SUB-CATEGORY
// =========================================================
let profile = { ...(PROFILES[mode] || PROFILES.detail) };

if ((mode === "detail" || mode === "shortlist_small") && d.category === "SALES_LEAD") {
  const subProfileKey = `sub_${sales_subcategory}`;
  if (PROFILES[subProfileKey]) {
    Object.assign(profile, PROFILES[subProfileKey]);
    mode = mode + "_" + sales_subcategory;
  }
}

// =========================================================
// FETCH model MD + TRIM
// =========================================================
for (const f of files_used) {
  try {
    const data = await this.helpers.httpRequest({
      method: 'GET', url: base + f, returnFullResponse: false
    });
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    let trimmed;
    if (mode === "compare_external") {
      // So sánh với đối thủ ngoài THACO → chỉ có 1 file model THACO,
      // cần đủ chỗ cho Tóm tắt + Phiên bản 1 đầy đủ của Trang bị nổi bật.
      trimmed = extractCompareMd(raw);
      if (trimmed.length > 4500) trimmed = trimmed.slice(0, 4500) + '\n...[đã rút gọn]';
    } else {
      // Bao gồm compare_internal — dùng allowlist từ PROFILES.compare_internal
      // (tóm tắt, phiên bản, thông số, trang bị nổi bật, khuyến mãi)
      trimmed = trimMarkdown(
        raw,
        profile.model || ['tóm tắt', 'phiên bản', 'khuyến mãi'],
        { maxChars: profile.model_max_chars || 3000 }
      );
    }
    bundle += `\n\n=== FILE: ${f} ===\n${trimmed}`;
  } catch (e) { /* skip 404 */ }
}

// =========================================================
// LOAD FAQ FILTERED
// =========================================================
if (mode.startsWith("detail")) {
  const slug_a = fullSlug(model_slug, brand);
  bundle += await loadFaqFiltered.call(this, slug_a, qa_intents, profile.faq_max_q);
} else if (mode.startsWith("shortlist_small")) {
  for (const m of shortlist) {
    bundle += await loadFaqFiltered.call(this, m.slug, qa_intents, profile.faq_max_q);
  }
} else if (mode === "compare_internal") {
  const slug_a = fullSlug(model_slug, brand);
  bundle += await loadFaqFiltered.call(this, slug_a, ["SO_SANH"], profile.faq_max_q);
  bundle += await loadFaqFiltered.call(this, compare_target, ["SO_SANH"], profile.faq_max_q);
  bundle += `\n\n=== ĐANG SO SÁNH NỘI BỘ THACO ===\nXe A: ${slug_a}\nXe B: ${compare_target}\nGợi ý: trình bày bullet trung thực, không thiên vị.`;
} else if (mode === "compare_external") {
  const slug_a = fullSlug(model_slug, brand);
  bundle += await loadFaqFiltered.call(this, slug_a, ["SO_SANH"], profile.faq_max_q);
  bundle += `\n\n=== ĐỐI THỦ KHÁCH NHẮC (NGOÀI THACO) ===\nBrand đối thủ: ${compare_with_brand}\nModel đối thủ: ${compare_with_model || '(không rõ)'}\nXe THACO đang tư vấn: ${slug_a}\nGợi ý: nêu điểm MẠNH của xe THACO bằng số liệu cụ thể từ FAQ. KHÔNG nói xấu đối thủ.`;
}

// =========================================================
// ROLLING PRICE CALC — chạy khi sub_pricing_finance
// → Tính bằng JS theo seat + brand thực, AI chỉ format
// =========================================================
if (sales_subcategory === "pricing_finance" && (mode.startsWith("detail") || mode.startsWith("shortlist_small"))) {
  // Lấy danh sách xe + giá min + seat + brand để tính
  let targets = [];

  // Cần load catalog để lấy đủ thông tin (seat, brand, price)
  let _catalog = [];
  try {
    const raw = await this.helpers.httpRequest({
      method: 'GET', url: base + 'wiki/models/catalog.json',
      json: true, returnFullResponse: false
    });
    _catalog = (typeof raw === 'string' ? JSON.parse(raw) : raw).models || [];
  } catch (e) { }

  if (mode.startsWith("detail")) {
    const slug_a = fullSlug(model_slug, brand);
    const m = _catalog.find(x => x.slug === slug_a);
    if (m) targets.push({
      name: m.name,
      price: m.price_min_vnd,
      seat: m.seat,
      brand: m.brand
    });
  } else if (mode.startsWith("shortlist_small")) {
    targets = shortlist.slice(0, 2).map(m => ({
      name: m.name,
      price: m.price_min_vnd,
      seat: m.seat,
      brand: m.brand
    }));
  }

  for (const t of targets) {
    if (!t.price) continue;
    const calc = await calcRollingPrice.call(this, t.price, province, t.seat, t.brand);
    bundle += formatRollingPriceBundle(t.name, calc);
  }
}

console.log('BUNDLE LENGTH =', bundle.length);
console.log('BUNDLE TAIL =', bundle.slice(-300));

return [{
  json: {
    ...d,
    mode,
    shortlist,
    all_matches,
    files_used,
    qa_intents,
    sales_subcategory,
    sales_turn_count,
    should_capture_lead,
    province_used: province,
    price_sort,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

// FILTER ENGINE + MARKDOWN TRIMMER + FAQ INTENT FILTER + COMPARISON MODULE
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
const qa_intents = Array.isArray(d.qa_intents) ? d.qa_intents : [];

// === Entity so sánh (MỚI) ===
const compare_target = (d.compare_target || "").toLowerCase().trim();        // slug nội bộ THACO
const compare_with_brand = (d.compare_with_brand || "").toLowerCase().trim();    // brand đối thủ ngoài THACO
const compare_with_model = (d.compare_with_model || "").trim();                   // tên xe đối thủ (text gốc)

const sales_subcategory = (d.sales_subcategory || "consultation").toLowerCase().trim();

// === Đếm số turn SALES_LEAD đã có để trigger lead capture ===
const history = (d._prev?.history) || [];   // cần parse_session expose _prev
const sales_turn_count = history.filter(h => h.intent === 'SALES_LEAD').length;
const should_capture_lead = sales_turn_count >= 2;  // sau 3 turn (this turn + 2 prev) → xin SĐT

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
// HELPER 1B: Extract chỉ những section CẦN cho COMPARE MODE
// → Tóm tắt + Trang bị nổi bật (CHỈ phiên bản đầu) → bundle nhẹ tối đa
// =========================================================
function extractCompareMd(md) {
  if (!md || typeof md !== 'string') return '';
  md = md.replace(/^---[\s\S]*?---\s*/m, '');
  md = md.replace(/^>.*$/gm, '');
  md = md.replace(/!\[[^\]]*\]\([^\)]*\)/g, '');

  let result = '';

  // 1) Section "Tóm tắt" — giữ nguyên
  const tomtatMatch = md.match(/^## (Tóm tắt|Tom tat)[\s\S]*?(?=^## |\Z)/im);
  if (tomtatMatch) result += tomtatMatch[0].trim() + '\n\n';

  // 2) Section "Trang bị nổi bật" — CHỈ giữ H3 phiên bản ĐẦU TIÊN
  const trangbiMatch = md.match(/^## Trang bị nổi bật[\s\S]*?(?=^## |\Z)/im);
  if (trangbiMatch) {
    const section = trangbiMatch[0];
    const h3Parts = section.split(/^### /m);
    // h3Parts[0] = "## Trang bị nổi bật theo phiên bản\n"
    // h3Parts[1] = phiên bản đầu, h3Parts[2+] = phiên bản sau (BỎ)
    if (h3Parts.length >= 2) {
      const header = h3Parts[0].trim();
      const firstVersion = h3Parts[1].trim();
      result += `${header}\n\n### ${firstVersion}\n`;
    } else {
      result += section.trim() + '\n';
    }
  }

  return result.trim();
}

// =========================================================
// HELPER 1C: Tính giá lăn bánh — fetch policy file + compute
// =========================================================
let _rollingPolicy = null;
async function calcRollingPrice(modelPrice, province) {
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
    const provinceKey = (p.registration_fee_pct[province]) ? province : 'default';

    const reg_pct = p.registration_fee_pct[provinceKey];
    const plate = p.license_plate_fee_vnd[provinceKey];
    const reg_fee = Math.round(modelPrice * reg_pct);
    const physical_ins = Math.round(modelPrice * p.physical_insurance_pct);
    const fixed = p.fixed_fees_vnd;

    const total = modelPrice + reg_fee + plate
                + fixed.inspection + fixed.road_maintenance_yr
                + fixed.tnds_insurance_yr + fixed.service_fee
                + physical_ins;

    return {
      province_used: provinceKey,
      registration_fee_pct: reg_pct,
      breakdown: {
        model_price: modelPrice,
        registration_fee: reg_fee,
        license_plate: plate,
        inspection: fixed.inspection,
        road_maintenance: fixed.road_maintenance_yr,
        tnds_insurance: fixed.tnds_insurance_yr,
        service_fee: fixed.service_fee,
        physical_insurance: physical_ins
      },
      total: total,
      labels: p.fee_labels_vi,
      notes: p.notes
    };
  } catch (e) {
    return { error: e.message };
  }
}

// Format helper: số → "999.000.000 ₫"
function fmtVnd(n) {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('de-DE') + ' ₫';
}

// Format calc result thành text bundle cho AI
function formatRollingPriceBundle(modelName, calc) {
  if (!calc || calc.error) return `\n[LỖI tính giá lăn bánh: ${calc?.error || 'không có giá'}]`;
  const b = calc.breakdown;
  const L = calc.labels;
  const provinceText = calc.province_used === 'ho-chi-minh' ? 'HCM' :
                       calc.province_used === 'ha-noi' ? 'HN' : 'tỉnh khác';
  return `\n\n=== GIÁ LĂN BÁNH ƯỚC TÍNH ${modelName} (đăng ký tại ${provinceText}) ===
- ${L.model_price}: ${fmtVnd(b.model_price)}
- ${L.registration_fee} (${(calc.registration_fee_pct * 100)}%): ${fmtVnd(b.registration_fee)}
- ${L.license_plate}: ${fmtVnd(b.license_plate)}
- ${L.inspection}: ${fmtVnd(b.inspection)}
- ${L.road_maintenance}: ${fmtVnd(b.road_maintenance)}
- ${L.tnds_insurance}: ${fmtVnd(b.tnds_insurance)}
- ${L.service_fee}: ${fmtVnd(b.service_fee)}
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
        json: true,
        returnFullResponse: false
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
// PROFILES — section allowlist + cap chars theo mode
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
  // 2 PROFILE MỚI cho comparison
  compare_internal: {
    model: ['tóm tắt', 'phiên bản', 'thông số', 'trang bị nổi bật', 'khuyến mãi'],
    faq_max_q: 3,
    model_max_chars: 2500   // 2 file → bundle ~5KB
  },
  compare_external: {
    model: ['tóm tắt', 'phiên bản', 'trang bị nổi bật'],
    faq_max_q: 8,           // load nhiều FAQ SO_SANH (chứa lập luận đối thủ)
    model_max_chars: 3000
  },
  // SUB-MODES of SALES_LEAD
  sub_consultation: {
    model: ['tóm tắt', 'phiên bản', 'khuyến mãi'],
    faq_max_q: 5,
    model_max_chars: 2500
  },
  sub_pricing_finance: {
    model: ['tóm tắt', 'phiên bản', 'khuyến mãi'],
    faq_max_q: 3,
    model_max_chars: 2000,
    extra_template: 'finance'   // append financing template vào bundle
  },
  sub_tech_specs: {
    model: ['tóm tắt', 'thông số', 'trang bị nổi bật', 'khác biệt'],   // load NHIỀU section
    faq_max_q: 4,
    model_max_chars: 4500       // nới cap vì specs nhiều
  },
  sub_close_deal: {
    model: ['tóm tắt'],         // chỉ tóm tắt — không cần data sâu
    faq_max_q: 0,                // skip FAQ
    model_max_chars: 800
  }
};

let mode = "unknown";
let files_used = [];
let shortlist = [];
let all_matches = [];
let bundle = '';

// Helper: ghép brand prefix nếu slug chưa có
function fullSlug(slug, brandHint) {
  if (!slug) return '';
  if (brandHint && !slug.startsWith(brandHint)) return `${brandHint}-${slug}`;
  return slug;
}

// =========================================================
// MODE: COMPARE_INTERNAL — so sánh 2 xe THACO (Sportage vs CX-5...)
// =========================================================
if (model_slug && compare_target) {
  mode = "compare_internal";
  const slug_a = fullSlug(model_slug, brand);
  const slug_b = compare_target;  // đã được Normalize Entities validate là slug hợp lệ
  files_used.push(`wiki/models/${slug_a}.md`);
  files_used.push(`wiki/models/${slug_b}.md`);

  // =========================================================
  // MODE: COMPARE_EXTERNAL — so sánh THACO vs đối thủ ngoài (Toyota/Hyundai/Honda...)
  // =========================================================
} else if (model_slug && compare_with_brand && !THACO_BRANDS.includes(compare_with_brand)) {
  mode = "compare_external";
  const slug_a = fullSlug(model_slug, brand);
  files_used.push(`wiki/models/${slug_a}.md`);

  // =========================================================
  // MODE: DETAIL — khách nhắc 1 model cụ thể (không so sánh)
  // =========================================================
} else if (model_slug) {
  mode = "detail";
  const slug_a = fullSlug(model_slug, brand);
  files_used.push(`wiki/models/${slug_a}.md`);

  // =========================================================
  // MODE: SHORTLIST — filter catalog theo brand/type/seat/fuel/budget
  // =========================================================
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

  // Phase 1: Filter
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
    // Budget: smart bounds
    if (budget_max) {
      const p = Number(m.price_min_vnd || 0);
      const upper = budget_max * 1.05;
      const lower = budget_max > 1_000_000_000 ? budget_max * 0.65 : 0;
      if (p > upper) return false;
      if (lower && p < lower) return false;
    }
    return true;
  });

  // Phase 2: Sort
  if (budget_max) {
    filtered.sort((a, b) =>
      Math.abs(Number(a.price_min_vnd || 0) - budget_max) -
      Math.abs(Number(b.price_min_vnd || 0) - budget_max)
    );
  } else {
    filtered.sort((a, b) => (a.price_min_vnd || 0) - (b.price_min_vnd || 0));
  }

  all_matches = filtered.slice();
  shortlist = filtered.slice(0, 5);

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

  // =========================================================
  // MODE: ASK_MORE — không có entity nào
  // =========================================================
} else {
  mode = "ask_more";
  bundle = "[Khách chưa đủ thông tin để filter. AI cần hỏi: thương hiệu? loại xe? số chỗ? ngân sách?]";
}

// =========================================================
// FETCH model MD + TRIM theo profile
// =========================================================
let profile = { ...(PROFILES[mode] || PROFILES.detail) };

// Trong detail/shortlist mode, override profile theo sub-category
if ((mode === "detail" || mode === "shortlist_small") && d.category === "SALES_LEAD") {
  const subProfileKey = `sub_${sales_subcategory}`;
  if (PROFILES[subProfileKey]) {
    Object.assign(profile, PROFILES[subProfileKey]);
    mode = mode + "_" + sales_subcategory;  // vd: "detail_pricing_finance"
  }
}

for (const f of files_used) {
  try {
    const data = await this.helpers.httpRequest({
      method: 'GET', url: base + f, returnFullResponse: false
    });
    const raw = typeof data === 'string' ? data : JSON.stringify(data);

    let trimmed;
    if (mode === "compare_internal" || mode === "compare_external") {
      // Compare mode: extractor surgical — chỉ Tóm tắt + Trang bị nổi bật (phiên bản đầu)
      trimmed = extractCompareMd(raw);
      // Vẫn áp cap để chống file lỗi
      if (trimmed.length > 2500) trimmed = trimmed.slice(0, 2500) + '\n...[đã rút gọn]';
    } else {
      // Detail / shortlist: trimMarkdown theo allowlist
      trimmed = trimMarkdown(
        raw,
        profile.model || ['tóm tắt', 'phiên bản', 'khuyến mãi'],
        { maxChars: profile.model_max_chars || 3000 }
      );
    }

    bundle += `\n\n=== FILE: ${f} ===\n${trimmed}`;
  } catch (e) { /* skip 404 silently */ }
}

// =========================================================
// LOAD FAQ FILTERED — theo từng mode
// =========================================================
if (mode.startsWith("detail")) {
  const slug_a = fullSlug(model_slug, brand);
  bundle += await loadFaqFiltered.call(this, slug_a, qa_intents, profile.faq_max_q);

} else if (mode.startsWith("shortlist_small")) {
  for (const m of shortlist) {
    bundle += await loadFaqFiltered.call(this, m.slug, qa_intents, profile.faq_max_q);
  }

} else if (mode === "compare_internal") {
  // Load FAQ SO_SANH cho CẢ 2 xe
  const slug_a = fullSlug(model_slug, brand);
  bundle += await loadFaqFiltered.call(this, slug_a, ["SO_SANH"], profile.faq_max_q);
  bundle += await loadFaqFiltered.call(this, compare_target, ["SO_SANH"], profile.faq_max_q);
  // Hint cho AI
  bundle += `\n\n=== ĐANG SO SÁNH NỘI BỘ THACO ===\nXe A: ${slug_a}\nXe B: ${compare_target}\nGợi ý: trình bày BẢNG so sánh trung thực, không thiên vị.`;

} else if (mode === "compare_external") {
  // Load nhiều FAQ SO_SANH (chứa lập luận đối thủ đã được THACO chuẩn hóa)
  const slug_a = fullSlug(model_slug, brand);
  bundle += await loadFaqFiltered.call(this, slug_a, ["SO_SANH"], profile.faq_max_q);
  // Hint cho AI biết đối thủ là ai
  bundle += `\n\n=== ĐỐI THỦ KHÁCH NHẮC (NGOÀI THACO) ===\nBrand đối thủ: ${compare_with_brand}\nModel đối thủ: ${compare_with_model || '(không rõ)'}\nXe THACO đang tư vấn: ${slug_a}\nGợi ý: nêu điểm MẠNH của xe THACO bằng số liệu cụ thể từ FAQ. KHÔNG nói xấu đối thủ.`;
}

// =========================================================
// ROLLING PRICE CALC — chỉ chạy khi sub-category = pricing_finance
// → Tính giá lăn bánh thật bằng JS, đính bundle cho AI format
// =========================================================
const province          = (d.province || "ho-chi-minh").toLowerCase().trim();  // default HCM

if (sales_subcategory === "pricing_finance" && (mode.startsWith("detail") || mode.startsWith("shortlist_small"))) {
  // Lấy danh sách xe + giá min để tính
  let targets = [];
  if (mode.startsWith("detail")) {
    // Cần load catalog để lấy price_min của model_slug
    try {
      const raw = await this.helpers.httpRequest({
        method: 'GET', url: base + 'wiki/models/catalog.json',
        json: true, returnFullResponse: false
      });
      const catalog = (typeof raw === 'string' ? JSON.parse(raw) : raw).models || [];
      const slug_a = fullSlug(model_slug, brand);
      const m = catalog.find(x => x.slug === slug_a);
      if (m) targets.push({ name: m.name, price: m.price_min_vnd });
    } catch(e) {}
  } else if (mode.startsWith("shortlist_small")) {
    // Tính cho 1-2 xe trong shortlist
    targets = shortlist.slice(0, 2).map(m => ({ name: m.name, price: m.price_min_vnd }));
  }

  for (const t of targets) {
    if (!t.price) continue;
    const calc = await calcRollingPrice.call(this, t.price, province);
    bundle += formatRollingPriceBundle(t.name, calc);
  }
}

if (sales_subcategory === "pricing_finance") {
  bundle += `

=== TEMPLATE TÍNH GIÁ LĂN BÁNH (chuẩn áp dụng VN 2026) ===
- Phí trước bạ: 12% giá xe (HN/HCM); 10% các tỉnh khác
- Phí đăng ký biển: 20.000.000 ₫ (HN/HCM khu vực 1); 1.000.000 ₫ (tỉnh khác)
- Phí đăng kiểm: ~340.000 ₫
- Phí bảo trì đường bộ 1 năm: 1.560.000 ₫
- Bảo hiểm TNDS bắt buộc: ~480.000 ₫
- Bảo hiểm vật chất 1 năm (khuyến nghị): ~1.5% giá xe

=== TEMPLATE TRẢ GÓP (tham khảo VN 2026) ===
- Trả trước tối thiểu: 20% (một số gói chỉ 10% nếu thế chấp xe)
- Lãi suất: 7.5% – 10%/năm (tùy ngân hàng: VPBank, Shinhan, BIDV, MBBank, TPBank, VietinBank)
- Kỳ hạn: 12 – 96 tháng (phổ biến 60-84 tháng)
- Hồ sơ: CMND/CCCD, hộ khẩu/KT3, sao kê lương 3-6 tháng

Công thức gần đúng: Trả góp tháng ≈ (Số tiền vay × lãi suất tháng) / (1 - (1+lãi suất tháng)^(-số tháng))
`;
}

return [{
  json: {
    ...d,
    mode,
    shortlist,
    files_used,
    qa_intents,
    sales_subcategory,
    sales_turn_count,
    should_capture_lead,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

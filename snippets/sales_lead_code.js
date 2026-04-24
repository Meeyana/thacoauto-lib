// FILTER ENGINE + MARKDOWN TRIMMER + FAQ INTENT FILTER — SALES_LEAD branch
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

const brand       = (d.brand || "").toLowerCase().trim();
const model_slug  = (d.model_slug || "").toLowerCase().trim();
const car_type    = (d.car_type || "").toLowerCase().trim();
const seat_min    = d.seat_min ? Number(d.seat_min) : null;
const fuel        = (d.fuel || "").toLowerCase().trim();
const budget_max  = d.budget_max ? Number(d.budget_max) : null;
const qa_intents  = Array.isArray(d.qa_intents) ? d.qa_intents : [];

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
// HELPER 2: Load FAQ filtered by model + intent (thay vì cả file MD)
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

    // Nếu khách có qa_intents → ưu tiên câu khớp intent, fallback về top câu nếu rỗng
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
  shortlist_big: {}
};

let mode = "unknown";
let files_used = [];
let shortlist = [];
let bundle = '';

// =========================================================
// MODE 1: DETAIL — khách nhắc model cụ thể
// =========================================================
if (model_slug) {
  let final_slug = model_slug;
  if (brand && !model_slug.startsWith(brand)) final_slug = `${brand}-${model_slug}`;
  files_used.push(`wiki/models/${final_slug}.md`);
  mode = "detail";

// =========================================================
// MODE 2: FILTER → catalog → shortlist
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
  } catch(e) { catalog = []; }

  shortlist = catalog.filter(m => {
    if (brand && (m.brand || "").toLowerCase() !== brand) return false;
    if (car_type && !(m.car_type || "").toLowerCase().includes(car_type)) return false;
    if (seat_min && Number(m.seat || 0) < seat_min) return false;
    if (fuel) {
      const f = (m.fuel || "").toLowerCase();
      const fuelMap = {
        'dầu':['dầu','diesel'],
        'xăng':['xăng','petrol','gasoline'],
        'hybrid':['hybrid','hev'],
        'phev':['phev','hybrid'],
        'ev':['ev','điện']
      };
      if (!(fuelMap[fuel] || [fuel]).some(a => f.includes(a))) return false;
    }
    if (budget_max && Number(m.price_min_vnd || 0) > budget_max) return false;
    return true;
  }).slice(0, 5);

  if (shortlist.length === 0) {
    mode = "ask_more";
    bundle = `[KHÔNG có model nào khớp filter: brand=${brand}, type=${car_type}, seat>=${seat_min}, fuel=${fuel}, budget<=${budget_max}]\nGợi ý cho AI: xin lỗi khách, đề xuất nới 1 tiêu chí.`;
  } else {
    mode = shortlist.length <= 2 ? "shortlist_small" : "shortlist_big";
    bundle = `=== SHORTLIST (${shortlist.length} xe khớp tiêu chí) ===\n`
           + shortlist.map(m =>
               `- ${m.name} (${m.car_type}${m.body_style_display ? '/' + m.body_style_display : ''}, ${m.seat} chỗ, ${m.fuel}) — Giá từ ${(m.price_min_vnd/1e6).toFixed(0)} triệu — slug: ${m.slug}`
             ).join('\n');

    if (mode === "shortlist_small") {
      for (const m of shortlist) files_used.push(m.url);
    }
  }

// =========================================================
// MODE 3: ASK_MORE — thiếu entity
// =========================================================
} else {
  mode = "ask_more";
  bundle = "[Khách chưa đủ thông tin để filter. AI cần hỏi: thương hiệu? loại xe? số chỗ? ngân sách?]";
}

// =========================================================
// FETCH model MD + TRIM theo profile
// =========================================================
const profile = PROFILES[mode] || PROFILES.detail;

for (const f of files_used) {
  try {
    const data = await this.helpers.httpRequest({
      method: 'GET', url: base + f, returnFullResponse: false
    });
    const raw = typeof data === 'string' ? data : JSON.stringify(data);
    const trimmed = trimMarkdown(
      raw,
      profile.model || ['tóm tắt','phiên bản','khuyến mãi'],
      { maxChars: profile.model_max_chars || 3000 }
    );
    bundle += `\n\n=== FILE: ${f} ===\n${trimmed}`;
  } catch(e) { /* skip 404 silently */ }
}

// =========================================================
// LOAD FAQ FILTERED (thay loop load file MD cũ)
// =========================================================
if (mode === "detail") {
  let final_slug = model_slug;
  if (brand && !model_slug.startsWith(brand)) final_slug = `${brand}-${model_slug}`;
  bundle += await loadFaqFiltered.call(this, final_slug, qa_intents, profile.faq_max_q);
} else if (mode === "shortlist_small") {
  for (const m of shortlist) {
    bundle += await loadFaqFiltered.call(this, m.slug, qa_intents, profile.faq_max_q);
  }
}

return [{
  json: {
    ...d,
    mode,
    shortlist,
    files_used,
    qa_intents,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

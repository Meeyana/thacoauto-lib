/**
 * Test suite for keyword_router → xu_ly_category flow
 * Dùng Vietnamese-safe word boundary (vn() + pmsg) giống keyword_router thật.
 */
const fs = require('fs');
const catalog = JSON.parse(fs.readFileSync('wiki/models/catalog.json', 'utf8'));
const VALID_SLUGS = new Set(catalog.models.map(m => m.slug));
console.log(`Loaded ${VALID_SLUGS.size} valid slugs\n`);

const MODEL_MAP = {
  'morning': 'kia-morning', 'new morning': 'kia-new-morning',
  'sonet': 'kia-sonet', 'seltos': 'kia-seltos', 'soluto': 'kia-soluto',
  'k3': 'kia-k3', 'k5': 'kia-k5',
  'sportage': 'kia-sportage', 'sorento': 'kia-sorento',
  'sorento hybrid': 'kia-sorento-hybrid',
  'carnival': 'kia-carnival', 'carens': 'kia-carens', 'new carnival': 'kia-carnival',
  'mazda2': 'mazda-2', 'mazda 2': 'mazda-2',
  'mazda 2 sport': 'mazda-2-sport', 'mazda2 sport': 'mazda-2-sport',
  'mazda3': 'mazda-3', 'mazda 3': 'mazda-3',
  'mazda 3 sport': 'mazda-3-sport', 'mazda3 sport': 'mazda-3-sport',
  'cx-3': 'mazda-cx-3', 'cx3': 'mazda-cx-3', 'cx 3': 'mazda-cx-3',
  'cx-5': 'mazda-cx-5', 'cx5': 'mazda-cx-5', 'cx 5': 'mazda-cx-5',
  'cx-8': 'mazda-cx-8', 'cx8': 'mazda-cx-8', 'cx 8': 'mazda-cx-8',
  'cx-30': 'mazda-cx-30', 'cx30': 'mazda-cx-30', 'cx 30': 'mazda-cx-30',
  'cx-90': 'mazda-cx-90', 'cx90': 'mazda-cx-90', 'cx 90': 'mazda-cx-90',
  'mx-5': 'mazda-mx-5', 'mx5': 'mazda-mx-5',
  '2008': 'peugeot-2008', '3008': 'peugeot-3008', '5008': 'peugeot-5008', '408': 'peugeot-408',
  'x3': 'bmw-x3', 'x4': 'bmw-x4', 'x5': 'bmw-x5', 'x6': 'bmw-x6', 'x7': 'bmw-x7',
  'ix3': 'bmw-ix3', 'z4': 'bmw-z4',
  '3 series': 'bmw-3-series', '4 series': 'bmw-4-series',
  '5 series': 'bmw-5-series', '7 series': 'bmw-7-series',
  '320i': 'bmw-3-series', '330i': 'bmw-3-series', '430i': 'bmw-4-series',
  '520i': 'bmw-5-series', '530i': 'bmw-5-series', '730li': 'bmw-7-series',
  'i4': 'bmw-i4', 'i7': 'bmw-i7',
  'cooper': 'mini-3-door', 'countryman': 'mini-countryman', 'clubman': 'mini-clubman',
};

const BRAND_PATTERNS = [
  { rx: /[\s,]([cm]x[- ]?(\d+))[\s,.!?]/i, brand: 'mazda', slugFn: (m) => {
    const raw = m[1].toLowerCase().replace(/\s+/g, '-');
    return 'mazda-' + raw.replace(/^(cx|mx)(\d)/, '$1-$2');
  }},
  { rx: /[\s,](bt[- ]?(\d+))[\s,.!?]/i, brand: 'mazda', slugFn: (m) => 'mazda-bt-' + m[2] },
  { rx: /[\s,](mazda[- ]?(\d+))[\s,.!?]/i, brand: 'mazda', slugFn: (m) => 'mazda-' + m[2] },
  { rx: /[\s,](x(\d))[\s,.!?]/i, brand: 'bmw', slugFn: (m) => 'bmw-x' + m[2] },
  { rx: /[\s,]((\d) ?series)[\s,.!?]/i, brand: 'bmw', slugFn: (m) => 'bmw-' + m[2] + '-series' },
  { rx: /[\s,](([1-8])(\d{2})i)[\s,.!?]/i, brand: 'bmw', slugFn: (m) => 'bmw-' + m[2] + '-series' },
  { rx: /[\s,](i(\d))[\s,.!?]/i, brand: 'bmw', slugFn: (m) => 'bmw-i' + m[2] },
  { rx: /[\s,](([2-5]008|[2-5]08))[\s,.!?]/i, brand: 'peugeot', slugFn: (m) => 'peugeot-' + m[2] },
  { rx: /[\s,](k(\d))[\s,.!?]/i, brand: 'kia', slugFn: (m) => 'kia-k' + m[2] },
  { rx: /[\s,](ev(\d))[\s,.!?]/i, brand: 'kia', slugFn: (m) => 'kia-ev' + m[2] },
];

const BRAND_REGEX = {
  'kia': /(?:^|\s)(kia|ki a)(?:\s|$)/i,
  'mazda': /(?:^|\s)(mazda|maz da)(?:\s|$)/i,
  'peugeot': /(?:^|\s)(peugeot|peugeout|peugot)(?:\s|$)/i,
  'bmw': /(?:^|\s)(bmw|b m w)(?:\s|$)/i,
  'mini': /(?:^|\s)(mini cooper|mini)(?:\s|$)/i
};

function detectBrand(text) {
  for (const [brand, rx] of Object.entries(BRAND_REGEX)) { if (rx.test(text)) return brand; }
  return '';
}

function detectModel(text, brand) {
  const t = ' ' + text.toLowerCase() + ' ';
  const sorted = Object.entries(MODEL_MAP).sort((a, b) => b[0].length - a[0].length);
  for (const [name, slug] of sorted) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const rx = new RegExp('[\\s,\\.!?\'\"()]' + escaped + '[\\s,\\.!?\'\"()]', 'i');
    if (rx.test(t)) {
      const ib = brand || slug.split('-')[0];
      if (VALID_SLUGS.size === 0 || VALID_SLUGS.has(slug)) return { model_slug: slug, brand: ib };
      else return { model_slug: '', brand: ib };
    }
  }
  for (const pat of BRAND_PATTERNS) {
    const m = t.match(pat.rx);
    if (m) {
      if (brand && brand !== pat.brand) continue;
      const slug = pat.slugFn(m);
      if (VALID_SLUGS.size === 0 || VALID_SLUGS.has(slug)) return { model_slug: slug, brand: pat.brand };
      else return { model_slug: '', brand: pat.brand };
    }
  }
  return { model_slug: '', brand };
}

function vn(pattern) {
  return new RegExp('(?:^|[\\s,.!?\'\"()])(?:' + pattern + ')(?=[\\s,.!?\'\"()]|$)', 'i');
}

function classifyMsg(input) {
  const msg = input.toLowerCase().trim();
  const pmsg = ' ' + msg + ' ';
  let category = null, sales_subcategory = 'consultation', qa_intents = [];

  if (vn('đ[ếe]o|đ[ụu] m[ẹe]|v[ãa]i l[ồo]n|v[ãa]i c[ặa]c|đ[ồo] ngu|m[ẹe] m[àa]y|cc|clgt|vcl|wtf|f[uư]ck|shit|damn|bitch|con chó|con đ[ĩi]|ngu v[ãa]i|ngu thế|khốn nạn|mất dạy').test(pmsg)) { category = 'SAFETY_GUARD'; }
  else if (vn('tuyển dụng|ứng tuyển|xin việc|gửi cv|tìm việc|vị trí tuyển|hiring|apply|job').test(pmsg)) { category = 'RECRUITMENT'; }
  else if (vn('khiếu nại|phàn nàn|than phiền|thái độ nhân viên|thái độ sale|dịch vụ tệ|dịch vụ kém|dịch vụ tồi|e-?survey|đánh giá xấu|đánh giá tệ|đánh giá kém').test(pmsg)) { category = 'CRITICAL_COMPLAINT'; }
  else if (vn('thu cũ|đổi mới|bán xe cũ|lên đời|đổi xe|trade[- ]?in|thu mua').test(pmsg)) { category = 'TRADE_IN'; }
  else if (vn('cho (?:em|tôi|mình|anh|chị) (?:số|sdt|số điện thoại) (?:sale|tư vấn|nhân viên)|kết nối (?:nhân viên|tư vấn)|nói chuyện (?:với )?(?:người thật|nhân viên|sale)|gọi (?:cho )?(?:em|tôi) (?:ngay|đi|với)|muốn gặp (?:sale|tư vấn|nhân viên)').test(pmsg)) { category = 'URGENT_CONSULT'; }
  else if (vn('văn phòng|trụ sở|email (?:công ty|cskh|thaco)|hotline (?:tổng đài|thaco|công ty)|fanpage (?:chính thức|thaco)|liên hệ (?:công ty|thaco auto)').test(pmsg)) { category = 'COMPANY_CONTACT'; }
  else if (vn('bảo dưỡng|đặt lịch (?:dịch vụ|sửa|bảo)|sửa chữa|phụ tùng|dịch vụ xưởng|xưởng dịch vụ|lịch (?:bảo dưỡng|bảo hành)|chi phí (?:bảo dưỡng|sửa chữa)').test(pmsg)) { category = 'SERVICE_APPOINTMENT'; }
  else if (vn('chính sách (?:bảo hành|đổi trả|trả góp)|thủ tục (?:đăng ký|đăng kiểm|sang tên)|quy định (?:pháp lý|bảo hiểm)|điều khoản|bảo hành (?:xe|chính hãng)').test(pmsg)
    && !vn('giá|bao nhiêu|tư vấn|mua').test(pmsg)) { category = 'POLICY_LEGAL'; }
  else if (vn('showroom|đại lý|chi nhánh|gần (?:đây|nhất|nhà)|địa chỉ (?:showroom|đại lý)|tìm (?:showroom|đại lý)').test(pmsg)) { category = 'NETWORK_LOCATION'; }
  else if (vn('thông tin (?:hãng|thương hiệu|brand)|lịch sử (?:hãng|thương hiệu)|xuất xứ|website (?:kia|mazda|peugeot|bmw|mini)').test(pmsg)
    && !vn('giá|mua|tư vấn|lái thử|đặt').test(pmsg)) { category = 'BRAND_INFO'; }
  else if (/^\s*(chào|hello|hi|hey|xin chào|alo|chào bạn|tạm biệt|bye|cảm ơn|thank|bạn là ai|bot à|em là ai|chào (?:anh|chị|em|bạn|shop)|good (?:morning|afternoon|evening))\s*[.!?]*\s*$/i.test(msg)) { category = 'GREETING'; }
  else if (vn('tư vấn|muốn mua|quan tâm|hỏi (?:về )?xe|giá|lăn bánh|trả góp|báo giá|đăng ký lái thử|lái thử|đặt cọc|mua xe|đặt xe|khuyến mãi|ưu đãi|e-?catalog|thông số|trang bị|nội thất|ngoại thất|động cơ|ADAS|an toàn|hộp số|so sánh|phiên bản|màu (?:sắc|xe|nào)|có sẵn|giao ngay|tồn kho|giá rẻ|giá đắt|xe (?:nào|gì) (?:phù hợp|tốt|hay)|nên mua|đáng mua|xe suv|xe sedan|xe mpv|xe hatchback|xe bán tải').test(pmsg)) {
    category = 'SALES_LEAD';
    if (vn('giá|bao nhiêu|lăn bánh|trả góp|báo giá|khuyến mãi|ưu đãi|chiết khấu|phí trước bạ|vay|lãi suất').test(pmsg)) { sales_subcategory = 'pricing_finance'; }
    else if (vn('thông số|trang bị|nội thất|ngoại thất|động cơ|ADAS|hộp số|túi khí|camera|an toàn|kích thước|mã lực|torque|cách âm').test(pmsg)) { sales_subcategory = 'tech_specs'; }
    else if (vn('lái thử|đặt cọc|mua xe|đặt xe|đăng ký lái thử').test(pmsg)) { sales_subcategory = 'close_deal'; }
    else if (vn('so sánh|vs|khác nhau|nên chọn|đáng mua hơn').test(pmsg)) { sales_subcategory = 'consultation'; qa_intents.push('SO_SANH'); }
    else { sales_subcategory = 'consultation'; }
  }
  else {
    const brandHit = detectBrand(msg);
    const { model_slug } = detectModel(msg, brandHit);
    if (model_slug) { category = 'SALES_LEAD'; sales_subcategory = 'consultation'; }
  }

  let brand = detectBrand(msg);
  const modelResult = detectModel(msg, brand);
  if (modelResult.brand && !brand) brand = modelResult.brand;

  return { _keyword_matched: !!category, category, sales_subcategory: category === 'SALES_LEAD' ? sales_subcategory : '', brand: brand || '', model_slug: modelResult.model_slug || '' };
}

// ==========================================
const tests = [
  // 1-5: SALES_LEAD + catalog validation
  { input: 'tư vấn chiếc CX-90',          expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'mazda', slug: 'mazda-cx-90' }},
  { input: 'cx-9 giá bao nhiêu',          expect: { matched: true, cat: 'SALES_LEAD', sub: 'pricing_finance', brand: 'mazda', slug: '' }},
  { input: 'giá cx 5 lăn bánh',           expect: { matched: true, cat: 'SALES_LEAD', sub: 'pricing_finance', brand: 'mazda', slug: 'mazda-cx-5' }},
  { input: 'tư vấn Sportage',             expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'kia', slug: 'kia-sportage' }},
  { input: 'cho hỏi xe mazda cx-80',      expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'mazda', slug: '' }},
  // 6-8: Sub-categories
  { input: 'thông số kỹ thuật Seltos',     expect: { matched: true, cat: 'SALES_LEAD', sub: 'tech_specs', brand: 'kia', slug: 'kia-seltos' }},
  { input: 'đăng ký lái thử K5',          expect: { matched: true, cat: 'SALES_LEAD', sub: 'close_deal', brand: 'kia', slug: 'kia-k5' }},
  { input: 'so sánh CX-5 với CX-8',       expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'mazda', slug: 'mazda-cx-5' }},
  // 9-10: Pattern + brand inference
  { input: 'tư vấn 320i',                expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'bmw', slug: 'bmw-3-series' }},
  { input: 'giá Peugeot 3008',           expect: { matched: true, cat: 'SALES_LEAD', sub: 'pricing_finance', brand: 'peugeot', slug: 'peugeot-3008' }},
  // 11-12: Model-only detection
  { input: 'Sorento',                     expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'kia', slug: 'kia-sorento' }},
  { input: 'Mazda 3 Sport',              expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'mazda', slug: 'mazda-3-sport' }},
  // 13: Non-existent → slug empty
  { input: 'giá ev6 bao nhiêu',          expect: { matched: true, cat: 'SALES_LEAD', sub: 'pricing_finance', brand: 'kia', slug: '' }},
  // 14-17: Non-SALES categories
  { input: 'xin chào',                    expect: { matched: true, cat: 'GREETING', sub: '', brand: '', slug: '' }},
  { input: 'tìm showroom gần đây',       expect: { matched: true, cat: 'NETWORK_LOCATION', sub: '', brand: '', slug: '' }},
  { input: 'lịch bảo dưỡng xe',          expect: { matched: true, cat: 'SERVICE_APPOINTMENT', sub: '', brand: '', slug: '' }},
  { input: 'thái độ nhân viên quá tệ',   expect: { matched: true, cat: 'CRITICAL_COMPLAINT', sub: '', brand: '', slug: '' }},
  // 18: SAFETY_GUARD (Vietnamese diacritics)
  { input: 'đồ ngu',                      expect: { matched: true, cat: 'SAFETY_GUARD', sub: '', brand: '', slug: '' }},
  // 19: Contains 'giá' → matches SALES_LEAD pricing_finance
  { input: 'thế bản đó giá sao',         expect: { matched: true, cat: 'SALES_LEAD', sub: 'pricing_finance', brand: '', slug: '' }},
  // 20: Budget + car_type (no model)
  { input: 'xe SUV dưới 800 triệu',      expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: '', slug: '' }},
  // 21-22: MINI + TRADE_IN
  { input: 'tư vấn countryman',          expect: { matched: true, cat: 'SALES_LEAD', sub: 'consultation', brand: 'mini', slug: 'mini-countryman' }},
  { input: 'thu cũ đổi mới xe Kia',      expect: { matched: true, cat: 'TRADE_IN', sub: '', brand: 'kia', slug: '' }},
];

let passed = 0, failed = 0;
console.log('='.repeat(115));
console.log(`${'#'.padEnd(3)} | ${'INPUT'.padEnd(38)} | ${'CATEGORY'.padEnd(20)} | ${'SUB'.padEnd(16)} | ${'BRAND'.padEnd(8)} | ${'SLUG'.padEnd(20)} | OK`);
console.log('-'.repeat(115));

tests.forEach((t, i) => {
  const r = classifyMsg(t.input);
  const ok = r._keyword_matched === t.expect.matched && r.category === t.expect.cat
    && r.sales_subcategory === t.expect.sub && r.brand === t.expect.brand && r.model_slug === t.expect.slug;
  if (ok) passed++; else failed++;
  console.log(`${String(i+1).padEnd(3)} | ${t.input.padEnd(38)} | ${String(r.category).padEnd(20)} | ${r.sales_subcategory.padEnd(16)} | ${r.brand.padEnd(8)} | ${r.model_slug.padEnd(20)} | ${ok ? '✅' : '❌'}`);
  if (!ok) {
    console.log(`     EXPECT: cat=${t.expect.cat}, sub=${t.expect.sub}, brand=${t.expect.brand}, slug=${t.expect.slug}`);
    console.log(`     GOT:    cat=${r.category}, sub=${r.sales_subcategory}, brand=${r.brand}, slug=${r.model_slug}`);
  }
});

console.log('-'.repeat(115));
console.log(`\n${passed}/${tests.length} passed, ${failed} failed`);
if (failed === 0) console.log('🎉 ALL TESTS PASSED!');

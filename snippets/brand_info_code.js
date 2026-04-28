// BRAND INFO LOOKUP — đọc wiki/brands/catalog.json + file brand MD
// Paste vào n8n node Code mới sau Switch.BRAND_INFO
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

const brand = (d.brand || "").toLowerCase().trim();

let bundle = '';
const files_used = [];

if (!brand) {
  bundle = `[BRAND_INFO nhưng chưa rõ brand. AI hỏi lại: "Anh/Chị quan tâm hãng nào trong các thương hiệu THACO phân phối: Kia, Mazda, Peugeot, BMW, MINI?"]`;
} else {
  let hit = null;
  try {
    const cat = await this.helpers.httpRequest({
      method: 'GET',
      url: base + 'wiki/brands/catalog.json',
      json: true, returnFullResponse: false
    });
    const brands = (typeof cat === 'string' ? JSON.parse(cat) : cat).brands || [];
    hit = brands.find(b => b.slug === brand);
  } catch (e) {
    bundle = `[Lỗi load brand catalog: ${e.message}]`;
  }

  if (hit) {
    bundle = `=== METADATA THƯƠNG HIỆU ${hit.name} ===
- Quốc gia: ${hit.country}
- Mô tả ngắn: ${hit.short_desc || '—'}
- Website chính thức: ${hit.official_site}
- Trang THACO phân phối: ${hit.thaco_site}
- Fanpage chính thức: ${hit.fanpage}

=== HƯỚNG DẪN AI ===
- Trả lời ngắn gọn DỰA HOÀN TOÀN trên metadata trên.
- Đưa URL nguyên văn (web/fanpage), KHÔNG rút gọn.
- Nếu khách hỏi về model cụ thể của hãng → gợi ý hỏi cụ thể tên xe.`;
  } else if (!bundle) {
    bundle = `[BRAND_INFO nhưng brand "${brand}" không có trong catalog. AI hỏi lại khách quan tâm hãng nào trong: Kia, Mazda, Peugeot, BMW, MINI.]`;
  }
}

return [{
  json: {
    ...d,
    mode: 'brand_info',
    files_used,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

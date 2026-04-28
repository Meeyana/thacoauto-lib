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
    files_used.push(hit.file);
    bundle = `=== METADATA THƯƠNG HIỆU ${hit.name} ===
- Quốc gia: ${hit.country}
- Mô tả ngắn: ${hit.short_desc || '—'}
- Website chính thức: ${hit.official_site}
- Trang THACO phân phối: ${hit.thaco_site}
- Fanpage chính thức: ${hit.fanpage}\n\n`;

    // Đọc file brand MD lấy mô tả chi tiết
    try {
      const md = await this.helpers.httpRequest({
        method: 'GET', url: base + hit.file, returnFullResponse: false
      });
      const raw = typeof md === 'string' ? md : JSON.stringify(md);
      const cleaned = raw
        .replace(/^---[\s\S]*?---\s*/m, '')
        .replace(/<!--[\s\S]*?-->/g, '')
        .trim();
      bundle += `=== FILE: ${hit.file} ===\n${cleaned}\n\n`;
    } catch (e) { /* skip */ }

    bundle += `=== HƯỚNG DẪN AI ===
- Trả lời ngắn gọn dựa trên metadata + nội dung brand file.
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

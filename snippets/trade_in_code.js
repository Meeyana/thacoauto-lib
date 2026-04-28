// HANDOFF: THU CŨ ĐỔI MỚI
// Paste vào n8n node Code mới sau Switch.TRADE_IN
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

const model_slug = (d.model_slug || "").toLowerCase().trim();

let bundle = '';
const files_used = ['wiki/services/trade-in.md'];

// Fetch file knowledge gốc
try {
  const data = await this.helpers.httpRequest({
    method: 'GET',
    url: base + 'wiki/services/trade-in.md',
    returnFullResponse: false
  });
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  const cleaned = raw.replace(/^---[\s\S]*?---\s*/m, '').trim();
  bundle += `=== FILE: wiki/services/trade-in.md ===\n${cleaned}\n\n`;
} catch (e) { /* skip 404 */ }

bundle += `=== HƯỚNG DẪN AI ===
Xe khách muốn lên đời (nếu có): ${model_slug || '(chưa khai)'}

- Xác nhận đúng dịch vụ thu cũ đổi mới của THACO AUTO.
- ĐÍNH KÈM link: https://usedcars.thacoauto.vn
- Đề xuất 3 cách: (1) website định giá online, (2) hotline 1900 545 591, (3) tới showroom.
- KHÔNG tự định giá xe cũ — chỉ điều hướng.
- Nếu khách có model muốn lên đời → gợi ý xem trang xe đó song song.`;

return [{
  json: {
    ...d,
    mode: 'trade_in',
    files_used,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

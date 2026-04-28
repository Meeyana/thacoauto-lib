// COMPANY_CONTACT — trả thông tin liên hệ THACO AUTO HQ
// Paste vào n8n node Code mới sau Switch.COMPANY_CONTACT
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

let bundle = '';
const files_used = ['wiki/company/thaco-auto-contact.md'];

try {
  const data = await this.helpers.httpRequest({
    method: 'GET',
    url: base + 'wiki/company/thaco-auto-contact.md',
    returnFullResponse: false
  });
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  const cleaned = raw.replace(/^---[\s\S]*?---\s*/m, '').trim();
  bundle += `=== FILE: wiki/company/thaco-auto-contact.md ===\n${cleaned}\n\n`;
} catch (e) { /* skip 404 */ }

bundle += `=== HƯỚNG DẪN AI ===
- Trả lời ĐÚNG câu hỏi của khách (văn phòng nào / email CSKH / hotline / địa chỉ).
- Đưa số điện thoại + địa chỉ NGUYÊN VĂN từ file trên, KHÔNG bịa.
- Nếu khách hỏi gộp 2-3 thông tin → trả gọn dạng bullet.
- Nếu khách hỏi khu vực không có (vd "Cần Thơ") → nói rõ THACO AUTO có 4 văn phòng chính (Chu Lai, HCM, HN, Đà Nẵng) + gợi ý hotline 1900 545 591.
- KHÔNG nhầm với showroom đại lý — nếu khách thực ra muốn tìm showroom gần nhà → khuyên gọi hotline để được hướng dẫn.`;

return [{
  json: {
    ...d,
    mode: 'company_contact',
    files_used,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

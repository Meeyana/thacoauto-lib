// URGENT CONSULT — cho hotline + xin SĐT khách
// Paste vào n8n node Code mới sau Switch.URGENT_CONSULT
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

const brand = (d.brand || "").toLowerCase().trim();
const model_slug = (d.model_slug || "").toLowerCase().trim();

let bundle = '';
const files_used = ['wiki/services/urgent-consult.md'];

try {
  const data = await this.helpers.httpRequest({
    method: 'GET',
    url: base + 'wiki/services/urgent-consult.md',
    returnFullResponse: false
  });
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  const cleaned = raw.replace(/^---[\s\S]*?---\s*/m, '').trim();
  bundle += `=== FILE: wiki/services/urgent-consult.md ===\n${cleaned}\n\n`;
} catch (e) { /* skip 404 */ }

bundle += `=== KHÁCH CẦN TƯ VẤN NGAY ===
Brand quan tâm: ${brand || '(chưa khai)'}
Model quan tâm: ${model_slug || '(chưa khai)'}

=== HƯỚNG DẪN AI (PHẢI làm đủ 3 việc) ===
1. Cho ngay hotline: **1900 545 591** (8:00 - 21:00 hàng ngày).
2. ĐỒNG THỜI xin SĐT khách + xe quan tâm + tỉnh/thành để chuyên viên gọi lại trong 15 phút.
3. Tone gấp + cam kết: "chuyên viên Sale sẽ liên hệ trong 15 phút".

Mẫu phản hồi:
"Dạ Anh/Chị gọi ngay hotline **1900 545 591** để được tư vấn ạ 📞
Hoặc Anh/Chị cho em xin **số điện thoại + xe đang quan tâm**, chuyên viên Sale sẽ gọi lại trong 15 phút."`;

// Nếu khách đã cho SĐT trong tin nhắn → set cờ capture lead
const has_phone = /(\b0\d{9}\b|\b84\d{9}\b)/.test(d.chatInput || '');

return [{
  json: {
    ...d,
    mode: 'urgent_consult',
    files_used,
    should_capture_lead: has_phone,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

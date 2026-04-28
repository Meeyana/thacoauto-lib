// HANDOFF: TUYỂN DỤNG THACO
// Paste vào n8n node Code mới sau Switch.RECRUITMENT
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

let bundle = '';
const files_used = ['wiki/services/recruitment.md'];

try {
  const data = await this.helpers.httpRequest({
    method: 'GET',
    url: base + 'wiki/services/recruitment.md',
    returnFullResponse: false
  });
  const raw = typeof data === 'string' ? data : JSON.stringify(data);
  const cleaned = raw.replace(/^---[\s\S]*?---\s*/m, '').trim();
  bundle += `=== FILE: wiki/services/recruitment.md ===\n${cleaned}\n\n`;
} catch (e) { /* skip 404 */ }

bundle += `=== HƯỚNG DẪN AI ===
- Xác nhận THACO Group đang tuyển nhiều vị trí thuộc TOÀN TẬP ĐOÀN (không chỉ THACO AUTO).
- ĐÍNH KÈM link: https://tuyendung.thaco.com.vn/tieng-viet
- Liệt kê ngắn các nhóm vị trí: công nhân, chuyên viên, kỹ sư, quản lý, lãnh đạo.
- Nhắc tập đoàn thành viên: THACO AUTO, THACO INDUSTRIES, THACO AGRI, THADICO, THISO, THILOGI.
- Hướng dẫn khách tạo CV và nộp trực tiếp trên hệ thống tuyển dụng.
- KHÔNG hứa kết quả phỏng vấn — chỉ điều hướng.`;

return [{
  json: {
    ...d,
    mode: 'recruitment',
    files_used,
    context_bundle: bundle,
    bundle_size: bundle.length
  }
}];

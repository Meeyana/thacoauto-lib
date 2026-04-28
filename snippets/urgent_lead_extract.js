// urgent_lead_extract — Code node ngay sau "AI Agent — Handoff Reply"
// Extract SĐT + brand/model từ chatInput của khách + entity Router đã trích.
// Chỉ chạy nhánh capture khi should_capture_lead === true (đã set bởi urgent_consult_code).
//
// Wiring n8n:
//   AI Agent Handoff Reply → IF should_capture_lead
//     ├── true  → urgent_lead_extract (file này) → gs_append_urgent_lead → urgent_lead_reply_complete
//     └── false → trả output AI Agent về user

// 1. Lấy state gốc từ urgent_consult_code (giữ lại brand/model/chatInput đã extract)
const upstream = $('urgent_consult_logic').first().json;
const aiReply = $input.first().json.output || '';

const chatInput = upstream.chatInput || '';
const brand = (upstream.brand || '').toLowerCase().trim();
const model_slug = (upstream.model_slug || '').toLowerCase().trim();

// 2. Helper validate SĐT VN
function isValidVnPhone(p) {
  if (!p) return false;
  const cleaned = p.toString().replace(/[\s\-\.]/g, '');
  return /^(\+84|84|0)[0-9]{9,10}$/.test(cleaned);
}

// 3. Bóc SĐT đầu tiên gặp được trong chatInput
const phoneMatch = chatInput.match(/(\+?84|0)\d{9,10}/);
let phone = phoneMatch ? phoneMatch[0] : null;
if (phone && !isValidVnPhone(phone)) phone = null;

// 4. Bóc tên (best-effort): match cụm "tên là X", "em là X", "anh tên Y"
//    Nếu không match → null, AI hỏi turn sau.
let name = null;
const nameMatch = chatInput.match(/(?:tên (?:em |là |anh |chị )|em là |anh tên |chị tên )([A-ZÀ-Ỹ][\p{L} ]{1,30})/iu);
if (nameMatch) name = nameMatch[1].trim();

// 5. Bóc tỉnh/thành từ chatInput (đơn giản — match tên các tỉnh phổ biến)
const PROVINCES = [
  'hồ chí minh', 'hcm', 'sài gòn', 'tp hcm',
  'hà nội', 'hn',
  'đà nẵng', 'cần thơ', 'hải phòng', 'biên hòa', 'vũng tàu',
  'bình dương', 'đồng nai', 'long an', 'tiền giang', 'an giang',
  'nghệ an', 'thanh hóa', 'hải dương', 'bắc ninh', 'quảng ninh'
];
const lower = chatInput.toLowerCase();
const province = PROVINCES.find(p => lower.includes(p)) || null;

// 6. Build lead_data
const sessionId = $('When chat message received').first().json.sessionId || 'default';
const now = new Date().toISOString();

const lead_data = {
  sessionId,
  source: 'urgent_consult',
  name: name,
  phone: phone,
  brand: brand || null,
  model_interest: model_slug || null,
  province: province,
  raw_message: chatInput,
  ai_reply_snapshot: aiReply.slice(0, 500),
  created_at: now
};

// 7. Check đủ điều kiện ghi sheet — TỐI THIỂU phải có SĐT hợp lệ
const is_savable = !!phone;

return [{
  json: {
    sessionId,
    lead_data,
    is_savable,
    missing: is_savable ? [] : ['phone'],
    ai_reply: aiReply  // pass-through để dùng nếu không save
  }
}];

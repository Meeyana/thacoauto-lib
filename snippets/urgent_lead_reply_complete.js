// urgent_lead_reply_complete — Code node sau "gs_append_urgent_lead"
// Static reply xác nhận đã ghi nhận yêu cầu tư vấn ngay.
// KHÔNG gọi AI để tiết kiệm token + đảm bảo format ổn định.

const d = $('urgent_lead_extract').first().json.lead_data;

const lines = [];
lines.push('Dạ em đã ghi nhận yêu cầu tư vấn của Anh/Chị ạ ✅');
lines.push('');
lines.push('📋 **Thông tin đã lưu:**');
if (d.name)            lines.push(`- Họ tên: ${d.name}`);
lines.push(`- SĐT: ${d.phone}`);
if (d.brand)           lines.push(`- Hãng quan tâm: ${d.brand.toUpperCase()}`);
if (d.model_interest)  lines.push(`- Xe quan tâm: ${d.model_interest}`);
if (d.province)        lines.push(`- Khu vực: ${d.province}`);
lines.push('');
lines.push('📞 Chuyên viên Sale sẽ gọi lại Anh/Chị **trong 15 phút** để tư vấn ngay.');
lines.push('');
lines.push('Trong lúc chờ, Anh/Chị có thể gọi trực tiếp hotline: **1900 545 591** (8:00 - 21:00).');
lines.push('');
lines.push('Cảm ơn Anh/Chị đã quan tâm THACO AUTO!');

const reply = lines.join('\n');

return [{ json: { output: reply } }];

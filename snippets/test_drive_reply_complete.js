// reply_complete — Code node sau "gs_append_test_drive"
// Static reply xác nhận đã save lead — KHÔNG gọi AI để tiết kiệm token + đảm bảo format ổn định.

const d = $('merge_lead_state').first().json.lead_data;

const reply = `Dạ em đã ghi nhận đăng ký lái thử của Anh/Chị ạ ✅

📋 **Thông tin đã lưu:**
- Họ tên: ${d.name}
- SĐT: ${d.phone}
- Xe quan tâm: ${d.model_interest}
- Showroom: ${d.showroom}
- Thời gian: ${d.preferred_datetime}

🚗 Chuyên viên Sale sẽ liên hệ Anh/Chị trong **1-2 giờ làm việc** để xác nhận lịch và chuẩn bị xe.

Cảm ơn Anh/Chị đã quan tâm THACO AUTO!

📞 Hotline hỗ trợ: **1900 545 591**`;

return [{ json: { output: reply } }];

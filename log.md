# Log — Nhật ký vận hành Wiki

Append-only. Mỗi entry bắt đầu bằng `## [YYYY-MM-DD] <loại> | <tiêu đề>`.

Để xem 5 entry gần nhất: `grep "^## \[" log.md | tail -5`

---

## [2026-04-22] init | Khởi tạo wiki
- Tạo cấu trúc thư mục: `raw/`, `raw/assets/`, `wiki/{entities,concepts,sources,syntheses}/`
- Tạo các tệp gốc: `CLAUDE.md`, `index.md`, `log.md`
- Trạng thái: sẵn sàng nhận nguồn đầu tiên.

## [2026-04-22] schema-update | Tinh chỉnh cho domain THACO AUTO
- Bổ sung quy ước trang Model / Brand / Promotion với frontmatter chatbot-ready.
- Thêm thư mục: wiki/{company,brands,models,promotions,dealers,services,faq}.
- Lưu memory dự án: phục vụ chatbot AI truy vấn.

## [2026-04-22] ingest | Giới thiệu THACO AUTO + THACO Group
- Nguồn: raw/Giới thiệu THACO AUTO.md, raw/Giới thiệu THACO Group.md
- Tạo: wiki/sources/gioi-thieu-thaco-auto.md, wiki/sources/gioi-thieu-thaco-group.md
- Tạo: wiki/company/{thaco-auto, thaco-group, r-and-d-thaco-auto}.md
- Tạo placeholder thương hiệu (14): kia, mazda, peugeot, bmw, mini, bmw-motorrad, peugeot-motorcycles, thaco-truck, kia-frontier, mitsubishi-fuso, sinotruk, thaco-bus, iveco-daily, mercedes-benz-bus
- Cập nhật index.md với đầy đủ mục lục
- Ghi chú: cần ingest tiếp danh sách model + bảng giá cho 5 thương hiệu xe du lịch

## [2026-04-22] tooling | Thêm script auto-sync JSON → wiki/models
- Tạo: tools/sync_models.py — đọc raw/models/<brand>/*.json sinh wiki/models/<slug>.md
- Đánh dấu trang sinh tự động bằng `generated: true` (LLM cấm sửa tay)
- Tự động cập nhật mục Models trong index.md (giữa marker BEGIN/END)
- Hỗ trợ chế độ `--watch` để theo dõi thay đổi và tự sync
- Cập nhật CLAUDE.md mục 2.5: quy tắc cho trang generated
- Đã test với raw/models/kia/kia-sportage.json → wiki/models/kia-sportage.md (10 phiên bản)

## [2026-04-22] ingest | 5 PDF Q&A Kia → wiki/faq/
- Nguồn: raw/models/kia/Q&A/*.pdf (K5, Sportage, Sorento, Sorento HEV/PHEV, New Carnival)
- Tạo: wiki/faq/{kia-k5-qa, kia-sportage-qa, kia-new-sorento-qa, kia-sorento-hevphev-qa, kia-new-carnival-qa}.md
- Tạo: wiki/faq/index.md (sub-index 5 trang · 47 câu Q&A)
- Cập nhật index.md mục FAQ (slim summary + sub-index link, theo Karpathy pattern)
- Trang FAQ là MANUAL (không có generated: true) → an toàn với auto-sync
- Nâng cấp tools/sync_models.py: tự động chèn section "Q&A mở rộng" + link trong Liên kết khi tồn tại wiki/faq/<slug>-qa.md → liên kết 2 chiều, không phá auto-sync
- Đã chạy lại sync_models.py: 5/12 model nay có link FAQ tương ứng

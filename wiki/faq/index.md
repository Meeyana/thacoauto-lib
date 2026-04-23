---
title: FAQ — Câu hỏi & Trả lời
type: faq-index
updated: 2026-04-22
---

# FAQ — Câu hỏi & Trả lời tư vấn bán hàng

> Tổng hợp các trang Q&A theo từng model — biên soạn từ tài liệu đào tạo bán hàng chính thức của THACO AUTO. Dùng cho **tư vấn khách hàng** và **training sale**. Mỗi trang Q&A liên kết 2 chiều với trang model tương ứng.

## Theo thương hiệu

### Kia
| Q&A | Model | Số câu | Phân khúc |
|---|---|---|---|
| [[faq/kia-k5-qa]] | [[models/kia-k5]] | 10 | D-Sedan |
| [[faq/kia-sportage-qa]] | [[models/kia-sportage]] | 13 | C-SUV |
| [[faq/kia-new-sorento-qa]] | [[models/kia-new-sorento]] | 11 | D-SUV (xăng/dầu) |
| [[faq/kia-sorento-hybrid-qa]] | [[models/kia-sorento-hybrid]] | 11 | D-SUV (Hybrid) |
| [[faq/kia-new-carnival-qa]] | [[models/kia-new-carnival]] | 2 | SUV Onroad / MPV (so sánh thế hệ) |

**Tổng: 5 trang FAQ · 47 câu Q&A**

---

## Quy ước

- Trang FAQ là **trang biên soạn tay** (không có `generated: true`) → an toàn với cơ chế auto-sync model.
- Mỗi trang FAQ phải có frontmatter:
  - `type: faq`
  - `model: "[[models/<slug>]]"` — liên kết wikilink tới model
  - `source_pdf:` — đường dẫn PDF nguồn trong `raw/`
- Khi tồn tại `wiki/faq/<slug>-qa.md`, script `tools/sync_models.py` sẽ **tự động chèn liên kết** vào trang model auto-generated tương ứng (xem section "FAQ mở rộng" trong model).

## Liên kết
- [[index|← Mục lục Wiki]]
- [[models/index|Danh sách Model]]
- [[brands/kia]]

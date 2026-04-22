# LLM Wiki — Sơ đồ vận hành (Schema)

Đây là tệp cấu hình chính. Mọi phiên làm việc trong thư mục này PHẢI tuân theo các quy tắc dưới đây. Bạn (LLM) là người duy trì wiki; người dùng là người định hướng và đặt câu hỏi.

## 1. Kiến trúc ba lớp

```
thacoauto-lib/
├── CLAUDE.md           # Tệp này — sơ đồ vận hành
├── MEMORY.md           # (tùy chọn) bộ nhớ dài hạn của Claude
├── index.md            # Mục lục toàn bộ wiki — cập nhật mỗi lần ingest
├── log.md              # Nhật ký theo thứ tự thời gian — append-only
├── raw/                # Nguồn gốc (BẤT BIẾN — chỉ đọc, không sửa)
│   ├── assets/         # Hình ảnh tải về kèm theo nguồn
│   └── *.md, *.pdf...  # Bài báo, tài liệu, ghi chú thô
└── wiki/               # Tri thức đã chưng cất (LLM toàn quyền viết/sửa)
    ├── company/        # Hồ sơ THACO AUTO: lịch sử, cơ cấu, lãnh đạo
    ├── brands/         # Mỗi thương hiệu phân phối = 1 trang (Kia, Mazda, Peugeot, BMW, ...)
    ├── models/         # Mỗi dòng xe = 1 trang (Kia Seltos 2026, Mazda CX-5, ...)
    ├── promotions/     # Chương trình khuyến mãi (có valid_from / valid_until)
    ├── dealers/        # Showroom, đại lý, địa chỉ
    ├── services/       # Bảo hành, bảo dưỡng, phụ tùng, tài chính
    ├── faq/            # Câu hỏi thường gặp đã được trả lời chuẩn
    ├── sources/        # Tóm tắt nguồn (1 nguồn = 1 trang)
    └── syntheses/      # So sánh xe, phân tích phân khúc
```

## 1.1 Mục đích sử dụng — CHATBOT-READY

Wiki này phục vụ chatbot AI truy vấn. Vì vậy MỌI trang phải:
- Có frontmatter YAML giàu metadata để filter (giá, phân khúc, năm, trạng thái).
- Trả lời được câu hỏi đơn lẻ trong ≤ 1 trang (không buộc chatbot đọc nhiều file).
- Dùng bảng (markdown table) cho thông số kỹ thuật và giá.
- Khuyến mãi BẮT BUỘC có `valid_from` và `valid_until` (định dạng YYYY-MM-DD).

**Nguyên tắc bất khả xâm phạm:**
- `raw/` CHỈ ĐỌC — không bao giờ sửa nguồn gốc.
- `wiki/` do LLM toàn quyền viết/cập nhật/xóa.
- `index.md` và `log.md` được cập nhật trên MỌI thao tác ingest/query/lint.

## 2. Quy ước trang wiki theo loại

### 2.1 Trang MODEL (mẫu xe) — `wiki/models/<thuong-hieu>-<ten-xe>.md`
```markdown
---
title: Kia Seltos 2026
type: model
brand: Kia
segment: SUV hạng B
year: 2026
price_min_vnd: 599000000
price_max_vnd: 759000000
status: dang-ban         # dang-ban | sap-ra-mat | ngung-san-xuat
updated: YYYY-MM-DD
sources: [[sources/...]]
---
# Kia Seltos 2026
## Tóm tắt (2-3 câu)
## Phiên bản & Giá (bảng)
## Thông số kỹ thuật (bảng: động cơ, hộp số, kích thước, an toàn)
## Màu sắc
## Khuyến mãi hiện hành → [[promotions/...]]
## Liên kết: [[brands/kia]]
```

### 2.2 Trang BRAND — `wiki/brands/<ten>.md`
```yaml
title, type: brand, country, parent: THACO AUTO, models: [[...]], updated
```

### 2.3 Trang PROMOTION — `wiki/promotions/<ma>.md`
```yaml
title, type: promotion, valid_from, valid_until, applies_to: [model slugs],
discount_vnd | discount_percent, conditions, status: active|expired
```
**Bắt buộc** check `valid_until` mỗi lần lint — nếu hết hạn → chuyển status thành `expired`.

### 2.4 Trang khác (company, dealer, service, faq)
```markdown
---
title: ...
type: entity | concept | source | synthesis | company | dealer | service | faq
tags: [tag1, tag2]
created: YYYY-MM-DD
updated: YYYY-MM-DD
sources: [link tới wiki/sources/...]
---

# Tên trang

## Tóm tắt ngắn (2-3 câu)
...

## Nội dung chính
...

## Liên kết
- [[Trang khác]]
- [[Trang khác 2]]

## Nguồn
- [[sources/ten-nguon]] — trích cụ thể
```

Dùng cú pháp wikilink `[[...]]` của Obsidian. Tên file dùng kebab-case không dấu (ví dụ: `nguyen-van-a.md`).

## 2.5 Trang AUTO-GENERATED (sinh tự động từ JSON) ⚡

Một số nguồn dữ liệu (ví dụ JSON xuất từ database) sẽ được sync tự động bằng script `tools/sync_models.py`. Trang sinh ra có:

```yaml
generated: true
generated_from: raw/models/<brand>/<file>.json
```

**QUY TẮC TUYỆT ĐỐI cho LLM:**
- 🚫 **KHÔNG được sửa tay** trang có `generated: true`. Sửa sẽ bị overwrite ở lần sync kế tiếp.
- ✅ Muốn đổi nội dung → sửa file JSON trong `raw/models/<brand>/` rồi chạy `python tools/sync_models.py`.
- ✅ Muốn đổi cách hiển thị (template) → sửa `tools/sync_models.py`, không sửa từng trang.
- ✅ Khi user nói "Kia Sportage giá bao nhiêu?" → đọc trang wiki bình thường, KHÔNG cần đọc JSON gốc.

**Khi nào dùng auto-sync:**
- Dữ liệu có cấu trúc rõ ràng (JSON/CSV/DB export).
- Thay đổi thường xuyên (giá, khuyến mãi, danh sách phiên bản).
- Hiện áp dụng cho: `wiki/models/` (từ `raw/models/<brand>/*.json`).

**Khi nào dùng AI ingest (thủ công):**
- Văn bản phi cấu trúc (bài giới thiệu, brochure PDF, bài báo).
- Tổng hợp/so sánh.
- Trang concept, company, FAQ viết tay.

## 3. Ba thao tác cốt lõi

### 3.1 INGEST (nạp nguồn mới)
Khi người dùng đặt một file vào `raw/` và yêu cầu xử lý:
1. Đọc toàn bộ nguồn.
2. Trao đổi ngắn với người dùng về điểm chính (3-5 gạch đầu dòng).
3. Tạo trang tóm tắt tại `wiki/sources/<ten-nguon>.md`.
4. Quét `index.md` → xác định các trang entity/concept liên quan đã tồn tại.
5. CẬP NHẬT các trang đó (thêm thông tin mới, đánh dấu mâu thuẫn nếu có).
6. TẠO trang mới cho entity/concept chưa có.
7. Cập nhật `index.md` (thêm các mục mới, sửa mô tả nếu cần).
8. Append một entry vào `log.md`.
9. Báo cáo cho người dùng: tạo X trang mới, cập nhật Y trang.

### 3.2 QUERY (hỏi đáp)
Khi người dùng hỏi:
1. Đọc `index.md` trước để định vị các trang liên quan.
2. Đọc các trang đó (KHÔNG đọc lại `raw/` trừ khi cần dẫn chứng nguyên văn).
3. Tổng hợp câu trả lời kèm trích dẫn `[[wikilink]]`.
4. Hỏi người dùng: "Có muốn lưu kết quả này thành trang `wiki/syntheses/...` không?" — nếu có giá trị lâu dài.
5. Nếu lưu: cập nhật `index.md` + `log.md`.

### 3.3 LINT (kiểm tra sức khỏe)
Khi người dùng yêu cầu `lint`:
- Tìm mâu thuẫn giữa các trang.
- Tìm trang mồ côi (không có liên kết tới).
- Tìm khái niệm được nhắc nhưng chưa có trang riêng.
- Tìm liên kết gãy `[[...]]`.
- Đề xuất câu hỏi/nguồn mới nên bổ sung.
- Báo cáo dưới dạng danh sách có ưu tiên — KHÔNG tự sửa nếu chưa được duyệt.

## 4. Quy ước log.md

Mỗi entry bắt đầu bằng tiêu đề H2 với prefix nhất quán để dễ grep:

```
## [YYYY-MM-DD] ingest | Tên nguồn
- Tạo: wiki/sources/x.md, wiki/entities/y.md
- Cập nhật: wiki/concepts/z.md
- Ghi chú: ...

## [YYYY-MM-DD] query | Câu hỏi tóm tắt
- Trang đã tham khảo: ...
- Đã lưu thành: wiki/syntheses/... (nếu có)

## [YYYY-MM-DD] lint
- Phát hiện: ...
- Đã sửa: ...
```

## 5. Phong cách viết wiki
- Ngôn ngữ: tiếng Việt (trừ khi nguồn là tiếng Anh chuyên môn — giữ thuật ngữ gốc kèm chú giải).
- Câu ngắn, gọn, có cấu trúc.
- Mỗi sự kiện/khẳng định phải truy nguyên được về `[[sources/...]]`.
- Khi hai nguồn mâu thuẫn: ghi rõ "Theo X: A; theo Y: B" — KHÔNG tự ý chọn.
- Không suy diễn không có cơ sở. Nếu suy luận, đánh dấu rõ "(Suy luận)".

## 6. Phong cách tương tác
- Trước khi ingest, hỏi 1-2 câu để hiểu mục tiêu (ví dụ: "Bạn quan tâm khía cạnh nào nhất của tài liệu này?").
- Sau mỗi ingest, báo cáo ngắn gọn (≤ 5 dòng).
- Khi không chắc, hỏi lại — không tự bịa cấu trúc.

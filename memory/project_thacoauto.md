---
name: Project THACO AUTO Wiki
description: Mục tiêu, phạm vi và đối tượng người dùng cuối của wiki thacoauto-lib
type: project
---

Xây dựng knowledge base có cấu trúc về THACO AUTO (đại lý phân phối ô tô tại Việt Nam) để phục vụ chatbot AI trả lời khách hàng.

**Why:** Người dùng cần một nguồn tri thức tập trung, được chuẩn hóa để AI truy vấn — bao gồm: thông tin công ty, các thương hiệu phân phối (Kia, Mazda, Peugeot, BMW, v.v.), chi tiết từng dòng xe, giá bán, thông số kỹ thuật, chương trình khuyến mãi, dịch vụ sau bán.

**How to apply:**
- Mọi trang wiki phải viết theo cấu trúc dễ cho AI parse: dùng frontmatter YAML giàu metadata (giá, năm SX, phân khúc, tình trạng khuyến mãi, ngày hiệu lực).
- Khuyến mãi phải có `valid_from` / `valid_until` để chatbot biết còn hiệu lực không.
- Mỗi mẫu xe = 1 trang trong `wiki/models/`, mỗi thương hiệu = 1 trang trong `wiki/brands/`.
- Giá và khuyến mãi thay đổi nhanh → cần lint định kỳ để loại bỏ thông tin hết hạn.
- Ngôn ngữ: tiếng Việt.

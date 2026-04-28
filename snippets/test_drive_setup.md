# Test Drive Module — Setup Guide

> Paste-ready snippets cho 7 node mới của module Đăng ký lái thử. Theo plan tại `C:\Users\ADMIN\.claude\plans\keen-jingling-shell.md`.

---

## Bước 1: Setup Google Sheets

### A. Sheet `sessions` hiện có — thêm 1 column

Mở Google Sheet → tab `sessions` → thêm column ngoài cùng phải:

| ... existing columns ... | **lead_partial_json** |

Để trống, n8n sẽ tự fill khi có lead.

### B. Tạo sheet mới `test_drives`

Cùng spreadsheet, tab mới tên: **`test_drives`**

Hàng 1 nhập headers (case-sensitive, snake_case):

| timestamp | sessionId | name | phone | model_interest | showroom | preferred_datetime | source_message | status |

---

## Bước 2: Sơ đồ connection mới

```
Switch.SALES_LEAD output (existing)
        ↓
[A] IF — sub_close_deal?
   ├── false (default) → Code in JavaScript (existing SALES_LEAD logic)
   └── true ↓
[B] gs_read_lead_state (Google Sheets — Get Row by sessionId)
        ↓
[C] AI Agent — Test Drive Extractor (Gemini)
        ↓
[D] merge_lead_state (Code)
        ↓
[E] IF — is_complete?
   ├── true ↓                              ├── false ↓
[F1] gs_append_test_drive (Sheets append)  [G1] gs_update_partial_state (Sheets upsert)
        ↓                                          ↓
[F2] reply_complete (Code static)          [G2] AI Agent — reply_ask_missing (Gemini)
        ↓                                          ↓
        └────────── chat respond ──────────────────┘
```

---

## Bước 3: Node configs

### Node A — `IF — sub_close_deal`
- Type: `n8n-nodes-base.if`
- Condition (string equals):
  - Left: `{{ $json.sales_subcategory }}`
  - Right: `close_deal`
- True → Node B
- False → existing `Code in JavaScript`

### Node B — `gs_read_lead_state` (Google Sheets)
- Resource: Sheet Within Document
- Operation: **Get row(s) in sheet**
- Document: (sheet đang dùng)
- Sheet: `sessions`
- Filter: `sessionId` = `{{ $json.sessionId }}` (lấy từ output IF, là từ Normalize Entities)

  ⚠ Nếu sessionId không có trong Normalize output → đổi thành `={{ $('When chat message received').item.json.sessionId }}`
- Settings → **Always Output Data**: ON
- Settings → On Error: Continue

### Node C — `AI Agent — Test Drive Extractor`
- Type: `@n8n/n8n-nodes-langchain.agent`
- Connection: kéo dây ai_languageModel từ `Google Gemini Chat Model` có sẵn (reuse — KHÔNG tạo model mới)
- KHÔNG cần Memory
- **System Message**:
  ```
  Bạn là extractor cho hệ thống đăng ký lái thử THACO AUTO.
  Trích xuất 5 field từ tin nhắn khách + history + state đã có.
  CHỈ trả JSON thuần (không markdown, không giải thích).

  - name: Họ tên khách (≥ 2 từ, vd "Nguyễn Văn A"). null nếu chưa rõ.
  - phone: SĐT VN (10 số bắt đầu 0, hoặc +84xxxxxxxxx). null nếu chưa hoặc sai format.
  - model_interest: Tên xe khách quan tâm (vd "Sportage", "Kia K5", "BMW X5", "CX-5"). null nếu chưa.
  - showroom: Tên showroom HOẶC khu vực (vd "Phú Mỹ Hưng", "Sala", "Thủ Thiêm", "An Sương", "Kia Quận 7"). null nếu chưa.
  - preferred_datetime: Text tự nhiên (vd "thứ 7 sáng", "9h ngày 28/4", "cuối tuần này"). null nếu chưa.

  QUY TẮC:
  - Đọc PARTIAL STATE + HISTORY để giữ lại field đã extract trước đó.
  - Nếu khách nói lại field cũ với giá trị mới → ưu tiên giá trị mới.
  - KHÔNG bịa. Thiếu thì để null.

  Output BẮT BUỘC:
  {"name":null|"...","phone":null|"...","model_interest":null|"...","showroom":null|"...","preferred_datetime":null|"..."}
  ```
- **Text (User Message)**:
  ```
  =### CURRENT MESSAGE
  "{{ $('When chat message received').item.json.chatInput }}"

  ### PARTIAL STATE (đã thu thập trước, có thể null toàn bộ nếu lần đầu)
  {{ $json.lead_partial_json || '{}' }}

  ### HISTORY 3 TURN GẦN NHẤT
  {{ ($('parse_session').first().json._prev.history || []).slice(-3).map(h => `User: "${h.user}"`).join('\n') || '(chưa có)' }}

  EXTRACT JSON:
  ```

### Node D — `merge_lead_state` (Code)
Paste file: [snippets/test_drive_merge.js](./test_drive_merge.js)

### Node E — `IF — is_complete`
- Type: `n8n-nodes-base.if`
- Condition (boolean):
  - Left: `{{ $json.is_complete }}`
  - Operation: `is true`
- True → Node F1
- False → Node G1

### Node F1 — `gs_append_test_drive` (Google Sheets)
- Resource: Sheet Within Document
- Operation: **Append Row**
- Document: (cùng spreadsheet)
- Sheet: `test_drives`
- Mapping Column Mode: Map Each Column Manually:

| Column | Value |
|---|---|
| timestamp | `={{ $now.toISO() }}` |
| sessionId | `={{ $json.sessionId }}` |
| name | `={{ $json.lead_data.name }}` |
| phone | `={{ $json.lead_data.phone }}` |
| model_interest | `={{ $json.lead_data.model_interest }}` |
| showroom | `={{ $json.lead_data.showroom }}` |
| preferred_datetime | `={{ $json.lead_data.preferred_datetime }}` |
| source_message | `={{ $('When chat message received').item.json.chatInput }}` |
| status | `new` |

### Node F2 — `reply_complete` (Code)
Paste file: [snippets/test_drive_reply_complete.js](./test_drive_reply_complete.js)

### Node G1 — `gs_update_partial_state` (Google Sheets)
- Operation: **Append or Update Row**
- Document: cùng spreadsheet
- Sheet: `sessions`
- Columns to Match On: `sessionId`
- Mapping:

| Column | Value |
|---|---|
| sessionId | `={{ $json.sessionId }}` |
| lead_partial_json | `={{ $json.lead_partial_json }}` |

(Các field khác giữ nguyên — không map.)

### Node G2 — `AI Agent — reply_ask_missing`
- Type: `@n8n/n8n-nodes-langchain.agent`
- Reuse Gemini Chat Model
- **System Message**:
  ```
  Bạn là tư vấn THACO AUTO. Khách đang đăng ký lái thử nhưng còn thiếu thông tin.
  Nhiệm vụ: hỏi 1-2 field còn thiếu KHÉO LÉO, không hỏi quá 2 field/lần để tránh ngộp.

  QUY TẮC:
  - Mở đầu confirm những gì đã thu thập (cho khách yên tâm), vd "Em đã ghi nhận xe Anh/Chị quan tâm là Sportage".
  - Hỏi field thiếu theo thứ tự ưu tiên: phone > name > model > showroom > datetime.
  - KHÔNG chào lại nếu là turn ≥ 2 (xem flag history.length).
  - Tone: "Em" - "Anh/Chị". Lịch sự, nhẹ nhàng.
  - Tối đa 80 từ.
  - KHÔNG dùng markdown bảng (chatbot widget không render bảng).
  - Cuối: gợi ý ngắn về showroom phổ biến nếu hỏi field showroom (PMH, Sala, An Sương...).
  ```
- **Text (User Message)**:
  ```
  =### TRẠNG THÁI HỘI THOẠI
  {{ ($('parse_session').first().json._prev.history || []).length === 0 ? 'TURN ĐẦU — được chào' : 'TURN TIẾP — KHÔNG chào lại' }}

  ### ĐÃ THU THẬP
  {{ JSON.stringify($json.lead_data) }}

  ### CÒN THIẾU
  {{ $json.missing_fields.join(', ') }}

  Hãy hỏi khách field còn thiếu theo quy tắc.
  ```

---

## Bước 4: Verify

Test 5 case theo plan (mục Verification):

1. **Turn 1 thiếu info**: gửi *"Em đặt lịch lái thử Sportage thứ 7"* → check `sessions` sheet có column `lead_partial_json` filled với `{"model_interest":"Sportage","preferred_datetime":"thứ 7"}`. Reply hỏi tên + SĐT + showroom.

2. **Turn 2 đủ info**: gửi *"Tên Nam, SĐT 0901234567, showroom PMH"* (cùng session) → check `test_drives` sheet có ROW MỚI với đủ 9 columns. Reply confirm.

3. **Phone sai format**: gửi *"0123"* → reply hỏi lại SĐT (vẫn để missing).

4. **Đủ 1 lần**: gửi *"Anh Nam 0901234567 muốn lái thử Sportage tại Sala thứ 7 9h sáng"* → save ngay turn 1.

---

## Lưu ý

- **State partial** lưu vào COLUMN `lead_partial_json` trong sheet `sessions` — hijack chung sheet để đỡ phải tạo sheet riêng cho state tạm.
- **Final lead** lưu vào sheet RIÊNG `test_drives` — cleaner cho sale team export.
- **Auto save** khi đủ 5 field — không có confirmation step (theo lựa chọn user).
- **Khi sheet test_drives đã save** — KHÔNG reset `lead_partial_json` ngay. Nếu khách quay lại đăng ký xe khác trong cùng session → state cũ vẫn còn. Cách xử lý v2: thêm Code clear partial sau F1.

# Test Drive Module — Step-by-Step Setup

> Hướng dẫn chi tiết từng bước. Làm theo thứ tự, không skip. Tổng thời gian: ~25 phút.

---

## PHẦN 1 — Google Sheets (5 phút)

### Bước 1.1 — Mở Google Sheet đang dùng

Mở spreadsheet đang chứa sheet `sessions` (sheet hiện đang lưu memory hội thoại).

### Bước 1.2 — Thêm column vào sheet `sessions`

1. Click tab **`sessions`** ở đáy spreadsheet
2. Cuộn ngang sang phải xem column cuối cùng (vd `updated_at`)
3. Click vào ô header trống ngay sau `updated_at` (vd cột H hoặc I)
4. Gõ chính xác: `lead_partial_json`
5. Enter để xác nhận

✅ Verify: Header row 1 phải có thêm `lead_partial_json` ở cuối.

### Bước 1.3 — Tạo sheet mới `test_drives`

1. Click dấu **+** ở góc dưới-trái spreadsheet (Add Sheet)
2. Right-click tab mới → **Rename** → gõ chính xác: `test_drives`
3. Click ô A1, nhập 9 headers theo đúng thứ tự (mỗi header 1 ô riêng):

| A1 | B1 | C1 | D1 | E1 | F1 | G1 | H1 | I1 |
|---|---|---|---|---|---|---|---|---|
| timestamp | sessionId | name | phone | model_interest | showroom | preferred_datetime | source_message | status |

4. Click ô A2 → để trống (n8n sẽ append từ row 2 trở đi)

✅ Verify: Sheet `test_drives` có row 1 với đúng 9 headers, các row khác trống.

### Bước 1.4 — Lưu Sheet ID (để dùng sau)

Copy URL trên trình duyệt, lấy phần Sheet ID:
```
https://docs.google.com/spreadsheets/d/[SHEET_ID_DÀI]/edit#gid=...
```

→ Sheet ID là phần ở giữa `/d/` và `/edit`. Lưu lại để chọn nhanh trong n8n.

---

## PHẦN 2 — n8n Workflow Setup (20 phút)

### Bước 2.1 — Mở workflow `n8n-workflow-actual` trong editor n8n

Đảm bảo workflow đang ở chế độ **Inactive** trước khi chỉnh (để không trigger thật khi đang sửa).

### Bước 2.2 — Tìm node `Switch.SALES_LEAD output` hiện tại

Trong canvas, tìm:
- Node `Route by Intent1` → output thứ 3 (SALES_LEAD) → đang nối vào `Code in JavaScript`

Đây là điểm sẽ chèn IF mới ở giữa.

### Bước 2.3 — Tạo NODE A: `IF — sub_close_deal`

1. Click vào dây nối giữa `Route by Intent1` (output SALES_LEAD) và `Code in JavaScript` → click chuột phải → **Delete connection** (XÓA dây này)
2. Trong khoảng trống vừa tạo, double-click canvas → search `IF` → chọn **IF** (n8n-nodes-base.if)
3. Click vào node IF mới → đặt tên: **`IF sub_close_deal`** (Settings tab → Node name)
4. Tab Parameters → **Conditions**:
   - Click **Add Condition** → chọn **String**
   - Value 1: `={{ $json.sales_subcategory }}`
   - Operation: **equals**
   - Value 2: `close_deal` (text thuần, không có dấu `=`)
5. Save node
6. **Nối dây**:
   - Output của `Route by Intent1` (output SALES_LEAD index 2) → input của `IF sub_close_deal`
   - **Output FALSE** của IF → input của `Code in JavaScript` (luồng SALES_LEAD cũ giữ nguyên)
   - **Output TRUE** của IF → để trống (sẽ nối vào Node B ở bước sau)

✅ Verify: Click tab Editor → IF node hiện màu xanh, có 2 đường ra (true/false).

### Bước 2.4 — Tạo NODE B: `gs_read_lead_state` (Google Sheets)

1. Double-click canvas → search **Google Sheets** → chọn **Google Sheets** (n8n-nodes-base.googleSheets)
2. Đặt tên: **`gs_read_lead_state`**
3. Tab Parameters:
   - **Credential**: chọn cùng credential Google đang dùng cho `gs_read_session`
   - **Resource**: `Sheet Within Document`
   - **Operation**: `Get row(s) in sheet`
   - **Document**: chọn spreadsheet vừa chỉnh
   - **Sheet**: chọn `sessions`
4. **Filter** → click Add Filter:
   - Lookup Column: `sessionId`
   - Lookup Value: `={{ $('When chat message received').item.json.sessionId }}`
5. Tab **Settings**:
   - **Always Output Data**: ✅ ON
   - **On Error**: `Continue (using error output)`
6. Save
7. **Nối dây**: TRUE output của `IF sub_close_deal` → input `gs_read_lead_state`

✅ Verify: Save workflow → click Execute Step trên IF → check execution data → gs_read_lead_state phải chạy được dù sheet trống.

### Bước 2.5 — Tạo NODE C: `AI Agent — Test Drive Extractor`

1. Double-click canvas → search **AI Agent** → chọn **AI Agent** (`@n8n/n8n-nodes-langchain.agent`)
2. Đặt tên: **`AI Agent - Test Drive Extractor`**
3. Tab Parameters:
   - **Source for Prompt**: `Define below`
   - **Text** — paste:
     ```
     =### CURRENT MESSAGE
     "{{ $('When chat message received').item.json.chatInput }}"
     
     ### PARTIAL STATE (đã thu thập trước, có thể null toàn bộ nếu lần đầu)
     {{ $json.lead_partial_json || '{}' }}
     
     ### HISTORY 3 TURN GẦN NHẤT
     {{ ($('parse_session').first().json._prev.history || []).slice(-3).map(h => `User: "${h.user}"`).join('\n') || '(chưa có)' }}
     
     EXTRACT JSON:
     ```
   - Mở **Options** → **System Message** — paste:
     ```
     =Bạn là extractor cho hệ thống đăng ký lái thử THACO AUTO.
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
     {"name":null,"phone":null,"model_interest":null,"showroom":null,"preferred_datetime":null}
     ```
4. **Connect Chat Model** (sub-node bên trái):
   - Click ô **Chat Model +** dưới node
   - Chọn `Google Gemini Chat Model` đang có sẵn (KHÔNG tạo mới — kéo dây tới model đã có)
   - Hoặc tạo mới copy credential cũ
5. KHÔNG connect Memory (để trống — extractor không cần memory riêng, đã có history qua expression)
6. Save
7. **Nối dây**: Output `gs_read_lead_state` → input `AI Agent - Test Drive Extractor`

✅ Verify: AI Agent có icon Gemini sub-node bên dưới (đã connect chat model).

### Bước 2.6 — Tạo NODE D: `merge_lead_state` (Code)

1. Double-click canvas → search **Code** → chọn **Code** (n8n-nodes-base.code)
2. Đặt tên: **`merge_lead_state`**
3. Tab Parameters:
   - **Mode**: `Run Once for All Items`
   - **Language**: `JavaScript`
   - **JavaScript Code** — paste TOÀN BỘ nội dung file [snippets/test_drive_merge.js](./test_drive_merge.js)
4. Save
5. **Nối dây**: Output `AI Agent - Test Drive Extractor` → input `merge_lead_state`

### Bước 2.7 — Tạo NODE E: `IF is_complete`

1. Double-click canvas → search **IF**
2. Đặt tên: **`IF is_complete`**
3. Tab Parameters → Add Condition → **Boolean**:
   - Value 1: `={{ $json.is_complete }}`
   - Operation: `is true`
4. Save
5. **Nối dây**: Output `merge_lead_state` → input `IF is_complete`

→ Sẽ có 2 đường ra: true (đủ field) và false (thiếu field).

### Bước 2.8 — Tạo nhánh TRUE: `gs_append_test_drive` + `reply_complete`

#### Node F1: `gs_append_test_drive`

1. Tạo Google Sheets node mới, tên **`gs_append_test_drive`**
2. Cấu hình:
   - **Credential**: cùng Google credential
   - **Resource**: `Sheet Within Document`
   - **Operation**: **`Append Row`**
   - **Document**: cùng spreadsheet
   - **Sheet**: `test_drives`
   - **Mapping Column Mode**: `Map Each Column Manually`
   - **Values to Send** — Add các field theo bảng:

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
| status | `new` (text thuần, KHÔNG có `=`) |

3. Save
4. **Nối dây**: Output **TRUE** của `IF is_complete` → input `gs_append_test_drive`

#### Node F2: `reply_complete` (Code)

1. Tạo Code node mới, tên **`reply_complete`**
2. Mode: `Run Once for All Items`
3. Paste TOÀN BỘ nội dung file [snippets/test_drive_reply_complete.js](./test_drive_reply_complete.js)
4. Save
5. **Nối dây**: Output `gs_append_test_drive` → input `reply_complete`

### Bước 2.9 — Tạo nhánh FALSE: `gs_update_partial_state` + `reply_ask_missing`

#### Node G1: `gs_update_partial_state`

1. Tạo Google Sheets node, tên **`gs_update_partial_state`**
2. Cấu hình:
   - **Operation**: **`Append or Update Row`** ⚠ KHÁC với F1 (F1 là Append)
   - **Document**: cùng spreadsheet
   - **Sheet**: `sessions`
   - **Columns to Match On**: `sessionId`
   - **Mapping**:

| Column | Value |
|---|---|
| sessionId | `={{ $json.sessionId }}` |
| lead_partial_json | `={{ $json.lead_partial_json }}` |

3. Save
4. **Nối dây**: Output **FALSE** của `IF is_complete` → input `gs_update_partial_state`

#### Node G2: `AI Agent - reply_ask_missing`

1. Tạo AI Agent node mới, tên **`AI Agent - reply_ask_missing`**
2. Tab Parameters:
   - **Source for Prompt**: `Define below`
   - **Text** — paste:
     ```
     =### TRẠNG THÁI HỘI THOẠI
     {{ ($('parse_session').first().json._prev.history || []).length === 0 ? 'TURN ĐẦU — được chào' : 'TURN TIẾP — KHÔNG chào lại' }}
     
     ### ĐÃ THU THẬP
     {{ JSON.stringify($('merge_lead_state').first().json.lead_data) }}
     
     ### CÒN THIẾU
     {{ $('merge_lead_state').first().json.missing_fields.join(', ') }}
     
     Hãy hỏi khách field còn thiếu theo quy tắc.
     ```
   - **Options → System Message** — paste:
     ```
     =Bạn là tư vấn THACO AUTO. Khách đang đăng ký lái thử nhưng còn thiếu thông tin.
     Nhiệm vụ: hỏi 1-2 field còn thiếu KHÉO LÉO, không hỏi quá 2 field/lần để tránh ngộp.
     
     QUY TẮC:
     - Mở đầu confirm những gì đã thu thập (cho khách yên tâm), vd "Em đã ghi nhận xe Anh/Chị quan tâm là Sportage".
     - Hỏi field thiếu theo thứ tự ưu tiên: phone > name > model_interest > showroom > preferred_datetime.
     - KHÔNG chào lại nếu là TURN TIẾP.
     - Tone: "Em" - "Anh/Chị". Lịch sự, nhẹ nhàng.
     - Tối đa 80 từ.
     - KHÔNG dùng markdown bảng.
     - Cuối: gợi ý ngắn về showroom phổ biến nếu hỏi field showroom (PMH, Sala, An Sương, Thủ Thiêm).
     ```
3. **Connect Chat Model**: kéo dây tới `Google Gemini Chat Model` có sẵn
4. Save
5. **Nối dây**: Output `gs_update_partial_state` → input `AI Agent - reply_ask_missing`

---

## PHẦN 3 — Verify (5 phút)

### Bước 3.1 — Save + Activate workflow

1. Click **Save** (Ctrl+S) ở góc trên
2. Toggle workflow sang **Active** (góc trên-phải)

### Bước 3.2 — Test Case 1: Turn 1 thiếu thông tin

1. Mở chat panel của workflow
2. Gửi: **`Em đặt lịch lái thử Sportage thứ 7`**
3. Kỳ vọng:
   - Reply: AI hỏi tên + SĐT + showroom
   - Mở Google Sheet `sessions` → row của sessionId này có column `lead_partial_json` chứa:
     ```json
     {"name":null,"phone":null,"model_interest":"Sportage","showroom":null,"preferred_datetime":"thứ 7"}
     ```

### Bước 3.3 — Test Case 2: Turn 2 đủ thông tin

1. Trong CÙNG chat session, gửi tiếp: **`Tên Nguyễn Văn A, SĐT 0901234567, showroom Phú Mỹ Hưng, sáng 9h`**
2. Kỳ vọng:
   - Reply: confirmation message với 5 fields
   - Mở Google Sheet `test_drives` → có ROW MỚI (timestamp + 8 fields điền đủ + status=new)

### Bước 3.4 — Test Case 3: Phone sai format

1. Session mới, gửi: **`Lái thử BMW X5, tên A, SĐT 0123, PMH thứ 7`**
2. Kỳ vọng:
   - Reply: AI hỏi lại SĐT (vì 0123 không match regex VN)
   - Sheet `sessions.lead_partial_json` có name + model + showroom + datetime nhưng phone=null

### Bước 3.5 — Test Case 4: Đủ 1 lần

1. Session mới, gửi: **`Anh Nam SĐT 0987654321 muốn lái thử Sportage tại Sala chiều thứ 7`**
2. Kỳ vọng: append row vào `test_drives` ngay turn 1.

---

## Sơ đồ flow cuối cùng

```
Route by Intent1 (output SALES_LEAD)
       ↓
[A] IF sub_close_deal? ────────────── false ──→ Code in JavaScript (existing)
       ↓ true
[B] gs_read_lead_state
       ↓
[C] AI Agent - Test Drive Extractor
       ↓
[D] merge_lead_state (Code)
       ↓
[E] IF is_complete? ────────────── false ──→ [G1] gs_update_partial_state
       ↓ true                                        ↓
[F1] gs_append_test_drive                     [G2] AI Agent - reply_ask_missing
       ↓                                              ↓
[F2] reply_complete                                 [chat respond]
       ↓
[chat respond]
```

---

## Troubleshooting

| Lỗi | Nguyên nhân | Cách fix |
|---|---|---|
| `gs_read_lead_state` báo lỗi "no data" | Lần đầu sessionId chưa có row | Bật **Always Output Data** + **On Error: Continue** |
| AI Extractor trả output không phải JSON | System prompt thiếu chỉ thị strict | Re-check System Message (phải có "CHỈ trả JSON thuần") |
| `merge_lead_state` luôn báo missing tất cả | `gs_read_lead_state` không trả data | Verify expression `$('gs_read_lead_state').first().json.lead_partial_json` đúng tên node |
| Reply trống | Output node cuối không phải `{output: ...}` | Check Code node `reply_complete` return đúng format |
| Sheet `test_drives` không append | Sheet name typo | Đổi đúng tên `test_drives` (snake_case, không space) |
| Turn 2 không nhớ partial từ turn 1 | sessionId khác giữa 2 turn | Verify cùng chat panel, không reload trang |

---

## Done ✅

Sau khi pass 4 test case → module ready production. Sale team có thể:
- Mở Google Sheet `test_drives` xem leads mới mỗi sáng
- Filter `status = new` để biết cần liên hệ
- Update status manual: `new → contacted → booked → closed`

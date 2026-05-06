# Workflow n8n — Tóm tắt route SALES_LEAD

Tài liệu mô tả chi tiết đường đi của 1 message khách hàng từ lúc nhận trigger cho đến khi trả về reply, **chỉ giới hạn nhánh `category = SALES_LEAD`** (4 sub-mode: `consultation`, `pricing_finance`, `tech_specs`, `close_deal`). Các nhánh khác (showroom, complaint, brand info, trade-in, recruitment, urgent_consult, policy_legal, greeting, safety_guard, out_of_scope, ambiguous, company_contact) không thuộc phạm vi tài liệu này.

File workflow gốc: [n8n-workflow-actual.json](n8n-workflow-actual.json)

---

## 1. Tổng quan kiến trúc

Workflow chia thành **4 giai đoạn tuần tự**:

| Giai đoạn | Vai trò | Số node chính |
|-----------|---------|---------------|
| **A. Ingress + Memory** | Nhận message, đọc state cũ từ Google Sheets | 4 |
| **B. Classify + Override** | LLM phân loại intent + override bằng regex/lead-state | 4 |
| **C. SALES_LEAD branch** | Chia thành 2 sub-flow: `close_deal` (lead capture) vs phần còn lại (consultation/pricing/tech_specs) | 7-9 |
| **D. Reply + Persist** | Bắn reply ra cho khách + ghi log + cập nhật memory | 5 |

Source-of-truth cho **lead state** = sheet `test_drives` (gid=1048020030). Source-of-truth cho **conversation memory** = sheet `sessions` (gid=0).

---

## 2. Giai đoạn A — Ingress & Memory Load

```
When chat message received3
        │
        ▼
gs_read_session              (đọc sheet `sessions` theo sessionId)
        │
        ▼
gs_read_test_drive_state     (đọc sheet `test_drives` theo sessionId — lead state)
        │
        ▼
parse_session                (Code: build _prev = { history, last_*, lead_partial, lead_has_phone, lead_complete })
```

### Chi tiết từng node

**`When chat message received3`** — n8n Chat Trigger (webhook public). Output:
- `sessionId` (UUID, ổn định cho cả phiên chat)
- `chatInput` (text user nhắn)

**`gs_read_session`** — Google Sheets read sheet `sessions`, lookup `sessionId`. Trả các cột: `last_user_msg`, `last_intent`, `last_brand`, `last_model`, `last_ai_reply`, `update_at`, `history_json`. `alwaysOutputData: true` → nếu chưa có row thì trả empty thay vì lỗi.

**`gs_read_test_drive_state`** — Google Sheets read sheet `test_drives`, lookup `sessionId`. Trả `name`, `phone`, `model_interest`, `showroom`, `preferred_datetime`, `status`, `timestamp`. Đây là **nguồn duy nhất** quyết định khách đã có lead chưa.

**`parse_session`** — Code node tổng hợp dữ liệu thô thành object chuẩn `_prev`:
```js
_prev = {
  history: [...],              // 10 turn gần nhất, parse từ history_json
  last_user_msg, last_intent, last_brand, last_model, last_ai_reply,
  lead_partial: { name, phone, model_interest, showroom, preferred_datetime } | null,
  lead_has_phone: boolean,     // true nếu test_drives row có phone hợp lệ
  lead_complete: boolean       // true nếu đủ 5 field core
}
```

Output cuối: `{ ...trigger, _prev }` truyền sang AI Agent classifier.

---

## 3. Giai đoạn B — Classify & Override

```
parse_session
    │
    ▼
AI Agent (Gemini)             (LLM phân loại 14 category + extract entities)
    │
    ▼
xu_ly_category                (Code: parse JSON LLM, OVERRIDE category nếu cần)
    │
    ▼
save_sessions → gs_save_session  (ghi history mới vào sheet sessions)
    │
    ▼
restore_router → Normalize Entities  (validate brand/slug qua vocab.json)
    │
    ▼
Route by Intent1              (Switch 14 outputs theo $json.category)
```

### Logic ép category ở `xu_ly_category`

Đây là điểm then chốt nhất của workflow. Gồm 2 trigger ép `category = SALES_LEAD` và `sales_subcategory = close_deal`:

1. **Detect contact mới trong tin nhắn**:
   - `_hasPhone`: regex SĐT VN `(?:\+?84|0)[0-9]{9,10}` trên text đã clean
   - `_hasSelfIntro`: regex bắt các pattern "tôi tên X / em tên / tên là X / em là Tuấn / gọi mình là..."
   - Nếu match + `_lastIntent` thuộc context bán hàng → ép close_deal.

2. **Lead continuation** (`_leadInProgress`):
   - `_leadInProgress = _prev.lead_has_phone && !_prev.lead_complete`
   - Nghĩa là: khách đã có row trong `test_drives` với phone, nhưng chưa đủ 5 field. Mọi turn tiếp theo bắt buộc đi vào nhánh lead capture để bồi field còn thiếu.

→ Logic combined: `_shouldForceLead = ((_hasPhone || _hasSelfIntro) && _inSalesCtx) || _leadInProgress`.

Khi `_shouldForceLead = true`:
```js
category = 'SALES_LEAD';
sales_subcategory = 'close_deal';
```

3. **Sub-category còn lại** (consultation / pricing_finance / tech_specs) do LLM tự quyết định khi `_shouldForceLead = false`.

### Switch output

`Route by Intent1` có 14 outputs. Với `SALES_LEAD` → đi vào output **#3** → `IF sub_close_deal`.

---

## 4. Giai đoạn C — SALES_LEAD branch

### 4.1. Cổng phân chia: `IF sub_close_deal`

Node IF check:
```
$json.sales_subcategory === 'close_deal'
```

| Nhánh | Khi nào | Đi đâu |
|-------|---------|--------|
| **TRUE** (close_deal) | Khách rớt SĐT/tên hoặc đang trong lead progress | `gs_read_lead_state` → Test Drive Extractor → ... |
| **FALSE** (consultation / pricing_finance / tech_specs) | Tư vấn xe, hỏi giá, hỏi spec | `Code in JavaScript` → Message a model1 |

### 4.2. Sub-flow A: Tư vấn (consultation / pricing_finance / tech_specs)

```
IF sub_close_deal (FALSE)
        │
        ▼
Code in JavaScript            (~600 dòng — Filter Engine + Markdown Trimmer + FAQ Filter + Comparison + Rolling Price Calc)
        │
        ▼
Message a model1 (Gemini Agent)   (sinh reply tự nhiên dựa vào context_bundle)
        │
        ▼
capture_reply
```

#### Code in JavaScript làm gì

Đây là **knowledge router engine** — không gọi LLM, chỉ build context bundle để Message a model1 dùng.

1. **Detect mode** từ entities + chatInput:
   - `model_slug + compare_target` → `multi_quote` hoặc `compare_internal` (tùy có "so sánh" trong text)
   - `model_slug + compare_with_brand` (đối thủ ngoài THACO) → `compare_external`
   - `model_slug` đơn → `detail`
   - Chỉ có brand/car_type/seat/fuel/budget → `shortlist_small` (≤2 xe) hoặc `shortlist_big` (3-5 xe)
   - Không có gì → `ask_more`

2. **Profile override theo sub-category** (nếu `category = SALES_LEAD`):
   - `consultation` → ưu tiên section "tóm tắt", "phiên bản", "màu sắc", "khuyến mãi"
   - `pricing_finance` → tóm tắt + phiên bản + khuyến mãi
   - `tech_specs` → tóm tắt + thông số + trang bị nổi bật + khác biệt
   - `close_deal` → chỉ tóm tắt (không cần thông tin nhiều, đã chuẩn bị chốt)

3. **Fetch knowledge từ GitHub**:
   - `wiki/models/<slug>.md` (trim markdown chỉ giữ section trong allowlist)
   - `wiki/faq/catalog.json` (filter theo `model_slug` + `qa_intents`)
   - `wiki/policies/rolling-price.json` (chỉ load khi `pricing_finance` + khách hỏi "lăn bánh")

4. **Rolling price calc** (chỉ chạy khi `pricing_finance + wantsRollingPrice`):
   - Tính phí trước bạ theo tỉnh, TNDS theo số chỗ, service fee theo brand, bảo hiểm vật chất theo % giá xe.
   - 2 chế độ output: SUMMARY (gộp phí phụ) hoặc DETAIL (breakdown từng dòng).

5. **Output**: `context_bundle` — text đa phần markdown, các section ngăn cách bằng `=== TIÊU ĐỀ ===`. AI agent sẽ đọc và format lại thành reply.

#### Message a model1 (Gemini Agent)

System prompt định nghĩa 5 chế độ trả lời (`detail`, `shortlist`, `multi_quote`, `compare_internal`, `compare_external`, `ask_more`) + 4 sub-mode (`consultation`, `pricing_finance` 3 cấp độ, `tech_specs`, `close_deal`). Tone xưng "em" - "Anh/Chị", giới hạn ≤200 từ với mode thường, ≤280 từ với compare.

Ràng buộc: chỉ dùng số liệu trong `context_bundle`, KHÔNG bịa, KHÔNG dùng bảng markdown (widget không render được), KHÔNG chào lại nếu turn > 1.

Output: `output` (text reply).

### 4.3. Sub-flow B: Lead capture (close_deal)

```
IF sub_close_deal (TRUE)
        │
        ▼
gs_read_lead_state            (đọc test_drives row hiện tại — prior state)
        │
        ▼
AI Agent - Test Drive Extractor (Gemini)   (extract 6 field từ tin nhắn turn này)
        │
        ▼
merge_lead_state              (Code: merge prior + extracted, append model_interest, validate phone, geocode showroom nếu cần)
        │
        ▼
IF is_complete (= is_leadable, có phone)
        │
        ├─ TRUE  ────► gs_append_test_drive  (appendOrUpdate row test_drives)
        │                       │
        │                       ▼
        │              IF is_complete_after_save
        │                       │
        │                       ├─ TRUE (đủ 5 field) ──► reply_complete (static reply confirm)
        │                       │
        │                       └─ FALSE (thiếu field) ──► gs_update_partial_state → AI Agent reply_ask_missing
        │
        └─ FALSE ────► gs_append_test_drive  (vẫn ghi vào test_drives để lưu name/model_interest đã thu thập, dù chưa có phone)
                                │
                                ▼
                        (nhánh giống TRUE)
                                ▼
                        AI Agent reply_ask_missing
        │
        ▼
capture_reply (mọi đường về)
```

#### Test Drive Extractor (Gemini)

System prompt yêu cầu trả về JSON 6 field:
```json
{"name": null, "phone": null, "model_interest": null,
 "showroom": null, "preferred_datetime": null, "user_location": null}
```

Quy tắc đặc biệt cho `model_interest`: **chỉ extract xe MỚI ở turn này**, KHÔNG copy lại từ PARTIAL STATE — vì layer `merge_lead_state` sẽ tự gộp.

`user_location` (vd "Quận 3, TP.HCM") không persist; chỉ dùng để gợi ý showroom gần nhất ở turn hiện tại.

#### merge_lead_state (Code)

Logic merge:
- `name`, `phone`, `showroom`, `preferred_datetime`: **lấy giá trị mới ưu tiên**, fallback prior (đơn giản `extracted.X || prior.X`).
- `model_interest`: **APPEND** qua hàm `mergeModels()`. Tách CSV cả prior + new, dedupe case-insensitive, join lại bằng `, `. Vd: prior=`"Sportage"` + new=`"K5"` → `"Sportage, K5"`.
- Validate phone bằng regex VN; nếu sai format → set null.

Tính 3 flag:
- `isLeadable = !!merged.phone` — đã đủ để Sales gọi
- `isComplete` — đủ 5 field (name/phone/model/showroom/datetime)
- `completionStatus` — `"complete"` | `"partial"` | `"incomplete"`

**Bonus**: Nếu thiếu showroom + có user_location → geocode (Nominatim) + load `wiki/dealers/catalog.json` + tính haversine + gợi ý top 3 showroom gần nhất theo brand. Nếu xa hơn 150km → báo "ngoài vùng phủ", không ép.

#### gs_append_test_drive (Google Sheets)

`appendOrUpdate` matching `sessionId` → mỗi session đúng 1 row. Cell `model_interest` được cập nhật mỗi turn với chuỗi đã gộp (vd `"Sportage, K5"`).

#### Reply path

| Trạng thái | Reply node | Đặc điểm |
|------------|------------|----------|
| `is_complete = true` | `reply_complete` | Static reply (Code) — KHÔNG gọi LLM, format ổn định, xác nhận đăng ký lái thử + cam kết Sale gọi 1-2h |
| `is_complete = false` | `AI Agent - reply_ask_missing` (Gemini) | Hỏi 1-2 field còn thiếu theo thứ tự ưu tiên `phone > name > model > showroom > datetime`. Nếu thiếu showroom + có gợi ý từ `merge_lead_state` → liệt kê top 3 showroom dạng bullet để khách chọn |

---

## 5. Giai đoạn D — Reply egress & persist

```
capture_reply (Code: chuẩn hóa output thành { output, _ai_reply_short })
        │
        ▼
build_qa_log (Code: dò xem node nào đã chạy → ghi metadata)
        │
        ▼
gs_append_qa_log (sheet `qa_logs` — log mỗi turn)
        │
        ▼
gs_update_reply (sheet `sessions` — cập nhật last_ai_reply 300 ký tự cuối)
        │
        ▼
test repsonse (Code: split text + image links + URLs để render UI)
```

### Mục đích từng node

- **`capture_reply`**: chuẩn hóa output từ các node reply khác nhau (LLM agents trả `output`, static replies trả `output`) thành 1 shape duy nhất. Trích `_ai_reply_short` = 300 ký tự cuối (CTA/đuôi câu hỏi).
- **`build_qa_log`**: duyệt qua 8 node logic ưu tiên (`Code in JavaScript`, `merge_lead_state`, ...) để xác định nhánh nào đã chạy run này → log `logic_node`, `mode`, `files_used`, `bundle_size`, `bundle_excerpt` (300 char đầu) để debug.
- **`gs_append_qa_log`**: ghi 1 row mới vào sheet `qa_logs` cho mỗi turn — phục vụ analytics/debug sau này.
- **`gs_update_reply`**: cập nhật `sessions.last_ai_reply` (= 300 ký tự cuối). Dùng cho turn sau khi Disambiguator/AI Agent đọc để hiểu khách reply nối tiếp gì.
- **`test repsonse`**: chia output thành `text`, `images[]`, `links[]` để chat widget render đẹp.

---

## 6. Sequence diagram — 1 turn close_deal

```
User                Webhook   gs_read_*     parse_session    AI Agent     xu_ly_category   IF close_deal   gs_read_lead   Test Drive Ext   merge_lead   IF is_complete   gs_append_test_drive   reply_*      gs_update_*    Widget
 │                     │          │              │              │              │                │              │              │              │              │              │                  │              │              │
 │  "tên Tuấn 0901..."│          │              │              │              │                │              │              │              │              │              │                  │              │              │
 │ ─────────────────► │          │              │              │              │                │              │              │              │              │              │                  │              │              │
 │                     │ ───────► │ sessions row │              │              │                │              │              │              │              │              │                  │              │              │
 │                     │          │ test_drives row             │              │                │              │              │              │              │              │              │                  │              │              │
 │                     │          │              │ ─ build _prev (lead_has_phone=false) ────►   │              │              │              │              │              │              │                  │              │              │
 │                     │          │              │              │ classify────►│ override:      │              │              │              │              │              │              │                  │              │              │
 │                     │          │              │              │              │ phone match→   │              │              │              │              │              │              │                  │              │              │
 │                     │          │              │              │              │ close_deal     │              │              │              │              │              │              │                  │              │              │
 │                     │          │              │              │              │ ───────────────►│ TRUE         │              │              │              │              │              │                  │              │              │
 │                     │          │              │              │              │                │ ───────────► │ {empty}      │              │              │              │              │                  │              │              │
 │                     │          │              │              │              │                │              │ ───────────► │ extract:     │              │              │              │                  │              │              │
 │                     │          │              │              │              │                │              │              │ name="Tuấn"  │              │              │              │                  │              │              │
 │                     │          │              │              │              │                │              │              │ phone="0901..."             │              │              │                  │              │              │
 │                     │          │              │              │              │                │              │              │ ───────────► │ merge:       │              │              │                  │              │              │
 │                     │          │              │              │              │                │              │              │              │ leadable=true│              │              │                  │              │              │
 │                     │          │              │              │              │                │              │              │              │ complete=false              │              │                  │              │              │
 │                     │          │              │              │              │                │              │              │              │ ───────────► │ TRUE         │              │                  │              │              │
 │                     │          │              │              │              │                │              │              │              │              │ ───────────► │ append row       │              │              │
 │                     │          │              │              │              │                │              │              │              │              │              │ {sessionId,name,phone}            │              │              │
 │                     │          │              │              │              │                │              │              │              │              │              │ ─── ask_missing ────────────────►│ "cho em xin xe quan tâm"      │
 │                     │          │              │              │              │                │              │              │              │              │              │              │                  │ ───────────► │              │
 │                     │          │              │              │              │                │              │              │              │              │              │              │                  │ update last_ai_reply           │
 │                     │          │              │              │              │                │              │              │              │              │              │              │                  │              │ ───────────►│ render
 │                     │          │              │              │              │                │              │              │              │              │              │              │                  │              │             │
 │ ◄──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────│ "cho em xin..."
```

---

## 7. State transition turn-by-turn

| Turn | User msg | `lead_has_phone` (vào) | `_shouldForceLead` | category/sub | test_drives sau turn | Reply path |
|------|----------|------------------------|---------------------|--------------|----------------------|------------|
| 1 | "em tên Tuấn, sđt 0901234567" | false | TRUE (regex hit) | SALES_LEAD/close_deal | `{name:Tuấn, phone:0901..., model:null, showroom:null, dt:null}` | reply_ask_missing (hỏi xe) |
| 2 | "em quan tâm Sportage" | true | TRUE (lead in progress) | SALES_LEAD/close_deal | `{name:Tuấn, phone:0901..., model:"Sportage", ...}` | reply_ask_missing (hỏi showroom) |
| 3 | "thêm Mazda CX-5 nữa, em ở Quận 3" | true | TRUE | SALES_LEAD/close_deal | `model:"Sportage, Mazda CX-5"`, showroom_suggestions từ Quận 3 | reply_ask_missing (gợi ý 3 showroom Kia/Mazda gần Q3) |
| 4 | "Kia Phú Mỹ Hưng, sáng thứ 7" | true | TRUE | SALES_LEAD/close_deal | đầy đủ 5 field → `is_complete=true` | reply_complete (static, xác nhận) |
| 5+ | "cảm ơn" / "xe có ADAS không" | true | FALSE (`lead_complete=true`) | quay lại consultation/tech_specs bình thường | không thay đổi test_drives | Message a model1 |

---

## 8. Phụ lục — Danh sách node của route SALES_LEAD

| # | Node name | Type | Vai trò |
|---|-----------|------|---------|
| 1 | When chat message received3 | langchain.chatTrigger | Webhook nhận message |
| 2 | gs_read_session | googleSheets | Đọc memory hội thoại |
| 3 | gs_read_test_drive_state | googleSheets | Đọc lead state |
| 4 | parse_session | code | Build `_prev` |
| 5 | AI Agent (Gemini) | langchain.agent | Classify intent |
| 6 | xu_ly_category | code | Override category bằng regex/lead-state |
| 7 | save_sessions | code | Build history mới |
| 8 | gs_save_session | googleSheets | Ghi history vào sheet sessions |
| 9 | restore_router | code | Pass-through router output |
| 10 | Normalize Entities | code | Validate brand/slug qua vocab.json |
| 11 | Route by Intent1 | switch | Phân nhánh 14 category |
| 12 | IF sub_close_deal | if | Phân nhánh 2 sub-flow |
| 13 | Code in JavaScript | code | Filter engine cho consultation/pricing/tech_specs |
| 14 | Message a model1 (Gemini) | langchain.agent | Sinh reply tư vấn |
| 15 | gs_read_lead_state | googleSheets | Đọc lại test_drives ngay trước extractor |
| 16 | AI Agent - Test Drive Extractor (Gemini) | langchain.agent | Extract 6 field |
| 17 | merge_lead_state | code | Merge + append model_interest + geocode showroom |
| 18 | IF is_complete (is_leadable) | if | Có phone hay không |
| 19 | gs_append_test_drive | googleSheets | Upsert row test_drives |
| 20 | IF is_complete_after_save | if | Đủ 5 field hay chưa |
| 21 | reply_complete | code | Static reply xác nhận |
| 22 | gs_update_partial_state | googleSheets | Ghi `lead_partial_json` vào sessions (legacy, không còn được đọc) |
| 23 | AI Agent - reply_ask_missing (Gemini) | langchain.agent | Hỏi field còn thiếu |
| 24 | capture_reply | code | Chuẩn hóa output |
| 25 | build_qa_log | code | Build metadata log |
| 26 | gs_append_qa_log | googleSheets | Ghi log mỗi turn |
| 27 | gs_update_reply | googleSheets | Cập nhật `last_ai_reply` |
| 28 | test repsonse | code | Split text/images/links |

---

## 9. Các điểm cần lưu ý khi maintain

1. **Source of truth cho lead state**: sheet `test_drives` (cột vật lý `name/phone/model_interest/showroom/preferred_datetime`). KHÔNG phụ thuộc cột `lead_partial_json` ở sheet sessions (cột này có thể chưa tồn tại — gs_update_partial_state vẫn ghi cho mục đích dự phòng nhưng workflow không đọc lại).

2. **`mergeModels` append-only**: nếu muốn reset list xe khách quan tâm, phải xoá row test_drives thủ công.

3. **Regex `_hasSelfIntro` và `_hasPhone`** ở `xu_ly_category` là **first line of defense** chống LLM hiểu nhầm — nếu thêm pattern xưng hô mới (vd "tớ tên...", "anh tên..."), bổ sung vào regex.

4. **`_leadInProgress` chỉ tắt khi `lead_complete = true`** (đủ 5 field). Nghĩa là nếu khách bỏ ngang lead capture giữa chừng và quay lại hỏi xe khác, vẫn bị ép vào close_deal flow. Trade-off này có chủ đích để Sales gọi được lead càng sớm càng tốt.

5. **Hai nhánh của `IF is_complete` cùng đi vào `gs_append_test_drive`** — quyết định có chủ đích để LUÔN ghi state mới nhất (kể cả khi chưa có phone, vẫn lưu name/model_interest để turn sau merge tiếp).

6. **`reply_complete` là static** (không gọi LLM) — đảm bảo format ổn định + tiết kiệm token. Nếu cần thay text, sửa trực tiếp trong code node.

7. **`gs_update_partial_state` (node 22) hiện là legacy** — vẫn chạy nhưng output không ai đọc. Có thể xóa khỏi flow nếu muốn tinh gọn (kèm rewire IF is_complete_after_save FALSE branch trực tiếp tới `AI Agent - reply_ask_missing`).

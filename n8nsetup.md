# n8n Chatbot Workflow — THACO AUTO Wiki

> Hướng dẫn build workflow chatbot trên n8n, sử dụng wiki này (`wiki/**/*.md`) làm knowledge base. Pattern: **không dùng RAG/embedding**, chỉ cần LLM đọc `index.md` → chọn file → đọc file → trả lời (theo tinh thần Karpathy LLM Wiki).

---

## 1. Kiến trúc tổng thể

```
┌──────────────┐
│ Khách hàng    │
│ (text/web/fb) │
└───────┬───────┘
        │
        ▼
┌───────────────────────────────────────────────────────┐
│ n8n Workflow                                           │
│                                                        │
│ [1] Trigger (Webhook / Chat / Messenger)               │
│        │                                               │
│        ▼                                               │
│ [2] Intent Gate  ← LLM phân loại câu hỏi               │
│        │                                               │
│        ├── off-topic → [2a] Reply lịch sự & dừng       │
│        │                                               │
│        ▼ (in-scope)                                    │
│ [3] Page Selector ← LLM đọc index.md → chọn file       │
│        │                                               │
│        ▼                                               │
│ [4] Fetch Files  ← HTTP đọc 1-3 file .md từ GitHub raw │
│        │          hoặc local filesystem                │
│        ▼                                               │
│ [5] Answer Composer ← LLM tổng hợp + tone/mood         │
│        │                                               │
│        ▼                                               │
│ [6] Reply to user                                      │
└───────────────────────────────────────────────────────┘
```

### Tại sao không dùng RAG / Vector DB?

- Wiki đã được cấu trúc sẵn: `index.md` là catalog, slug rõ ràng, frontmatter giàu metadata.
- Số file model/FAQ hiện tại (~100 file) hoàn toàn vừa context window LLM hiện đại.
- LLM chọn file bằng **reasoning trên tên + mô tả** tốt hơn embedding similarity trong domain hẹp.
- Không phải đồng bộ embedding khi wiki đổi → **zero-maintenance**.
- Khi wiki > 500 file hoặc latency yêu cầu < 1s → mới cân nhắc Qdrant/Pinecone.

---

## 2. Chuẩn bị trước khi build

### 2.1 Hạ tầng
- **n8n**: cloud (n8n.cloud) hoặc self-host (Docker). Self-host cho phép đọc filesystem trực tiếp.
- **LLM API**: chọn 1 trong:
  - OpenAI (GPT-4.1 mini / GPT-4o mini) — rẻ, nhanh
  - Anthropic Claude Haiku 4.5 — tốt cho tiếng Việt
  - Google Gemini 2.x Flash — free tier rộng
- **Wiki storage**: 2 cách
  - **A. Filesystem** (nếu n8n self-host chung máy với wiki) — dùng node `Read Binary File`
  - **B. GitHub repo** (push wiki lên GitHub, dùng raw URL) — dễ deploy nhất

### 2.2 Credentials cần tạo trong n8n
| Tên credential | Loại | Dùng cho |
|---|---|---|
| `llm_openai` (hoặc claude/gemini) | OpenAI API / HTTP Header Auth | Node LLM |
| `github_raw` (tùy chọn) | GitHub Personal Token | Nếu repo private |

### 2.3 Biến môi trường khuyến nghị
Đặt trong n8n Settings → Variables (hoặc `.env` nếu self-host):

```
WIKI_BASE_URL=https://raw.githubusercontent.com/<user>/thacoauto-lib/main
LLM_MODEL=gpt-4o-mini
LLM_TEMPERATURE=0.3
BOT_NAME=THACO Auto Assistant
```

---

## 3. Workflow node chi tiết

### [1] Trigger — Webhook test

**Node:** `Webhook`
- Method: `POST`
- Path: `/chat`
- Respond: `Using 'Respond to Webhook' node`

Body test (Postman/curl):
```json
{
  "user_id": "test_001",
  "message": "Giá xe Kia Sportage bản cao cấp nhất bao nhiêu?",
  "channel": "test"
}
```

**Tương lai:** thay bằng `Facebook Messenger Trigger`, `Telegram Trigger`, hoặc custom Zalo OA webhook — chỉ cần giữ schema `{user_id, message, channel}`.

---

### [2] Intent Gate — LLM phân loại

**Node:** `OpenAI Chat` (hoặc `HTTP Request` nếu dùng Claude/Gemini)

**System prompt:**
```
Bạn là bộ phân loại intent cho chatbot THACO AUTO. Phân loại câu hỏi người dùng vào một trong các nhãn sau và CHỈ trả lời bằng JSON:

- "in_scope": câu hỏi liên quan đến xe THACO AUTO (Kia, Mazda, Peugeot, BMW, MINI, xe tải, xe bus), model cụ thể, giá, khuyến mãi, showroom, bảo hành, dịch vụ, so sánh xe, Q&A tư vấn.
- "greeting": chào hỏi đơn giản (xin chào, hi, chào em).
- "off_topic": mọi thứ khác (thời tiết, bóng đá, chính trị, công ty khác...).

Trả về JSON thuần: {"intent": "...", "confidence": 0.0-1.0, "topic_hint": "từ khoá chính (nếu in_scope)"}
```

**User prompt:** `{{ $json.body.message }}`

**Output:** JSON parsed ra field `intent`.

### [2a] Off-topic fallback — IF node

**Node:** `IF`
- Điều kiện: `{{ $json.intent }}` === `"off_topic"`
- Nhánh TRUE → `Respond to Webhook` với câu:
  > "Dạ em là trợ lý tư vấn xe THACO AUTO. Em chỉ có thể hỗ trợ các câu hỏi về xe Kia, Mazda, Peugeot, BMW, MINI, xe tải, xe bus, showroom và dịch vụ của THACO AUTO. Anh/chị có câu hỏi nào về xe không ạ?"
- Nhánh `greeting` → reply câu chào mặc định.
- Nhánh `in_scope` → đi tiếp [3].

---

### [3] Page Selector — LLM chọn file wiki

**Node:** `HTTP Request` (đọc `index.md`) → `OpenAI Chat`

**3.1 Đọc index.md:**
- URL: `{{ $env.WIKI_BASE_URL }}/index.md`
- Method: GET
- Output: gán biến `wiki_index`

Đọc thêm sub-index nếu topic_hint gợi ý:
- `topic_hint` chứa "model" hoặc tên model → đọc thêm `wiki/models/index.md`
- `topic_hint` chứa "showroom" / "đại lý" → đọc thêm `wiki/dealers/index.md`
- `topic_hint` chứa "Q&A" / "so sánh" / "tư vấn" → đọc thêm `wiki/faq/index.md`

**3.2 LLM chọn file:**

**System prompt:**
```
Bạn là bộ định tuyến file cho chatbot THACO AUTO wiki. Dựa vào mục lục wiki và câu hỏi người dùng, chọn 1-3 file markdown phù hợp NHẤT để trả lời.

QUY TẮC:
- Chỉ trả JSON thuần: {"files": ["wiki/models/kia-sportage.md", "wiki/faq/kia-sportage-qa.md"]}
- Đường dẫn BẮT BUỘC bắt đầu bằng "wiki/" và kết thúc ".md"
- Chọn ít file nhất có thể (ưu tiên 1 file chính).
- Nếu câu hỏi so sánh 2 model → chọn cả 2 trang model.
- Nếu câu hỏi tư vấn sâu (vì sao, có tốt không, so sánh đối thủ) → ưu tiên trang wiki/faq/<slug>-qa.md nếu có.
- Nếu câu hỏi về showroom → chọn wiki/dealers/<area>.md.
- Nếu không tìm thấy file phù hợp → {"files": []}
```

**User prompt:**
```
MỤC LỤC WIKI:
{{ $json.wiki_index }}

{{ $json.sub_index_if_any }}

CÂU HỎI: {{ $json.message }}
```

**Output:** array `files`.

---

### [4] Fetch Files — Đọc các file đã chọn

**Node:** `Split In Batches` (loop qua `files`) → `HTTP Request`

Mỗi iteration:
- URL: `{{ $env.WIKI_BASE_URL }}/{{ $json.file_path }}`
- Method: GET
- Output: ghép lại thành `context_bundle`:
  ```
  === FILE: wiki/models/kia-sportage.md ===
  <nội dung>

  === FILE: wiki/faq/kia-sportage-qa.md ===
  <nội dung>
  ```

**Tip:** Nếu self-host cùng máy với wiki → thay HTTP bằng `Read Binary File` + `Move Binary Data` nhanh hơn, không cần push GitHub.

**Guard:** Nếu `files` rỗng → skip [5], reply "Em chưa có thông tin về câu hỏi này, anh/chị có thể liên hệ hotline 1900 xxxx..."

---

### [5] Answer Composer — LLM trả lời cuối cùng

**Node:** `OpenAI Chat` (temperature 0.3-0.5 để giọng tự nhiên nhưng không bịa)

**System prompt (tone & mood):**
```
Bạn là "{{ $env.BOT_NAME }}", trợ lý tư vấn của THACO AUTO.

TONE & MOOD:
- Xưng hô: "em" - "anh/chị", giọng lịch sự, nhiệt tình, chuyên nghiệp như nhân viên showroom Kia giỏi.
- Không quá dài dòng — trả lời ĐÚNG CÂU HỎI trước, rồi mới bổ sung.
- Dùng bullet / bảng markdown khi liệt kê giá, thông số, phiên bản.
- Kết thúc bằng 1 câu gợi ý hành động: mời xem trực tiếp, liên hệ hotline, hoặc hỏi thêm.

QUY TẮC TRẢ LỜI:
- CHỈ dùng thông tin trong CONTEXT bên dưới. Không bịa số liệu, giá, chính sách.
- Nếu CONTEXT không đủ để trả lời → nói thẳng "Em chưa có thông tin chính xác về..." và mời khách liên hệ showroom.
- Khi nhắc giá → giữ nguyên định dạng VNĐ trong CONTEXT (ví dụ: 999.000.000 ₫).
- Khi có liên kết [[wikilink]] trong CONTEXT → KHÔNG in ra wikilink cho khách, chỉ dùng làm ngữ cảnh.
- Với câu hỏi so sánh → ưu tiên dạng bảng 2 cột.
- Luôn giữ quan điểm TÍCH CỰC về sản phẩm Kia/THACO, không nói xấu đối thủ.

ĐỊNH DẠNG:
- Tiếng Việt, markdown nhẹ (bullet, bold, bảng). Không dùng heading # lớn.
- Độ dài: 3-8 câu cho câu hỏi đơn giản, dài hơn nếu có bảng giá/thông số.
```

**User prompt:**
```
CONTEXT (trích từ wiki nội bộ):
{{ $json.context_bundle }}

CÂU HỎI KHÁCH HÀNG: {{ $json.message }}

Trả lời khách hàng ngay bây giờ.
```

**Output:** `assistant_reply` (string markdown).

---

### [6] Reply — Trả về user

**Node:** `Respond to Webhook`
- Response body:
  ```json
  {
    "reply": "{{ $json.assistant_reply }}",
    "meta": {
      "files_used": "{{ $json.files }}",
      "intent": "{{ $json.intent }}"
    }
  }
  ```

Sau này bind vào channel thật (Messenger, Zalo) → thay bằng node Send Message tương ứng.

---

## 4. Flow JSON — Skeleton n8n

Import file dưới vào n8n (Workflows → Import from URL/File). Đây là skeleton — phải điền credentials + environment trước khi chạy.

```json
{
  "name": "THACO Wiki Chatbot",
  "nodes": [
    { "name": "Webhook", "type": "n8n-nodes-base.webhook", "parameters": {"path": "chat", "httpMethod": "POST"} },
    { "name": "Intent Gate", "type": "@n8n/n8n-nodes-langchain.openAi", "parameters": {"model": "gpt-4o-mini"} },
    { "name": "IF Off-topic", "type": "n8n-nodes-base.if" },
    { "name": "Reply Off-topic", "type": "n8n-nodes-base.respondToWebhook" },
    { "name": "Load index.md", "type": "n8n-nodes-base.httpRequest" },
    { "name": "Page Selector", "type": "@n8n/n8n-nodes-langchain.openAi" },
    { "name": "Split Files", "type": "n8n-nodes-base.splitInBatches" },
    { "name": "Fetch File", "type": "n8n-nodes-base.httpRequest" },
    { "name": "Merge Context", "type": "n8n-nodes-base.code" },
    { "name": "Answer Composer", "type": "@n8n/n8n-nodes-langchain.openAi" },
    { "name": "Reply", "type": "n8n-nodes-base.respondToWebhook" }
  ]
}
```

---

## 5. Test cases (golden set)

Chạy trước khi deploy — đảm bảo workflow không regress:

| # | Câu hỏi | Intent kỳ vọng | File kỳ vọng | Điểm cần check |
|---|---|---|---|---|
| 1 | "Xin chào" | greeting | — | Reply chào lịch sự |
| 2 | "Thời tiết Hà Nội hôm nay?" | off_topic | — | Redirect về chủ đề xe |
| 3 | "Kia Sportage giá bao nhiêu?" | in_scope | kia-sportage.md | Có bảng giá từ JSON |
| 4 | "Sorento PHEV sạc bao lâu đầy pin?" | in_scope | kia-sorento-hevphev-qa.md | Trả lời ~9 tiếng, 71km |
| 5 | "Showroom Kia ở Phú Mỹ Hưng ở đâu?" | in_scope | dealers/showroom-phu-my-hung.md | Trả địa chỉ + hotline |
| 6 | "So sánh Sorento với SantaFe" | in_scope | kia-new-sorento-qa.md | Dùng Q&A câu số 9-11 |
| 7 | "Xe K5 có ADAS không?" | in_scope | kia-k5-qa.md | Trả lời câu 2 của FAQ K5 |
| 8 | "Mua Kia có bảo hành mấy năm?" | in_scope | kia-sportage-qa.md (hoặc model khác) | 5 năm/150,000 km |
| 9 | "Giá dầu diesel tuần này?" | off_topic | — | Redirect |
| 10 | "Kia có xe 7 chỗ máy dầu không?" | in_scope | kia-new-sorento.md | Đúng thông tin |

---

## 6. Observability & logging

Thêm cuối workflow 1 node `Postgres` / `Google Sheets` / `n8n Execution Data` ghi lại:

| Field | Nguồn |
|---|---|
| timestamp | `{{ $now }}` |
| user_id | webhook body |
| message | webhook body |
| intent | [2] output |
| files_selected | [3] output |
| reply | [5] output |
| latency_ms | tính từ trigger → reply |
| llm_tokens | từ OpenAI response metadata |

Dùng để:
- Tìm câu hỏi thường gặp → bổ sung FAQ mới vào wiki.
- Tìm câu LLM chọn sai file → tinh chỉnh prompt [3].
- Monitor chi phí token.

---

## 7. Lộ trình nâng cấp

| Giai đoạn | Tính năng | Khi nào |
|---|---|---|
| **MVP** (tuần 1) | Webhook test → intent → select → fetch → reply | Ngay |
| **Kênh thật** (tuần 2) | Facebook Messenger / Zalo OA trigger thay webhook | Sau khi pass 10 test case |
| **Memory hội thoại** (tuần 3) | Lưu context 3-5 turn gần nhất vào Redis/Postgres, feed vào prompt [5] | Khi khách hỏi nối tiếp ("thế còn bản cao cấp?") |
| **Lead capture** (tuần 4) | Nếu intent=in_scope + có signal mua → ghi vào CRM + gửi noti sale | Khi muốn convert |
| **Vector search** (tùy) | Qdrant/Pinecone thay page selector khi wiki > 500 file | Không cần sớm |
| **A/B prompt** | Thử nhiều tone prompt [5], so sánh CSAT | Khi có > 1000 câu/tháng |

---

## 8. Checklist deploy

- [ ] n8n instance chạy ổn định
- [ ] Wiki push lên GitHub (public repo hoặc private + PAT)
- [ ] Credentials LLM đã test
- [ ] Env variables điền đầy đủ
- [ ] Import flow JSON
- [ ] Chạy 10 test case → pass ≥ 9/10
- [ ] Bật logging
- [ ] Test webhook với 3 user thật (nội bộ)
- [ ] Bật trigger channel thật
- [ ] Monitor 48h đầu, điều chỉnh prompt nếu cần

---

## 9. Lỗi thường gặp

| Triệu chứng | Nguyên nhân | Fix |
|---|---|---|
| LLM bịa giá | Temperature quá cao, hoặc CONTEXT rỗng | Set temp ≤ 0.5, thêm guard "nếu không đủ info thì từ chối" |
| Chọn sai file | index.md quá dài, LLM chọn mò | Giữ index.md < 200 dòng, đẩy chi tiết sang sub-index |
| Reply lộ wikilink `[[...]]` | Prompt [5] không cấm rõ | Thêm rule "KHÔNG in wikilink" + few-shot example |
| Timeout > 10s | Gọi LLM 3 lần tuần tự | Gộp [2]+[3] thành 1 LLM call nếu đơn giản, hoặc dùng model nhanh hơn cho [2] |
| Off-topic lọt qua | Intent prompt yếu | Thêm ví dụ few-shot vào system prompt [2] |

---

## 10. Liên kết
- [[index|Mục lục Wiki]]
- [[CLAUDE|Schema vận hành wiki]]
- Tài liệu n8n: https://docs.n8n.io
- Karpathy LLM Wiki pattern: https://karpathy.bearblog.dev/llm-wiki/

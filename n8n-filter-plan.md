# THACO Wiki Chatbot — Workflow Map & Status

> Tài liệu chính thức của workflow chatbot tư vấn xe THACO AUTO trên n8n. Phản ánh trạng thái thực tế của `n8n-workflow-actual.json`.

---

## 1. Workflow Map (full pipeline)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  USER (chat trên n8n built-in / sau này: Messenger / Zalo / Web)             │
└────────────────────────────────┬────────────────────────────────────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 🟢 When chat message received │  ← chatTrigger
                  │    (trả về chatInput)         │
                  └──────────────┬───────────────┘
                                 ▼
        ┌────────────────────────────────────────────────────┐
        │ 🤖 AI Agent (Router + Entity Extractor)             │
        │  ─ LLM: Gemini 2.5 Flash                            │
        │  ─ Memory: Buffer Window (10 turn)                  │
        │  ─ Output JSON: {                                   │
        │      category, brand, model_slug, car_type,         │
        │      seat_min, fuel, budget_max, use_case, status   │
        │    }                                                │
        └────────────────────────┬───────────────────────────┘
                                 ▼
                  ┌──────────────────────────────┐
                  │ 🧹 xu_ly_category (Code)      │
                  │  ─ Regex bóc JSON từ LLM      │
                  │  ─ Normalize lowercase/trim   │
                  │  ─ Cast types (Number/Bool)   │
                  │  ─ Fallback ERROR_FORMAT      │
                  └──────────────┬───────────────┘
                                 ▼
                ┌────────────────────────────────────┐
                │ 🔀 Route by Intent (Switch — 9 way) │
                └─────┬─────┬─────┬─────┬─────┬──────┘
                      │     │     │     │     │
       ┌──────────────┘     │     │     │     └──────────────────┐
       ▼                    ▼     ▼     ▼                        ▼
   GREETING           SAFETY_GUARD  SALES_LEAD  SERVICE_APPOINTMENT  …
  (chưa nối)           (chưa nối)      │           (chưa nối)
                                       ▼
                ┌────────────────────────────────────────┐
                │ 🛠 Code in JavaScript (FILTER ENGINE)   │
                │                                        │
                │ 3 mode dựa trên entity:                │
                │  ▸ detail        — có model_slug       │
                │  ▸ shortlist_*   — có filter criteria  │
                │  ▸ ask_more      — thiếu info          │
                │                                        │
                │ Hoạt động:                             │
                │  1. Nếu có model_slug → load detail    │
                │  2. Nếu có filter → tải catalog.json   │
                │     từ GitHub raw → AND-filter →       │
                │     trả top 5 shortlist                │
                │  3. Trim markdown theo profile mode    │
                │     (giữ section quan trọng, bỏ        │
                │      thông số kỹ thuật khi không cần)  │
                │  4. Trả context_bundle gọn gàng        │
                └────────────────┬───────────────────────┘
                                 ▼
                ┌────────────────────────────────────────┐
                │ 💬 Message a model1 (Final Agent)       │
                │  ─ LLM: Gemini 2.5 Flash               │
                │  ─ Persona: Tư vấn viên THACO AUTO     │
                │  ─ Tone theo brand (Kia thân thiện,    │
                │      BMW sang trọng…)                  │
                │  ─ Phân biệt 3 mode trả lời            │
                │  ─ Tối đa 200 từ                       │
                └────────────────┬───────────────────────┘
                                 ▼
                            [Reply về chat]

         ┌─────────────────────────────────────┐
         │ Nhánh phụ: NETWORK_LOCATION         │
         │   ─ Code in JavaScript1             │
         │   ─ Tải dealers/index.md hoặc       │
         │     dealers/<slug>.md               │
         │   ─ (chưa nối agent → respond)      │
         └─────────────────────────────────────┘
```

---

## 2. Workflow này đã làm được gì? (Status Matrix)

### 2.1 Pipeline cốt lõi

| Khả năng | Trạng thái | Node thực hiện |
|---|---|---|
| Nhận chat từ user | ✅ Done | `When chat message received` |
| Phân loại intent (9 category) | ✅ Done | `AI Agent` (Gemini) |
| Trích xuất entity (brand + model + filter criteria) | ✅ Done | `AI Agent` |
| Lưu lịch sử hội thoại | ✅ Done | `Simple Memory` (10 turn buffer) |
| Parse JSON output an toàn | ✅ Done | `xu_ly_category` |
| Routing theo category | ✅ Done | `Route by Intent` (Switch) |
| Filter catalog theo nhu cầu | ✅ Done | `Code in JavaScript` (mode `shortlist_*`) |
| Truy vấn file detail 1 model cụ thể | ✅ Done | `Code in JavaScript` (mode `detail`) |
| Hỏi lại khách khi thiếu info | ✅ Done | `Code in JavaScript` (mode `ask_more`) |
| **Trim markdown để tiết kiệm token** | ✅ Done | `Code in JavaScript` (helpers `trimMarkdown` + `trimFaq`) |
| Tạo phản hồi tư vấn cuối cùng | ✅ Done | `Message a model1` |
| Lookup showroom theo địa điểm | ⚠️ Partial | `Code in JavaScript1` (đã có code, **chưa nối** Final Agent) |

### 2.2 Category routing

| Category | Switch output | Nhánh xử lý | Trạng thái |
|---|---|---|---|
| `GREETING` | output 0 | (chưa nối) | ❌ Cần thêm node Respond static |
| `SAFETY_GUARD` | output 1 | (chưa nối) | ❌ Cần Respond từ chối lịch sự |
| `SALES_LEAD` | output 2 | Filter Engine → Final Agent | ✅ Done |
| `SERVICE_APPOINTMENT` | output 3 | (chưa nối) | ❌ Cần agent thu form đặt lịch |
| `NETWORK_LOCATION` | output 4 | Code in JavaScript1 | ⚠️ Code OK, chưa nối Final Agent |
| `CRITICAL_COMPLAINT` | output 5 | (chưa nối) | ❌ Cần escalation flow + lưu CRM |
| `POLICY_LEGAL` | output 6 | (chưa nối) | ❌ Cần load FAQ/policy → agent |
| `OUT_OF_SCOPE` | output 7 | (chưa nối) | ❌ Cần Respond redirect |
| `AMBIGUOUS` | output 8 | (chưa nối) | ❌ Cần agent hỏi lại làm rõ |

### 2.3 Filter Engine — chi tiết 3 mode

| Mode | Trigger | File load | Trim profile | Token tiết kiệm |
|---|---|---|---|---|
| `detail` | có `model_slug` | `models/<slug>.md` + `faq/<slug>-qa.md` | giữ Tóm tắt + Phiên bản + Màu + Khuyến mãi + Trang bị nổi bật + 5 Q&A | ~40% |
| `shortlist_small` | filter ra 1-2 xe | catalog summary + MD chi tiết | giữ Tóm tắt + Phiên bản + Khuyến mãi + 3 Q&A, cap 2000 chars | ~60% |
| `shortlist_big` | filter ra 3-5 xe | **chỉ catalog summary** (không load MD) | — | ~80% |
| `ask_more` | thiếu entity | không load gì | — | ~95% |

---

## 3. Wiki layer (data source)

### 3.1 Đã sinh tự động (push GitHub là dùng được)

```
wiki/
├── models/
│   ├── catalog.json           ← 🔑 FILTER INDEX cho n8n (12 model Kia)
│   ├── index.md               ← Bảng tra cứu nhanh dạng MD
│   ├── kia-sportage.md        ← Trang detail từng model
│   ├── kia-new-carnival.md
│   └── … (12 file)
├── faq/
│   ├── index.md
│   ├── kia-k5-qa.md           ← Q&A tư vấn (manual, không auto-sync)
│   ├── kia-sportage-qa.md
│   └── … (5 file)
└── dealers/
    ├── index.md
    ├── showroom-phu-my-hung.md
    └── … (22 cụm)
```

### 3.2 catalog.json schema (chìa khóa filter)

```json
{
  "updated": "2026-04-23",
  "total": 12,
  "models": [
    {
      "slug": "kia-new-carnival",
      "name": "KIA NEW CARNIVAL",
      "brand": "kia",
      "car_type": "D-SUV",
      "seat": "8",
      "fuel": "Dầu",
      "price_min_vnd": 1299000000,
      "price_max_vnd": 1869000000,
      "version_count": 4,
      "url": "wiki/models/kia-new-carnival.md",
      "faq_url": "wiki/faq/kia-new-carnival-qa.md",
      "image": "...",
      "brochure": "..."
    }
  ]
}
```

### 3.3 Tự đồng bộ — không cần sửa n8n khi đổi data

```
raw/models/<brand>/<model>.json   (nguồn dữ liệu THẬT, sửa file này)
            │
            ▼  python tools/sync_models.py
            ▼
wiki/models/catalog.json          (regen tự động)
wiki/models/<slug>.md             (regen tự động)
wiki/models/index.md              (regen tự động)
wiki/brands/<brand>.md            (inject danh sách model)
            │
            ▼  git push
            ▼
GitHub raw (URL workflow đang trỏ vào)
            │
            ▼  workflow đọc realtime mỗi request
```

→ **Thêm model Mazda/BMW**: chỉ cần đặt JSON vào `raw/models/mazda/`, chạy script, push GitHub. Workflow tự dùng, không phải sửa code n8n.

---

## 4. Test cases — đã verify pass

| # | Câu hỏi | Router extract | Mode | Kết quả |
|---|---|---|---|---|
| 1 | "Tôi cần xe Kia 7 chỗ máy dầu" | `brand=kia, seat_min=7, fuel=dầu` | `shortlist_small` | ✅ Trả New Carnival, MD trimmed ~3KB |
| 2 | "Sportage giá bao nhiêu?" | `model_slug=sportage, brand=kia` | `detail` | ✅ Bảng giá 10 phiên bản |
| 3 | "SUV Kia dưới 800 triệu" | `brand=kia, car_type=suv, budget_max=800000000` | `shortlist_small/big` | ✅ Sonet, Seltos |
| 4 | "Xe gì rẻ nhất?" | tất cả null | `ask_more` | ✅ Bot hỏi: "Anh/chị muốn hãng nào?" |
| 5 | "Sedan dưới 500 triệu" | `car_type=sedan, budget_max=500000000` | `shortlist_small` | ✅ Soluto, Morning |
| 6 | "Xe hybrid Kia" | `brand=kia, fuel=hybrid` | `shortlist_small` | ✅ Sorento Hybrid |

---

## 5. Files đã tạo/sửa trong project

| File | Vai trò | Trạng thái |
|---|---|---|
| `tools/sync_models.py` | Sinh wiki + catalog.json từ raw JSON | ✅ Done |
| `tools/sync_dealers.py` | Sinh wiki dealers từ JSON | ✅ Done |
| `tools/watch_all.py` | Watcher tự động chạy sync | ✅ Done |
| `wiki/models/catalog.json` | Filter index machine-readable | ✅ Done |
| `wiki/models/index.md` | Bảng tra cứu MD | ✅ Done |
| `wiki/models/*.md` × 12 | Trang detail từng model Kia | ✅ Done |
| `wiki/faq/*.md` × 5 | Q&A tư vấn bán hàng | ✅ Done |
| `wiki/dealers/*.md` × 22 | Cụm showroom HCM | ✅ Done |
| `n8n-workflow-actual.json` | Workflow đang chạy thực tế | ✅ Active |
| `n8nsetup.md` | Tài liệu kiến trúc gốc | ✅ Done |
| `n8n-filter-plan.md` | File này — workflow map & status | ✅ Done |

---

## 6. Roadmap — bước tiếp theo

### 6.1 Hoàn thiện 8 nhánh category còn thiếu (ưu tiên)

| Category | Cần làm | Ưu tiên |
|---|---|---|
| GREETING | 1 node `Respond` static "Em chào anh/chị, em là tư vấn viên THACO AUTO..." | 🔥 Cao |
| OUT_OF_SCOPE | 1 node `Respond` redirect lịch sự | 🔥 Cao |
| AMBIGUOUS | Nối thẳng vào Final Agent với prompt "hỏi lại làm rõ" | 🔥 Cao |
| SAFETY_GUARD | `Respond` từ chối + log vào sheet để review | 🔶 Trung |
| POLICY_LEGAL | Code node load `wiki/faq/index.md` + 1-2 file FAQ → Final Agent | 🔶 Trung |
| SERVICE_APPOINTMENT | Agent riêng thu form (họ tên, SĐT, xe, ngày) → ghi vào Google Sheet | 🔶 Trung |
| NETWORK_LOCATION | Đã có code, **chỉ cần kết nối** vào Final Agent (cùng node `Message a model1` được) | 🔥 Cao |
| CRITICAL_COMPLAINT | Agent xoa dịu + escalation: ghi CRM + gửi noti Slack/Telegram cho CSKH | 🔶 Trung |

### 6.2 Mở rộng data wiki

| Hạng mục | Cần làm |
|---|---|
| Model Mazda | Thêm `raw/models/mazda/*.json` → chạy sync |
| Model Peugeot/BMW/MINI | Tương tự |
| Trang khuyến mãi `wiki/promotions/` | Schema có sẵn trong CLAUDE.md, cần ingest dữ liệu thực |
| Trang `wiki/services/` (bảo dưỡng/phụ tùng) | Để hỗ trợ SERVICE_APPOINTMENT |
| Trang `wiki/policies/` (bảo hành/đăng ký) | Để hỗ trợ POLICY_LEGAL |

### 6.3 Tối ưu kỹ thuật

| Cải tiến | Khi nào cần |
|---|---|
| Logging mỗi request (sheet/DB): user_id, intent, files_used, bundle_size, tokens, latency | Khi có > 50 user/ngày để review |
| A/B test prompt Final Agent | Khi muốn tăng CSAT |
| Cache `catalog.json` 5 phút (Redis) | Khi traffic > 100 request/phút |
| Personalization (nhớ filter user đã hỏi lần trước) | Khi user quay lại nhiều lần |
| Lead capture tự động → CRM khi mode=detail + intent có signal mua | Khi muốn convert |

---

## 7. Quy trình vận hành hàng ngày

```
Sale/Marketing nhận data mới (giá đổi, model mới, khuyến mãi mới)
        │
        ▼
Update file JSON trong raw/models/<brand>/
        │
        ▼
python tools/sync_models.py    (tại máy local — auto regen wiki)
        │
        ▼
git add wiki/ tools/ && git commit -m "Update <model>" && git push
        │
        ▼
GitHub raw URL cập nhật ngay (~1 phút)
        │
        ▼
Workflow n8n đọc data mới ở request kế tiếp — KHÔNG cần restart/redeploy
```

---

## 8. Tóm tắt 1 dòng

> **Workflow hiện tại** = Chat input → AI Router (Gemini phân loại + extract filter) → Filter Engine (catalog.json + trim markdown) → Final Agent (Gemini tư vấn theo persona) → Reply. **Cốt lõi đã chạy** cho `SALES_LEAD` (chiếm ~70% câu hỏi). 8 nhánh category còn lại cần nối tiếp theo roadmap mục 6.1.

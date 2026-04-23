# Kế hoạch upgrade chatbot — Filter-based Wiki Query

> Mục tiêu: chatbot hiểu nhu cầu khách → filter wiki như bộ lọc website (thương hiệu / kiểu dáng / nhiên liệu / chỗ ngồi / giá) → trả shortlist xe phù hợp → tư vấn chi tiết.

---

## 1. Vấn đề hiện tại của workflow `n8n-workflow-actual.json`

| Vấn đề | Hệ quả |
|---|---|
| Router chỉ extract `brand` + `model_slug` | Khách hỏi "xe Kia 7 chỗ máy dầu dưới 1.5 tỷ" → bot không biết match vào model nào |
| `Code in JavaScript` (SALES_LEAD) chỉ load 1 file model duy nhất | Không có flow "filter shortlist" |
| AI Agent dùng index.md làm tool nhưng index.md chỉ là markdown — LLM phải đọc và parse mỗi lần | Tốn token, không deterministic |
| Thiếu file dữ liệu structured (JSON) để filter chính xác | Không tận dụng được tag (car_type, seat, fuel) đã có trong frontmatter |

---

## 2. Giải pháp: catalog.json + Filter Code Node

### 2.1 Đã có (vừa làm xong)

✅ **`tools/sync_models.py`** đã được nâng cấp tự sinh `wiki/models/catalog.json`:

```json
{
  "updated": "2026-04-23",
  "total": 12,
  "models": [
    {
      "slug": "kia-sportage",
      "name": "KIA SPORTAGE",
      "brand": "kia",
      "car_type": "C-SUV",
      "seat": "5",
      "fuel": "Xăng",
      "price_min_vnd": 819000000,
      "price_max_vnd": 1099000000,
      "url": "wiki/models/kia-sportage.md",
      "faq_url": "wiki/faq/kia-sportage-qa.md",
      ...
    },
    ...
  ]
}
```

✅ **`wiki/models/index.md`** đã có thêm bảng tra cứu nhanh có đủ tag: brand / car_type / seat / fuel / giá.

✅ Catalog hiện có đầy đủ 12 model Kia với **car_type** (Sedan, Hatchback, B-SUV, C-SUV, D-SUV, D-Sedan), **seat** (5/7/8), **fuel** (Xăng, Dầu, Hybrid).

→ Push 2 file mới này lên GitHub:
```
wiki/models/catalog.json
wiki/models/index.md
```

### 2.2 Cần làm (trong n8n)

3 thay đổi chính trên workflow hiện tại của bạn:

| Bước | Node | Hành động |
|---|---|---|
| **A** | `AI Agent` (Router) | Cập nhật system prompt để extract THÊM filter criteria |
| **B** | `Code in JavaScript` (SALES_LEAD branch) | Thay logic: nếu có `model_slug` → load model file; nếu chỉ có filter → load `catalog.json`, filter, trả shortlist |
| **C** | `Message a model1` (Final Agent) | Cập nhật system prompt để xử lý 2 mode: **shortlist** (nhiều xe) vs **detail** (1 xe) |

---

## 3. Triển khai chi tiết

### 3.1 Cập nhật System Prompt của Router AI Agent

Vào node **AI Agent**, mở System Message, thay phần "Quy tắc trích xuất" thành:

```
## Quy tắc trích xuất ENTITY:
1. brand: Tên thương hiệu (kia | mazda | peugeot | bmw | mini). Lowercase. Nếu không có → "".
2. model_slug: Nếu khách nhắc TÊN xe cụ thể (vd "Sportage", "Carens", "K5"). Lowercase, không dấu, có dash. Nếu không có → "".
3. car_type: Loại xe khách muốn: "sedan" | "hatchback" | "suv" | "mpv" | "pickup" | "truck" | "bus". Dùng khi khách mô tả nhu cầu (vd "xe gầm cao" → "suv", "xe gia đình" → null hoặc suv/mpv). Nếu không có → "".
4. seat_min: Số chỗ tối thiểu khách cần (số nguyên: 4/5/7/8/9). Vd "xe 7 chỗ" → 7. Nếu không có → null.
5. fuel: Loại nhiên liệu: "xăng" | "dầu" | "hybrid" | "phev" | "ev". Khách nói "máy dầu" → "dầu", "lai điện" → "hybrid". Nếu không có → "".
6. budget_max: Ngân sách tối đa của khách (số VNĐ). Vd "dưới 800 triệu" → 800000000, "tầm 1 tỷ" → 1100000000 (cộng 10% buffer). Nếu không có → null.
7. use_case: Mục đích sử dụng (1 cụm ngắn): "gia đình" | "đi tỉnh" | "đô thị" | "kinh doanh" | "lái thử" | null.

## Định dạng Output (BẮT BUỘC JSON):
{"category":"NAME","brand":"","model_slug":"","car_type":"","seat_min":null,"fuel":"","budget_max":null,"use_case":null,"status":true}
```

Đồng thời cập nhật **`xu_ly_category` Code node** để parse các field mới:

```javascript
const input = items[0].json;
let rawText = input.output || input.text || input.response || 
              (input.content?.parts?.[0]?.text) || (input.message?.content) || "";

try {
  const jsonMatch = rawText.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error("Không tìm thấy JSON");
  const p = JSON.parse(jsonMatch[0]);
  return [{
    json: {
      category: p.category || null,
      brand: (p.brand || "").toLowerCase().trim(),
      model_slug: (p.model_slug || "").toLowerCase().trim(),
      car_type: (p.car_type || "").toLowerCase().trim(),
      seat_min: p.seat_min ? Number(p.seat_min) : null,
      fuel: (p.fuel || "").toLowerCase().trim(),
      budget_max: p.budget_max ? Number(p.budget_max) : null,
      use_case: p.use_case || null,
      status: typeof p.status === "boolean" ? p.status : false
    }
  }];
} catch(e) {
  return [{ json: { category: "ERROR_FORMAT", raw_debug: rawText.substring(0,200), status: false }}];
}
```

### 3.2 Thay node `Code in JavaScript` (SALES_LEAD) bằng Filter Logic

Đây là node quan trọng nhất. Copy-paste toàn bộ code này vào node:

```javascript
// FILTER ENGINE — Catalog-based query for SALES_LEAD
const d = $input.first().json;
const base = 'https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/';

const brand       = (d.brand || "").toLowerCase().trim();
const model_slug  = (d.model_slug || "").toLowerCase().trim();
const car_type    = (d.car_type || "").toLowerCase().trim();
const seat_min    = d.seat_min ? Number(d.seat_min) : null;
const fuel        = (d.fuel || "").toLowerCase().trim();
const budget_max  = d.budget_max ? Number(d.budget_max) : null;

let mode = "unknown";        // 'detail' | 'shortlist' | 'ask_more'
let files_used = [];
let shortlist = [];
let bundle = '';

// =========================================================
// MODE 1: KHÁCH NHẮC MODEL CỤ THỂ → load file detail
// =========================================================
if (model_slug) {
  let final_slug = model_slug;
  if (brand && !model_slug.startsWith(brand)) final_slug = `${brand}-${model_slug}`;
  
  const detail_path = `wiki/models/${final_slug}.md`;
  files_used.push(detail_path);
  // load FAQ nếu có
  files_used.push(`wiki/faq/${final_slug}-qa.md`);
  mode = "detail";

// =========================================================
// MODE 2: CÓ FILTER CRITERIA → query catalog.json → shortlist
// =========================================================
} else if (brand || car_type || seat_min || fuel || budget_max) {
  // Load catalog
  let catalog;
  try {
    const raw = await this.helpers.httpRequest({ 
      method: 'GET', 
      url: base + 'wiki/models/catalog.json', 
      json: true,
      returnFullResponse: false 
    });
    catalog = (typeof raw === 'string' ? JSON.parse(raw) : raw).models || [];
  } catch(e) {
    catalog = [];
  }
  
  // Apply filters (tất cả là AND, mỗi filter chỉ áp dụng nếu khách có nói)
  shortlist = catalog.filter(m => {
    if (brand && (m.brand || "").toLowerCase() !== brand) return false;
    if (car_type) {
      const ct = (m.car_type || "").toLowerCase();
      // "suv" match cả B-SUV, C-SUV, D-SUV; "sedan" match cả D-Sedan
      if (!ct.includes(car_type)) return false;
    }
    if (seat_min && Number(m.seat || 0) < seat_min) return false;
    if (fuel) {
      const f = (m.fuel || "").toLowerCase();
      // map "dầu" ↔ "diesel", "xăng" ↔ "petrol"
      const fuelMap = { 'dầu': ['dầu','diesel'], 'xăng': ['xăng','petrol','gasoline'], 
                        'hybrid': ['hybrid','hev'], 'phev': ['phev','hybrid'], 'ev': ['ev','điện'] };
      const accepted = fuelMap[fuel] || [fuel];
      if (!accepted.some(a => f.includes(a))) return false;
    }
    if (budget_max && Number(m.price_min_vnd || 0) > budget_max) return false;
    return true;
  }).slice(0, 5); // Tối đa 5 xe shortlist
  
  if (shortlist.length === 0) {
    mode = "ask_more";
    bundle = `[KHÔNG có model nào khớp filter: brand=${brand}, type=${car_type}, seat>=${seat_min}, fuel=${fuel}, budget<=${budget_max}]\n\nGợi ý cho AI: xin lỗi khách, đề xuất NỚI 1 tiêu chí (vd nâng budget lên +20%, hoặc bỏ ràng buộc nhiên liệu).`;
  } else {
    mode = "shortlist";
    // Bundle = catalog entry của shortlist + load 1-2 file model nếu shortlist <=2
    bundle = `=== SHORTLIST (${shortlist.length} xe khớp tiêu chí) ===\n` 
           + shortlist.map(m => 
               `- ${m.name} (${m.car_type}, ${m.seat} chỗ, ${m.fuel}) — Giá từ ${(m.price_min_vnd/1e6).toFixed(0)} triệu — slug: ${m.slug}`
             ).join('\n');
    
    if (shortlist.length <= 2) {
      // Load chi tiết các xe shortlist để agent trả lời sâu
      for (const m of shortlist) {
        files_used.push(m.url);
        if (m.faq_url) files_used.push(m.faq_url);
      }
    }
  }

// =========================================================
// MODE 3: KHÔNG CÓ ENTITY NÀO → cần hỏi thêm
// =========================================================
} else {
  mode = "ask_more";
  // Vẫn load index để có context overview
  files_used.push('wiki/models/index.md');
  bundle = "[Khách chưa cung cấp đủ thông tin để filter. AI cần hỏi: thương hiệu nào? loại xe (sedan/SUV)? số chỗ? ngân sách?]";
}

// =========================================================
// FETCH các file MD đã chọn
// =========================================================
for (const f of files_used) {
  try {
    const data = await this.helpers.httpRequest({ 
      method: 'GET', url: base + f, returnFullResponse: false 
    });
    bundle += `\n\n=== FILE: ${f} ===\n${typeof data === 'string' ? data : JSON.stringify(data)}`;
  } catch(e) {
    // Bỏ qua file không tồn tại (vd FAQ chưa có cho model đó) — không cần báo lỗi cho AI
  }
}

return [{ 
  json: { 
    ...d, 
    mode,
    shortlist,
    files_used, 
    context_bundle: bundle 
  } 
}];
```

### 3.3 Cập nhật System Prompt của Final Agent (`Message a model1`)

Mở node Gemini cuối, sửa System Message thành:

```
# ROLE
Bạn là Chuyên viên tư vấn ảo cao cấp của THACO AUTO. Sử dụng [CONTEXT_BUNDLE] để hỗ trợ khách chuyên nghiệp, chính xác.

# 3 MODE TRẢ LỜI (xem field "mode")
- mode = "detail" → Khách hỏi 1 xe cụ thể: trả lời sâu (giá phiên bản, thông số, ưu điểm) dùng nguyên văn từ FILE.
- mode = "shortlist" → Có nhiều xe khớp filter: trình bày BẢNG so sánh ngắn (tên | loại | chỗ | nhiên liệu | giá), gợi ý 1-2 xe nổi bật nhất theo nhu cầu khách, mời khách chọn để tư vấn sâu hơn.
- mode = "ask_more" → Thiếu info: hỏi lại khéo léo theo gợi ý trong bundle. Đưa CHỌN LỰA cụ thể (vd "Anh/chị thích sedan thanh lịch hay SUV gầm cao?") thay vì hỏi mở.

# TONE & MOOD theo BRAND
- KIA/MAZDA: thân thiện, hiện đại
- BMW/PEUGEOT/MINI: sang trọng, lịch lãm
- TRUCK/BUS: tin cậy, thực tế
- Mặc định: chuyên nghiệp, hiếu khách

# XƯNG HÔ
"Anh/Chị" - "Em".

# QUY TẮC
1. CHỈ dùng số liệu (giá, thông số) trong CONTEXT. Tuyệt đối KHÔNG bịa.
2. Nếu CONTEXT có "[KHÔNG có model nào khớp]" → xin lỗi, đề xuất nới 1 tiêu chí cụ thể.
3. Nếu CONTEXT trống/lỗi → xin SĐT khách để tổng đài hỗ trợ.
4. Định dạng giá VNĐ giữ nguyên format "999.000.000 ₫".
5. KHÔNG in wikilink [[...]] cho khách.
6. Cuối câu: 1 CTA cụ thể (lái thử / báo giá lăn bánh / so sánh / ghé showroom).
7. Tối đa 200 từ.
```

Trong **User Message** của node, thêm field `mode` để LLM biết:

```
=Hãy dựa trên Persona để phản hồi:

### [CÂU HỎI HIỆN TẠI]
"{{ $('When chat message received').item.json.chatInput }}"

### [THÔNG TIN HỆ THỐNG]
- Mode trả lời: {{ $json.mode }}
- Thương hiệu: {{ $json.brand || "Chung" }}
- Loại xe: {{ $json.car_type || "—" }}
- Số chỗ tối thiểu: {{ $json.seat_min || "—" }}
- Nhiên liệu: {{ $json.fuel || "—" }}
- Ngân sách max: {{ $json.budget_max || "—" }}

### [DỮ LIỆU TRI THỨC - CONTEXT_BUNDLE]
{{ $json.context_bundle }}
```

---

## 4. Test cases để verify

| # | Câu hỏi khách | Router phải extract | Mode | Kết quả mong đợi |
|---|---|---|---|---|
| 1 | "Sportage giá bao nhiêu?" | `model_slug=sportage, brand=kia` | `detail` | Bảng giá 10 phiên bản Sportage |
| 2 | "Tôi cần xe Kia 7 chỗ máy dầu" | `brand=kia, seat_min=7, fuel=dầu` | `shortlist` | Trả về **New Carnival** (8 chỗ dầu) |
| 3 | "SUV Kia dưới 800 triệu" | `brand=kia, car_type=suv, budget_max=800000000` | `shortlist` | New Sonet, New Seltos |
| 4 | "Xe Kia 5 chỗ chạy phố" | `brand=kia, seat_min=5, use_case=đô thị` | `shortlist` | Morning, K3, Soluto, Seltos... |
| 5 | "Xe gì rẻ nhất?" | tất cả null | `ask_more` | Bot hỏi: "Anh/chị muốn xe của hãng nào?" |
| 6 | "Sedan dưới 500 triệu" | `car_type=sedan, budget_max=500000000` | `shortlist` | Soluto, Morning |
| 7 | "Xe hybrid Kia" | `brand=kia, fuel=hybrid` | `shortlist` | Sorento Hybrid |
| 8 | "Tôi thích Mazda" | `brand=mazda` | `ask_more` (vì wiki chưa có model Mazda) | "Hiện em có data đầy đủ cho Kia, các hãng khác đang cập nhật..." |

---

## 5. Mở rộng tương lai

### 5.1 Khi thêm Mazda/Peugeot/BMW vào wiki
- Chỉ cần thêm `raw/models/<brand>/*.json` → chạy `python tools/sync_models.py` → catalog.json tự cập nhật → push GitHub → workflow tự dùng (không phải sửa n8n).

### 5.2 Khi muốn filter theo trang bị (ADAS, sunroof, AWD...)
- Bổ sung field `features: ["adas", "sunroof", "awd"]` vào catalog entry.
- Sửa `tools/sync_models.py` quét `versions[].features` → extract feature tags chuẩn hoá.
- Thêm 1 filter trong filter engine.

### 5.3 Khi muốn match "use_case" thông minh hơn
- Tạo file `wiki/models/use-case-map.json`:
  ```json
  {
    "gia đình": ["kia-carens", "kia-new-sorento", "kia-new-carnival"],
    "đô thị": ["kia-morning", "kia-new-morning", "kia-k3", "kia-soluto"],
    "đi tỉnh": ["kia-new-sorento", "kia-new-carnival", "kia-sorento-hevphev"],
    "kinh doanh": ["kia-new-carnival", "kia-carens"]
  }
  ```
- Filter engine match thêm `use_case` → boost shortlist.

### 5.4 Khi muốn personalization
- Thêm Memory node lưu các filter đã trả lời lần trước → conversation tiếp theo có thể infer ("xe Kia anh hỏi hôm qua" = lần trước extract ra `kia-carens`).

---

## 6. Checklist deploy

- [x] Đã sinh `wiki/models/catalog.json` (12 model)
- [x] Đã enrich `wiki/models/index.md` (bảng tag đầy đủ)
- [ ] Push 2 file trên lên GitHub branch `main`
- [ ] Verify: `https://raw.githubusercontent.com/Meeyana/thacoauto-lib/main/wiki/models/catalog.json` trả 200
- [ ] Cập nhật System Prompt của AI Agent (Router) theo mục 3.1
- [ ] Cập nhật code `xu_ly_category` theo mục 3.1
- [ ] Replace toàn bộ code của `Code in JavaScript` (SALES_LEAD) theo mục 3.2
- [ ] Cập nhật System + User Message của `Message a model1` theo mục 3.3
- [ ] Chạy 8 test case ở mục 4 → pass ≥ 7/8
- [ ] Fix các nhánh khác (`Code in JavaScript1` cho NETWORK_LOCATION đã OK, nhưng các category còn lại — SERVICE_APPOINTMENT, POLICY_LEGAL, CRITICAL_COMPLAINT — chưa có nhánh xử lý → bổ sung sau)

---

## 7. Files đã được tạo/sửa trong session này

- ✅ `tools/sync_models.py` — thêm `write_catalog()`, enrich index.md
- ✅ `wiki/models/catalog.json` — **MỚI** (filter index)
- ✅ `wiki/models/index.md` — bảng filter đầy đủ
- ✅ `n8n-filter-plan.md` — file này
- 🗑️ `n8n-workflow.json` — đã xoá (lỗi thời)

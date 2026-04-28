// merge_lead_state — Code node sau "AI Agent — Test Drive Extractor"
// Parse JSON output → merge với state cũ từ sheet → check completeness
// Output dùng cho IF is_complete + Sheets nodes phía sau.

const aiRaw = $input.first().json.output || '';

// 1. Parse extractor JSON output (regex bóc {...} tránh markdown wrap)
let extracted = {};
try {
  const m = aiRaw.match(/\{[\s\S]*\}/);
  if (m) extracted = JSON.parse(m[0]);
} catch (e) { /* ignore */ }

// 2. Load prior partial state từ sheet (gs_read_lead_state)
let prior = {};
try {
  const row = $('gs_read_lead_state').first().json;
  if (row && row.lead_partial_json) {
    prior = JSON.parse(row.lead_partial_json);
  }
} catch (e) { /* ignore — chưa có row */ }

// 3. Helper validate phone VN
function isValidVnPhone(p) {
  if (!p) return false;
  const cleaned = p.toString().replace(/[\s\-\.]/g, '');
  return /^(\+84|84|0)[0-9]{9,10}$/.test(cleaned);
}

// 4. Merge: extracted ưu tiên hơn prior (vì AI có thể update)
//    Nếu cả 2 đều null → giữ null
const merged = {
  name: extracted.name || prior.name || null,
  phone: extracted.phone || prior.phone || null,
  model_interest: extracted.model_interest || prior.model_interest || null,
  showroom: extracted.showroom || prior.showroom || null,
  preferred_datetime: extracted.preferred_datetime || prior.preferred_datetime || null
};

// 5. Validate phone — nếu sai format thì reset (sẽ bị coi là missing)
if (merged.phone && !isValidVnPhone(merged.phone)) {
  merged.phone = null;
}

// 6. Check completeness
const missing = Object.entries(merged)
  .filter(([k, v]) => !v)
  .map(([k]) => k);
const isComplete = missing.length === 0;

// 7. Lấy sessionId từ chat trigger
const sessionId = $('When chat message received').first().json.sessionId || 'default';

return [{
  json: {
    sessionId,
    lead_data: merged,
    lead_partial_json: JSON.stringify(merged),
    missing_fields: missing,
    is_complete: isComplete,
    _debug_extracted: extracted,
    _debug_prior: prior
  }
}];

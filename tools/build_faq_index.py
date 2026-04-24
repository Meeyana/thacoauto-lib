#!/usr/bin/env python3
"""
build_faq_index.py — Parse wiki/faq/*-qa.md → wiki/faq/catalog.json

Source of truth: chính file markdown.
Mỗi câu Q&A có format:
    ## <số>. <câu hỏi>?
    **🏷 Intents:** `INTENT1`, `INTENT2`, ...

    <câu trả lời>

Output:
    wiki/faq/catalog.json — flat list mọi Q&A, n8n filter theo intent
"""
import json
import re
import sys
from pathlib import Path
from datetime import date

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
FAQ_DIR = ROOT / "wiki" / "faq"
CATALOG_FILE = FAQ_DIR / "catalog.json"

# Định nghĩa 7 intent chuẩn — sync với Router prompt n8n
INTENTS_DEFINITION = {
    "SO_SANH":    "So sánh & Ra quyết định (so sánh phiên bản, đối thủ, đáng mua không)",
    "VAN_HANH":   "Vận hành & Trải nghiệm lái (động cơ, hộp số, cách âm, cảm giác lái)",
    "TIEU_HAO":   "Mức tiêu hao nhiên liệu (xăng/dầu/điện, chi phí vận hành)",
    "NGOAI_THAT": "Ngoại thất & Kích thước (form dáng, gầm, mâm, đèn, màu)",
    "NOI_THAT":   "Nội thất & Không gian (ghế, màn hình, âm thanh, điều hòa)",
    "AN_TOAN":    "Hệ thống an toàn (túi khí, ADAS, camera, bảo hành)",
    "NHU_CAU":    "Sự phù hợp với nhu cầu (gia đình, dịch vụ, đô thị, đi tỉnh)",
}

# Regex
QUESTION_PATTERN = re.compile(
    r"^## (\d+)\.\s*(.+?)$"           # ## 1. Câu hỏi?
    r"(?:\s*\n\s*\*\*🏷 Intents:\*\*\s*(.+?)$)?"  # **🏷 Intents:** `A`, `B`
    r"([\s\S]*?)"                      # câu trả lời (greedy until next H2 or EOF)
    r"(?=^## |\Z)",
    re.MULTILINE,
)
INTENT_TAG_PATTERN = re.compile(r"`([A-Z_]+)`")


def parse_faq_markdown(md_path: Path):
    """Tách markdown thành list dict {qno, question, intents, answer}.

    Bỏ qua H2 không có số (vd `## Liên kết`).
    Bỏ qua frontmatter và blockquote intro.
    """
    text = md_path.read_text(encoding="utf-8")
    text = re.sub(r"^---[\s\S]*?---\s*", "", text)
    text = re.sub(r"^>.*$", "", text, flags=re.MULTILINE)

    questions = []
    for m in QUESTION_PATTERN.finditer(text):
        qno = int(m.group(1))
        question = m.group(2).strip()
        intent_line = (m.group(3) or "").strip()
        answer = (m.group(4) or "").strip()
        # Dọn separator "---" + section "## Liên kết" còn sót
        answer = re.sub(r"\n+---\s*$", "", answer).strip()

        intents = INTENT_TAG_PATTERN.findall(intent_line) if intent_line else []
        # Validate: chỉ giữ intent có trong định nghĩa
        valid_intents = [i for i in intents if i in INTENTS_DEFINITION]
        unknown_intents = [i for i in intents if i not in INTENTS_DEFINITION]

        questions.append({
            "qno": qno,
            "question": question,
            "intents": valid_intents,
            "_unknown_intents": unknown_intents,  # chỉ để báo lỗi, không đưa vào catalog
            "answer": answer,
        })

    return questions


def build():
    catalog = []
    stats = {}
    missing = []
    invalid = []

    for md_file in sorted(FAQ_DIR.glob("*-qa.md")):
        slug = md_file.stem.replace("-qa", "")
        try:
            questions = parse_faq_markdown(md_file)
        except Exception as e:
            print(f"  ! Lỗi parse {md_file.name}: {e}")
            continue

        if not questions:
            print(f"  ⚠ {md_file.name}: không tìm thấy câu hỏi nào")
            continue

        for q in questions:
            if not q["intents"]:
                missing.append(f"{slug}/q{q['qno']}")
            if q["_unknown_intents"]:
                invalid.append(f"{slug}/q{q['qno']}: {q['_unknown_intents']}")

            catalog.append({
                "id": f"{slug}-q{q['qno']}",
                "model_slug": slug,
                "qno": q["qno"],
                "question": q["question"],
                "intents": q["intents"],
                "answer": q["answer"],
            })

        stats[slug] = len(questions)
        print(f"  + {md_file.name}: {len(questions)} câu")

    payload = {
        "updated": date.today().isoformat(),
        "total_questions": len(catalog),
        "total_models": len(stats),
        "stats_by_model": stats,
        "intents_definition": INTENTS_DEFINITION,
        "questions": catalog,
    }
    CATALOG_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n  → wiki/faq/catalog.json ({len(catalog)} câu / {len(stats)} model)")

    if missing:
        print(f"\n  ⚠ {len(missing)} câu CHƯA CÓ INTENT (sẽ không filter được):")
        for m in missing[:10]:
            print(f"     - {m}")
        if len(missing) > 10:
            print(f"     ... và {len(missing) - 10} câu khác")
        print(f"  → Bổ sung dòng `**🏷 Intents:** `INTENT1`, `INTENT2`` ngay dưới câu hỏi.")

    if invalid:
        print(f"\n  ❌ {len(invalid)} câu có INTENT KHÔNG HỢP LỆ (không có trong định nghĩa):")
        for v in invalid[:10]:
            print(f"     - {v}")
        print(f"  → Intent hợp lệ: {', '.join(INTENTS_DEFINITION.keys())}")


if __name__ == "__main__":
    build()

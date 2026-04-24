#!/usr/bin/env python3
"""
build_faq_index.py — Parse wiki/faq/*-qa.md → wiki/faq/catalog.json

Mỗi câu Q&A trở thành 1 entry độc lập có intent tag, để n8n filter và chỉ
inject câu khớp intent vào context_bundle (giảm token mạnh).

Cấu trúc nguồn:
  wiki/faq/<slug>-qa.md       — markdown người viết (numbered H2)
  tools/faq_intents.json      — mapping intent cho từng câu

Output:
  wiki/faq/catalog.json       — flat list mọi Q&A có intent + answer
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
INTENTS_FILE = ROOT / "tools" / "faq_intents.json"
CATALOG_FILE = FAQ_DIR / "catalog.json"


def parse_faq_markdown(md_path: Path):
    """Tách markdown FAQ thành list {question_no, question, answer}.

    Quy ước: mỗi câu hỏi là H2 dạng `## <số>. <câu hỏi>?`
    Câu trả lời là toàn bộ text giữa H2 hiện tại và H2 kế tiếp.
    Bỏ qua các H2 không có số đầu (vd `## Liên kết`).
    """
    text = md_path.read_text(encoding="utf-8")
    # Bỏ frontmatter
    text = re.sub(r"^---[\s\S]*?---\s*", "", text)
    # Bỏ blockquote intro
    text = re.sub(r"^>.*$", "", text, flags=re.MULTILINE)

    questions = []
    # Regex bắt H2 dạng "## 1. Câu hỏi?"
    pattern = re.compile(r"^## (\d+)\.\s*(.+?)$", re.MULTILINE)
    matches = list(pattern.finditer(text))

    for i, m in enumerate(matches):
        qno = int(m.group(1))
        question = m.group(2).strip()
        # Answer = text từ cuối heading hiện tại đến đầu match kế (hoặc EOF)
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        answer = text[start:end].strip()
        # Dọn separator "---" cuối answer
        answer = re.sub(r"\n+---\s*$", "", answer).strip()
        questions.append({"qno": qno, "question": question, "answer": answer})

    return questions


def build():
    if not INTENTS_FILE.exists():
        print(f"! Không tìm thấy {INTENTS_FILE}")
        return

    intents_map = json.loads(INTENTS_FILE.read_text(encoding="utf-8"))
    intents_def = intents_map.get("_intents_definition", {})

    catalog = []
    stats = {}
    missing_intents = []

    for md_file in sorted(FAQ_DIR.glob("*-qa.md")):
        slug = md_file.stem.replace("-qa", "")
        slug_intents = intents_map.get(slug, {})

        try:
            questions = parse_faq_markdown(md_file)
        except Exception as e:
            print(f"! Lỗi parse {md_file.name}: {e}")
            continue

        if not questions:
            print(f"  ⚠ {md_file.name}: không tìm thấy câu hỏi nào")
            continue

        for q in questions:
            qno_str = str(q["qno"])
            tags = slug_intents.get(qno_str, [])
            if not tags:
                missing_intents.append(f"{slug}/{qno_str}")

            catalog.append({
                "id": f"{slug}-q{q['qno']}",
                "model_slug": slug,
                "qno": q["qno"],
                "question": q["question"],
                "intents": tags,
                "answer": q["answer"],
            })

        stats[slug] = len(questions)
        print(f"  + {md_file.name}: {len(questions)} câu")

    today = date.today().isoformat()
    payload = {
        "updated": today,
        "total_questions": len(catalog),
        "total_models": len(stats),
        "stats_by_model": stats,
        "intents_definition": intents_def,
        "questions": catalog,
    }
    CATALOG_FILE.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    print(f"\n  → wiki/faq/catalog.json ({len(catalog)} câu / {len(stats)} model)")
    if missing_intents:
        print(f"\n  ⚠ {len(missing_intents)} câu chưa có intent (sẽ không filter được):")
        for m in missing_intents[:10]:
            print(f"     - {m}")
        if len(missing_intents) > 10:
            print(f"     ... và {len(missing_intents) - 10} câu khác")
        print(f"  → Bổ sung trong tools/faq_intents.json")


if __name__ == "__main__":
    build()

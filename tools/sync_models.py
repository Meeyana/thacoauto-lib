#!/usr/bin/env python3
"""
sync_models.py — Tự động sinh trang wiki cho model xe từ JSON.

Quét mọi file `raw/models/<brand>/*.json` và sinh `wiki/models/<slug>.md`.
Trang sinh ra được đánh dấu `generated: true` — KHÔNG sửa tay.
Sửa JSON nguồn, chạy lại script, trang wiki cập nhật.

Usage:
    python tools/sync_models.py
    python tools/sync_models.py --watch   # theo dõi & tự sync khi JSON đổi
"""
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from datetime import date

# Ép UTF-8 cho stdout để in tiếng Việt trên Windows console (cp1252)
try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw" / "models"
WIKI_DIR = ROOT / "wiki" / "models"
BRANDS_DIR = ROOT / "wiki" / "brands"
FAQ_DIR = ROOT / "wiki" / "faq"
INDEX_FILE = ROOT / "index.md"

MARKER_BEGIN = "<!-- BEGIN: auto-generated models -->"
MARKER_END = "<!-- END: auto-generated models -->"
BRAND_MARKER_BEGIN = "<!-- BEGIN: auto-generated model list -->"
BRAND_MARKER_END = "<!-- END: auto-generated model list -->"


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    return re.sub(r"[-\s]+", "-", s)


def fmt_vnd(v):
    if v is None or v == "":
        return "—"
    try:
        return f"{int(v):,}".replace(",", ".") + " ₫"
    except (ValueError, TypeError):
        return str(v)


# Các giá trị placeholder vô nghĩa cần loại bỏ khỏi bảng spec
PLACEHOLDER_VALUES = {"mm", "kg", "cc", "lít", "hp / rpm", "Nm / rpm", "", None}


def render_spec_table(spec: dict) -> str:
    if not spec:
        return "_(không có thông số)_"
    lines = []
    for group, items in spec.items():
        if not items:
            continue
        rows = [(k, v) for k, v in items.items() if v not in PLACEHOLDER_VALUES]
        if not rows:
            continue
        lines.append(f"\n#### {group}\n")
        lines.append("| Hạng mục | Giá trị |")
        lines.append("|---|---|")
        for k, v in rows:
            lines.append(f"| {k} | {v} |")
    return "\n".join(lines)


def render_versions_table(versions):
    if not versions:
        return "_(chưa có phiên bản)_"
    lines = ["| # | Phiên bản | Giá |", "|---|---|---|"]
    for i, v in enumerate(versions, 1):
        lines.append(f"| {i} | {v.get('version_name','').strip()} | {fmt_vnd(v.get('price'))} |")
    return "\n".join(lines)


def render_version_diff(v):
    diff = v.get("spec_different")
    if not diff:
        return ""
    out = [f"\n### {v.get('version_name','').strip()}\n"]
    for group, items in diff.items():
        rows = [(k, val) for k, val in items.items() if val not in PLACEHOLDER_VALUES]
        if not rows:
            continue
        out.append(f"**{group}**\n")
        for k, val in rows:
            out.append(f"- {k}: {val}")
        out.append("")
    return "\n".join(out)


def render_model(json_path: Path, brand: str):
    data = json.loads(json_path.read_text(encoding="utf-8"))
    car = data.get("car_info", {})
    versions = data.get("versions", [])
    name = car.get("name", json_path.stem).strip()
    slug = slugify(name)

    prices = [v["price"] for v in versions if v.get("price")]
    if car.get("lowest_price"):
        prices.append(car["lowest_price"])
    pmin = min(prices) if prices else None
    pmax = max(prices) if prices else None

    today = date.today().isoformat()

    md = []
    md.append("---")
    md.append(f"title: {name}")
    md.append("type: model")
    md.append(f"brand: {brand.capitalize()}")
    md.append("status: dang-ban")
    if car.get("car_type"):
        md.append(f"car_type: {car['car_type']}")
    if car.get("seat"):
        md.append(f"seat: {car['seat']}")
    if car.get("fuel"):
        md.append(f"fuel: {car['fuel']}")
    md.append(f"price_min_vnd: {pmin or ''}")
    md.append(f"price_max_vnd: {pmax or ''}")
    md.append(f"version_count: {len(versions)}")
    if car.get("brochure"):
        md.append(f"brochure: {car['brochure']}")
    if car.get("image"):
        md.append(f"image: {car['image']}")
    md.append("generated: true")
    md.append(f"generated_from: {json_path.relative_to(ROOT).as_posix()}")
    md.append(f"updated: {today}")
    md.append("---")
    md.append("")
    md.append(f"> ⚠️ Trang này được **tự động sinh** từ `{json_path.relative_to(ROOT).as_posix()}`. "
              f"**KHÔNG sửa tay** — sửa JSON nguồn rồi chạy `python tools/sync_models.py`.")
    md.append("")
    md.append(f"# {name}")
    md.append("")
    if car.get("image"):
        md.append(f"![{name}]({car['image']})")
        md.append("")

    md.append("## Tóm tắt")
    if car.get("car_type"):
        md.append(f"- **Phân loại:** {car['car_type']}")
    if car.get("seat"):
        md.append(f"- **Số chỗ ngồi:** {car['seat']}")
    if car.get("fuel"):
        md.append(f"- **Nhiên liệu:** {car['fuel']}")
    md.append(f"- **Giá từ:** {fmt_vnd(pmin)}")
    if pmax and pmax != pmin:
        md.append(f"- **Giá cao nhất:** {fmt_vnd(pmax)}")
    md.append(f"- **Số phiên bản:** {len(versions)}")
    if car.get("brochure"):
        md.append(f"- **Brochure:** [Tải PDF]({car['brochure']})")
    md.append("")

    md.append("## Phiên bản & Giá")
    md.append("")
    md.append(render_versions_table(versions))
    md.append("")

    if car.get("exterior_colors") or car.get("interior_colors"):
        md.append("## Màu sắc")
        if car.get("exterior_colors"):
            md.append(f"- **Ngoại thất:** {', '.join(car['exterior_colors'])}")
        if car.get("interior_colors"):
            md.append(f"- **Nội thất:** {', '.join(car['interior_colors'])}")
        md.append("")

    gifts = car.get("gifts", [])
    warranty = car.get("warranty_policy", [])
    if gifts or warranty:
        md.append("## Khuyến mãi & Quà tặng kèm")
        for g in gifts:
            md.append(f"- {g.get('promotion_gift','')} — giá trị {fmt_vnd(g.get('price_gift'))}")
        for w in warranty:
            md.append(f"- {w}")
        md.append("")

    md.append("## Thông số kỹ thuật (bản tiêu chuẩn)")
    md.append(render_spec_table(car.get("specifications", {})))
    md.append("")

    has_diff = any(v.get("spec_different") for v in versions)
    if has_diff:
        md.append("## Khác biệt giữa các phiên bản")
        for v in versions:
            md.append(render_version_diff(v))

    md.append("## Trang bị nổi bật theo phiên bản")
    md.append("")
    for v in versions:
        feat = (v.get("features") or "").strip()
        if not feat:
            continue
        md.append(f"### {v.get('version_name','').strip()}")
        md.append(f"_{feat}_")
        md.append("")

    faqs = car.get("faqs", [])
    if faqs:
        md.append("## FAQ")
        md.append("")
        for topic in faqs:
            for q in topic.get("danh_sach_cau_hoi", []):
                md.append(f"**Q: {q.get('cau_hoi','')}**")
                md.append("")
                md.append(q.get("cau_tra_loi", ""))
                md.append("")

    faq_file = FAQ_DIR / f"{slug}-qa.md"
    if faq_file.exists():
        md.append("## 📚 Q&A mở rộng (từ tài liệu đào tạo bán hàng)")
        md.append("")
        md.append(f"Xem trang Q&A chi tiết: [[faq/{slug}-qa]] — câu hỏi & trả lời tư vấn khách hàng, biên soạn từ tài liệu đào tạo chính thức.")
        md.append("")

    md.append("## Liên kết")
    md.append(f"- [[brands/{brand}]]")
    md.append("- [[company/thaco-auto]]")
    if faq_file.exists():
        md.append(f"- [[faq/{slug}-qa|Q&A — {name}]]")
    md.append("")

    out_file = WIKI_DIR / f"{slug}.md"
    out_file.write_text("\n".join(md), encoding="utf-8")
    catalog_entry = {
        "slug": slug,
        "name": name,
        "brand": brand,
        "car_type": car.get("car_type"),
        "seat": car.get("seat"),
        "fuel": car.get("fuel"),
        "price_min_vnd": pmin,
        "price_max_vnd": pmax,
        "version_count": len(versions),
        "status": "dang-ban",
        "url": f"wiki/models/{slug}.md",
        "faq_url": f"wiki/faq/{slug}-qa.md" if faq_file.exists() else None,
        "image": car.get("image"),
        "brochure": car.get("brochure"),
    }
    return slug, name, pmin, brand, catalog_entry


def write_catalog(generated):
    """Ghi wiki/models/catalog.json — filter index cho chatbot/n8n."""
    catalog = [g[4] for g in generated]
    today = date.today().isoformat()
    payload = {
        "updated": today,
        "total": len(catalog),
        "models": catalog,
    }
    (WIKI_DIR / "catalog.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def render_models_subindex(generated):
    """Tạo wiki/models/index.md tổng hợp tất cả model + bảng filter đầy đủ."""
    today = date.today().isoformat()
    by_brand = {}
    for slug, name, pmin, brand, _ in generated:
        by_brand.setdefault(brand, []).append((slug, name, pmin))

    md = []
    md.append("---")
    md.append("title: Danh sách Model THACO AUTO")
    md.append("type: model-index")
    md.append(f"total_models: {len(generated)}")
    md.append(f"total_brands: {len(by_brand)}")
    md.append("generated: true")
    md.append(f"updated: {today}")
    md.append("---")
    md.append("")
    md.append("> ⚠️ Trang này được **tự động sinh**. **KHÔNG sửa tay**.")
    md.append("")
    md.append("# Danh sách Model THACO AUTO")
    md.append("")
    md.append(f"- **Tổng số model:** {len(generated)}")
    md.append(f"- **Tổng số thương hiệu có model:** {len(by_brand)}")
    md.append("")

    for brand in sorted(by_brand):
        items = sorted(by_brand[brand], key=lambda x: x[2] or 0)
        md.append(f"## {brand.capitalize()} ({len(items)} model)")
        md.append("")
        md.append("| Model | Giá từ |")
        md.append("|---|---|")
        for slug, name, pmin in items:
            md.append(f"| [[models/{slug}\\|{name}]] | {fmt_vnd(pmin)} |")
        md.append("")

    # Bảng filter tổng — mọi model + tag (brand, loại, chỗ, nhiên liệu, giá)
    md.append("## Bảng tra cứu nhanh (filter theo tag)")
    md.append("")
    md.append("| Model | Thương hiệu | Loại xe | Số chỗ | Nhiên liệu | Giá từ |")
    md.append("|---|---|---|---|---|---|")
    all_rows = sorted(generated, key=lambda x: (x[3], x[4].get("car_type") or "", x[2] or 0))
    for slug, name, pmin, brand, entry in all_rows:
        md.append(
            f"| [[models/{slug}\\|{name}]] | {brand.capitalize()} | "
            f"{entry.get('car_type') or '—'} | {entry.get('seat') or '—'} | "
            f"{entry.get('fuel') or '—'} | {fmt_vnd(pmin)} |"
        )
    md.append("")
    md.append("> 📊 **Filter dạng JSON cho chatbot:** [[models/catalog|catalog.json]] "
              "(machine-readable, dùng cho n8n / API).")
    md.append("")

    md.append("## Liên kết")
    md.append("- [[company/thaco-auto]]")
    md.append("")
    (WIKI_DIR / "index.md").write_text("\n".join(md), encoding="utf-8")


def update_index(generated):
    render_models_subindex(generated)
    write_catalog(generated)
    if not INDEX_FILE.exists():
        return
    content = INDEX_FILE.read_text(encoding="utf-8")

    by_brand = {}
    for slug, name, pmin, brand, _ in generated:
        by_brand.setdefault(brand, []).append((slug, name, pmin))

    brands_summary = ", ".join(f"{b.capitalize()} ({len(items)})"
                               for b, items in sorted(by_brand.items()))
    block = [MARKER_BEGIN, ""]
    block.append(f"**{len(generated)} model** trên {len(by_brand)} thương hiệu: {brands_summary}.")
    block.append("")
    block.append("📋 **Sub-index chi tiết:** [[models/index]] (bảng đầy đủ + giá từng model)")
    block.append("")
    block.append(MARKER_END)
    new_block = "\n".join(block)

    if MARKER_BEGIN in content:
        content = re.sub(
            re.escape(MARKER_BEGIN) + r".*?" + re.escape(MARKER_END),
            new_block, content, flags=re.DOTALL,
        )
    else:
        old = "## Models (Dòng xe)\n*(chưa có — bước tiếp theo)*"
        new = f"## Models (Dòng xe)\n{new_block}"
        if old in content:
            content = content.replace(old, new)
        else:
            # fallback: append at end
            content += f"\n\n## Models (Dòng xe)\n{new_block}\n"

    INDEX_FILE.write_text(content, encoding="utf-8")


def update_brand_pages(generated):
    """Inject danh sách model vào trang brand giữa BRAND_MARKER_BEGIN/END."""
    by_brand = {}
    for slug, name, pmin, brand, _ in generated:
        by_brand.setdefault(brand, []).append((slug, name, pmin))

    for brand, items in by_brand.items():
        brand_file = BRANDS_DIR / f"{brand}.md"
        if not brand_file.exists():
            print(f"  ! Bỏ qua brand '{brand}' — không tìm thấy {brand_file.name}")
            continue

        # Build block
        items.sort(key=lambda x: (x[2] or 0, x[1]))
        block_lines = [BRAND_MARKER_BEGIN, ""]
        block_lines.append(f"_Tự động sinh từ `tools/sync_models.py` — {len(items)} model._")
        block_lines.append("")
        block_lines.append("| Model | Giá từ |")
        block_lines.append("|---|---|")
        for slug, name, pmin in items:
            block_lines.append(f"| [[models/{slug}\\|{name}]] | {fmt_vnd(pmin)} |")
        block_lines.append("")
        block_lines.append(BRAND_MARKER_END)
        new_block = "\n".join(block_lines)

        content = brand_file.read_text(encoding="utf-8")

        if BRAND_MARKER_BEGIN in content:
            content = re.sub(
                re.escape(BRAND_MARKER_BEGIN) + r".*?" + re.escape(BRAND_MARKER_END),
                new_block, content, flags=re.DOTALL,
            )
        else:
            # Thay placeholder "Models đang phân phối\n*(chưa cập nhật...)*"
            placeholder = re.compile(
                r"## Models đang phân phối\s*\n\*\(chưa[^)]*\)\*",
                flags=re.IGNORECASE,
            )
            replacement = f"## Models đang phân phối\n\n{new_block}"
            if placeholder.search(content):
                content = placeholder.sub(replacement, content, count=1)
            else:
                # Không có placeholder → chèn trước "## Liên kết" hoặc append cuối
                if "## Liên kết" in content:
                    content = content.replace(
                        "## Liên kết",
                        f"## Models đang phân phối\n\n{new_block}\n\n## Liên kết",
                        1,
                    )
                else:
                    content += f"\n\n## Models đang phân phối\n\n{new_block}\n"

        brand_file.write_text(content, encoding="utf-8")
        print(f"  ~ wiki/brands/{brand}.md  (cập nhật {len(items)} model)")


def run_once():
    WIKI_DIR.mkdir(parents=True, exist_ok=True)
    if not RAW_DIR.exists():
        print(f"Không tìm thấy {RAW_DIR}")
        return []
    generated = []
    for brand_dir in sorted(p for p in RAW_DIR.iterdir() if p.is_dir()):
        brand = brand_dir.name
        for jf in sorted(brand_dir.glob("*.json")):
            try:
                generated.append(render_model(jf, brand))
                print(f"  + {brand}/{jf.name} -> wiki/models/{generated[-1][0]}.md")
            except Exception as e:
                print(f"  ! LỖI {brand}/{jf.name}: {e}")
    update_index(generated)
    update_brand_pages(generated)
    print(f"\nDone. {len(generated)} trang model.")
    return generated


def watch():
    print("Watching raw/models/ ... (Ctrl+C to stop)")
    seen = {}
    try:
        while True:
            changed = False
            for jf in RAW_DIR.rglob("*.json"):
                m = jf.stat().st_mtime
                if seen.get(jf) != m:
                    seen[jf] = m
                    changed = True
            if changed:
                print(f"\n[{time.strftime('%H:%M:%S')}] Phát hiện thay đổi, sync lại...")
                run_once()
            time.sleep(2)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    if "--watch" in sys.argv:
        watch()
    else:
        run_once()

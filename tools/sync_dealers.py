#!/usr/bin/env python3
"""
sync_dealers.py — Tự động sinh trang wiki cho showroom/đại lý từ JSON.

Quét mọi file `raw/*-listshowroom.json` và sinh:
  - wiki/dealers/<group_slug>.md     : 1 file / cụm khu vực
  - wiki/dealers/index.md            : chỉ mục tổng hợp tất cả khu vực

Trang sinh ra có `generated: true` — KHÔNG sửa tay.

Usage:
    python tools/sync_dealers.py
    python tools/sync_dealers.py --watch
"""
import json
import re
import sys
import time
from pathlib import Path
from datetime import date

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
RAW_DIR = ROOT / "raw"
DEALERS_DIR = ROOT / "wiki" / "dealers"
ROOT_INDEX = ROOT / "index.md"

# Map tỉnh/thành → URL trang showroom chính thức (THACO AUTO)
# Khách hỏi chung "showroom ở HCM" → gửi link tỉnh đó
PROVINCE_URLS = {
    "ho-chi-minh": "https://thacoautotphcm.vn/showrooms",
    # "ha-noi": "https://thacoautohanoi.vn/showrooms",   # bổ sung khi có
    # "da-nang": "https://thacoautodanang.vn/showrooms",
    # "binh-duong": "https://thacoautobinhduong.vn/showrooms",
}

ROOT_MARKER_BEGIN = "<!-- BEGIN: auto-generated dealers -->"
ROOT_MARKER_END = "<!-- END: auto-generated dealers -->"


def slugify_simple(s: str) -> str:
    import unicodedata
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^\w\s-]", "", s).strip().lower()
    return re.sub(r"[-\s]+", "-", s)


def parse_address(addr: str) -> dict:
    """Tách địa chỉ thành street + ward + province (best effort).

    Format chuẩn: "<số nhà + tên đường>, Phường <X>, <Tỉnh/TP>"
    Có thể có thêm Xã/Thị trấn thay Phường.
    """
    if not addr:
        return {"full": "", "street": "", "ward": "", "province": ""}
    full = addr.strip()
    parts = [p.strip() for p in full.split(",")]
    street, ward, province = "", "", ""
    if len(parts) >= 3:
        street = parts[0]
        # Tìm phần tử có "Phường|Xã|Thị trấn"
        for p in parts[1:-1]:
            m = re.match(r"^(Phường|Xã|Thị trấn)\s+(.+)$", p)
            if m:
                ward = m.group(2).strip()
                break
        province = parts[-1]
    elif len(parts) == 2:
        street = parts[0]
        province = parts[1]
    else:
        street = full
    return {"full": full, "street": street, "ward": ward, "province": province}


def safe(v, default="—"):
    return v if v else default


def render_showroom(item: dict) -> str:
    title = item.get("title", "").strip()
    brands = ", ".join(item.get("brands", [])) or "—"
    address = item.get("address", "—")
    phone = item.get("phone")
    phone_dv = item.get("phone_dv_pt")
    phone_cskh = item.get("phone_cskh")
    actions = item.get("actions", {}) or {}
    map_url = actions.get("mapUrl")
    website = actions.get("website")
    image = item.get("image")
    business = item.get("business", "—")
    tags = ", ".join(item.get("tags", [])) or "—"
    type_sr = item.get("type_showroom", "—")

    out = []
    out.append(f"### {title}")
    out.append("")
    if image:
        out.append(f"![{title}]({image})")
        out.append("")
    out.append(f"- **Thương hiệu:** {brands}")
    out.append(f"- **Loại hình:** {business} ({type_sr})")
    out.append(f"- **Dịch vụ:** {tags}")
    out.append(f"- **Địa chỉ:** {address}")
    if phone:
        out.append(f"- **Hotline bán hàng:** {phone}")
    if phone_dv:
        out.append(f"- **Hotline dịch vụ & phụ tùng:** {phone_dv}")
    if phone_cskh:
        out.append(f"- **Hotline CSKH:** {phone_cskh}")
    if map_url:
        out.append(f"- 📍 [Xem Google Maps]({map_url})")
    if website:
        out.append(f"- 🌐 [Website]({website})")
    out.append("")
    return "\n".join(out)


def render_group(group: dict, source_file: str) -> tuple:
    name = group["province_name"].strip()
    slug = group["group_slug"].strip()
    items = group.get("items", [])
    today = date.today().isoformat()

    # Tổng hợp brand tại cụm này
    all_brands = set()
    for it in items:
        for b in it.get("brands", []):
            all_brands.add(b)
    brands_csv = ", ".join(sorted(all_brands))

    # Suy ra tỉnh/thành phố từ item đầu tiên (nếu có)
    province = ""
    if items and items[0].get("province"):
        province = items[0]["province"].get("name", "")

    md = []
    md.append("---")
    md.append(f"title: {name}")
    md.append("type: dealer-area")
    md.append(f"area_slug: {slug}")
    if province:
        md.append(f"province: {province}")
    md.append(f"showroom_count: {len(items)}")
    md.append(f"brands: [{', '.join(sorted(all_brands))}]")
    md.append("generated: true")
    md.append(f"generated_from: {source_file}")
    md.append(f"updated: {today}")
    md.append("---")
    md.append("")
    md.append(f"> ⚠️ Trang này được **tự động sinh** từ `{source_file}`. "
              f"**KHÔNG sửa tay** — sửa JSON nguồn rồi chạy `python tools/sync_dealers.py`.")
    md.append("")
    md.append(f"# {name}")
    md.append("")
    md.append(f"- **Tỉnh/Thành:** {province or '—'}")
    md.append(f"- **Số showroom:** {len(items)}")
    md.append(f"- **Thương hiệu có mặt:** {brands_csv or '—'}")
    md.append("")
    md.append("---")
    md.append("")
    md.append("## Danh sách showroom")
    md.append("")
    for it in items:
        md.append(render_showroom(it))

    md.append("## Liên kết")
    md.append("- [[dealers/index|← Quay lại danh sách khu vực]]")
    md.append("- [[company/thaco-auto]]")
    md.append("")

    out_file = DEALERS_DIR / f"{slug}.md"
    out_file.write_text("\n".join(md), encoding="utf-8")
    return slug, name, len(items), all_brands, province


def render_dealers_index(groups_summary, source_files):
    """Tạo wiki/dealers/index.md tổng hợp tất cả cụm + filter theo brand."""
    today = date.today().isoformat()
    total = sum(g[2] for g in groups_summary)

    # Brand → list of (area_name, area_slug, count)
    brand_to_areas = {}
    for slug, name, count, brands, province in groups_summary:
        for b in brands:
            brand_to_areas.setdefault(b, []).append((name, slug, count))

    md = []
    md.append("---")
    md.append("title: Danh sách Showroom THACO AUTO")
    md.append("type: dealer-index")
    md.append(f"total_areas: {len(groups_summary)}")
    md.append(f"total_showrooms: {total}")
    md.append("generated: true")
    md.append(f"generated_from: {', '.join(source_files)}")
    md.append(f"updated: {today}")
    md.append("---")
    md.append("")
    md.append("> ⚠️ Trang này được **tự động sinh**. **KHÔNG sửa tay**.")
    md.append("")
    md.append("# Danh sách Showroom THACO AUTO")
    md.append("")
    md.append(f"- **Tổng số khu vực:** {len(groups_summary)}")
    md.append(f"- **Tổng số showroom:** {total}")
    md.append("")

    md.append("## Theo khu vực")
    md.append("")
    md.append("| Khu vực | Tỉnh/Thành | Số SR | Thương hiệu |")
    md.append("|---|---|---|---|")
    for slug, name, count, brands, province in sorted(groups_summary, key=lambda x: x[1]):
        bs = ", ".join(sorted(brands)) or "—"
        md.append(f"| [[dealers/{slug}\\|{name}]] | {province or '—'} | {count} | {bs} |")
    md.append("")

    md.append("## Tra cứu theo thương hiệu")
    md.append("")
    md.append("_Tìm nhanh: \"thương hiệu X có mặt ở khu vực nào?\"_")
    md.append("")
    for brand in sorted(brand_to_areas):
        areas = brand_to_areas[brand]
        area_links = ", ".join(f"[[dealers/{s}\\|{n}]]" for n, s, _ in sorted(areas))
        md.append(f"- **{brand}** ({len(areas)} khu vực): {area_links}")
    md.append("")

    md.append("## Liên kết")
    md.append("- [[company/thaco-auto]]")
    md.append("")

    (DEALERS_DIR / "index.md").write_text("\n".join(md), encoding="utf-8")


def write_dealer_catalog(all_items, source_files):
    """Sinh wiki/dealers/catalog.json — flat list cho n8n.

    Use case:
    - Khách hỏi đích danh tên showroom → lookup theo title
    - Khách hỏi chung theo tỉnh → trả PROVINCE_URLS[province]
    """
    today = date.today().isoformat()

    catalog_items = []
    for it in all_items:
        actions = it.get("actions") or {}
        addr_parsed = parse_address(it.get("address", ""))
        brand_slugs = sorted({slugify_simple(b) for b in it.get("brands", []) if b})
        province_slug = slugify_simple(addr_parsed["province"]) if addr_parsed["province"] else None

        catalog_items.append({
            "id": slugify_simple(it.get("title", "")),
            "title": it.get("title", "").strip(),
            "brands": it.get("brands", []),
            "brand_slugs": brand_slugs,
            "business": it.get("business"),
            "type_showroom": it.get("type_showroom"),  # oto / tai
            "services": it.get("tags", []),  # Showroom / Phụ tùng / Dịch vụ
            "address": addr_parsed,
            "province_slug": province_slug,
            "phone_sale": it.get("phone"),
            "phone_service": it.get("phone_dv_pt"),
            "phone_cskh": it.get("phone_cskh"),
            "map_url": actions.get("mapUrl"),
            "website": actions.get("website"),
            "image": it.get("image"),
        })

    # Stats
    distinct_provinces = sorted({c["province_slug"] for c in catalog_items if c["province_slug"]})
    distinct_brands = sorted({b for c in catalog_items for b in c["brand_slugs"]})
    distinct_wards = sorted({c["address"]["ward"] for c in catalog_items if c["address"]["ward"]})

    payload = {
        "updated": today,
        "total": len(catalog_items),
        "source_files": source_files,
        "stats": {
            "provinces": distinct_provinces,
            "brands": distinct_brands,
            "wards": distinct_wards,
        },
        "province_urls": PROVINCE_URLS,
        "showrooms": catalog_items,
    }
    (DEALERS_DIR / "catalog.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"  ~ wiki/dealers/catalog.json ({len(catalog_items)} showroom, "
          f"{len(distinct_brands)} brand, {len(distinct_wards)} ward)")


def update_root_index(groups_summary):
    if not ROOT_INDEX.exists():
        return
    content = ROOT_INDEX.read_text(encoding="utf-8")

    total = sum(g[2] for g in groups_summary)
    provinces = sorted({p for *_, p in groups_summary if p})
    block = [ROOT_MARKER_BEGIN, ""]
    block.append(f"**{len(groups_summary)} khu vực · {total} showroom** "
                 f"trên {len(provinces)} tỉnh/thành.")
    block.append("")
    block.append("📋 **Sub-index chi tiết:** [[dealers/index]] "
                 "(bảng đầy đủ + tra cứu theo thương hiệu)")
    block.append("")
    block.append(ROOT_MARKER_END)
    new_block = "\n".join(block)

    if ROOT_MARKER_BEGIN in content:
        content = re.sub(
            re.escape(ROOT_MARKER_BEGIN) + r".*?" + re.escape(ROOT_MARKER_END),
            new_block, content, flags=re.DOTALL,
        )
    else:
        old = "## Dealers (Đại lý / Showroom)\n*(chưa có)*"
        new = f"## Dealers (Đại lý / Showroom)\n{new_block}"
        if old in content:
            content = content.replace(old, new)
        else:
            content += f"\n\n## Dealers (Đại lý / Showroom)\n{new_block}\n"

    ROOT_INDEX.write_text(content, encoding="utf-8")


def run_once():
    DEALERS_DIR.mkdir(parents=True, exist_ok=True)
    json_files = sorted(RAW_DIR.glob("*-listshowroom.json"))
    if not json_files:
        print(f"Không tìm thấy *-listshowroom.json trong {RAW_DIR}")
        return []

    all_summary = []
    all_items = []  # flat list mọi showroom cho catalog.json
    source_files = []
    for jf in json_files:
        rel = jf.relative_to(ROOT).as_posix()
        source_files.append(rel)
        try:
            data = json.loads(jf.read_text(encoding="utf-8"))
            groups = data.get("data", [])
            print(f"\n→ {rel} ({len(groups)} cụm)")
            for g in groups:
                summary = render_group(g, rel)
                all_summary.append(summary)
                all_items.extend(g.get("items", []))
                print(f"  + dealers/{summary[0]}.md  ({summary[2]} showroom)")
        except Exception as e:
            print(f"  ! LỖI {rel}: {e}")

    if all_summary:
        render_dealers_index(all_summary, source_files)
        write_dealer_catalog(all_items, source_files)
        update_root_index(all_summary)
        print(f"  ~ wiki/dealers/index.md")
        print(f"  ~ index.md (cập nhật mục Dealers)")

    total = sum(s[2] for s in all_summary)
    print(f"\nDone. {len(all_summary)} khu vực, {total} showroom.")
    return all_summary


def watch():
    print("Watching raw/*-listshowroom.json ... (Ctrl+C to stop)")
    seen = {}
    try:
        while True:
            changed = False
            for jf in RAW_DIR.glob("*-listshowroom.json"):
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

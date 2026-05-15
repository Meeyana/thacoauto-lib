#!/usr/bin/env python3
"""
geocode_dealers.py — Cập nhật lat/lon cho mọi showroom trong
`wiki/dealers/catalog.json` BẰNG CÁCH PARSE từ field `map_url` (Google Maps).

Quy tắc:
- LUÔN overwrite (kể cả showroom đã có lat/lon) — đảm bảo dữ liệu khớp với
  link hiện tại. Nếu link expire/lỗi → giữ nguyên giá trị cũ + log cảnh báo.
- Short link (maps.app.goo.gl, goo.gl/maps, g.co/kgs/…) → follow redirect lấy
  URL canonical rồi parse.
- Sau khi update catalog, ĐỒNG THỜI patch các file `wiki/dealers/showroom-*.md`
  để chèn dòng `- 📌 Toạ độ: lat, lon` ngay dưới dòng `📍 [Xem Google Maps]`.
  Idempotent: nếu đã có dòng toạ độ → ghi đè.

Usage:
    python tools/geocode_dealers.py                # chạy cho toàn bộ
    python tools/geocode_dealers.py --limit 5      # test 5 showroom đầu
    python tools/geocode_dealers.py --no-md        # chỉ update catalog.json
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path
from urllib.parse import unquote
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "wiki" / "dealers" / "catalog.json"
DEALERS_DIR = ROOT / "wiki" / "dealers"

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
)
SHORT_HOSTS = ("maps.app.goo.gl", "goo.gl/maps", "g.co/kgs", "g.co/maps")
SLEEP_SECONDS = 0.4  # nhẹ tay với Google — chỉ HEAD/GET redirect, không gọi API

# Lat/lon hợp lệ cho VN (chặn parse nhầm zoom level v.v.)
VN_LAT_RANGE = (8.0, 24.0)
VN_LON_RANGE = (102.0, 110.0)

# Pattern theo thứ tự ưu tiên (!3d!4d = vị trí MARKER thực, chính xác nhất)
PATTERNS = [
    ("marker", re.compile(r"!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)")),
    ("camera", re.compile(r"@(-?\d+\.\d+),(-?\d+\.\d+)")),
    ("q",      re.compile(r"[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)")),
    ("ll",     re.compile(r"[?&]ll=(-?\d+\.\d+),(-?\d+\.\d+)")),
    ("daddr",  re.compile(r"[?&]daddr=(-?\d+\.\d+),(-?\d+\.\d+)")),
]


def is_short_link(url: str) -> bool:
    return any(h in url for h in SHORT_HOSTS)


def expand_short_link(url: str, max_hops: int = 5) -> str | None:
    """Follow redirect tới URL canonical."""
    cur = url
    for _ in range(max_hops):
        try:
            req = Request(cur, headers={"User-Agent": USER_AGENT}, method="GET")
            with urlopen(req, timeout=15) as resp:
                final = resp.geturl()
            if final == cur:
                return final
            cur = final
            if not is_short_link(cur):
                return cur
        except (URLError, HTTPError) as e:
            print(f"    ! redirect lỗi: {e}")
            return None
    return cur


def parse_coords(url: str) -> tuple[float, float, str] | None:
    """Trích lat/lon từ URL Google Maps. Trả (lat, lon, source) hoặc None."""
    if not url:
        return None
    decoded = unquote(url)
    for source, rx in PATTERNS:
        m = rx.search(decoded)
        if not m:
            continue
        try:
            lat = float(m.group(1))
            lon = float(m.group(2))
        except ValueError:
            continue
        if not (VN_LAT_RANGE[0] <= lat <= VN_LAT_RANGE[1]):
            continue
        if not (VN_LON_RANGE[0] <= lon <= VN_LON_RANGE[1]):
            continue
        return (lat, lon, source)
    return None


def resolve(map_url: str) -> tuple[float, float, str, str] | None:
    """Trả (lat, lon, source, final_url) hoặc None."""
    if not map_url:
        return None
    target = map_url
    if is_short_link(map_url):
        expanded = expand_short_link(map_url)
        if not expanded:
            return None
        target = expanded
    coords = parse_coords(target)
    if not coords:
        # Nhiều khi short link redirect tới `consent.google.com?continue=…`
        # → URL gốc nằm trong query `continue=`. Decode + retry.
        m = re.search(r"continue=([^&]+)", target)
        if m:
            inner = unquote(m.group(1))
            coords = parse_coords(inner)
            if coords:
                return (*coords, inner)
        return None
    return (*coords, target)


# ---------- MD PATCHING ----------

COORD_LINE_RX = re.compile(r"^- 📌 Toạ độ:.*$", re.MULTILINE)
MAP_LINE_RX = re.compile(r"^(- 📍 \[Xem Google Maps\]\(([^)]+)\))", re.MULTILINE)


def patch_md_file(md_path: Path, url_to_coords: dict[str, tuple[float, float]]) -> int:
    """Insert/replace dòng toạ độ ngay sau dòng Google Maps. Trả số block đã update."""
    text = md_path.read_text(encoding="utf-8")
    updated = 0

    def repl(match: re.Match) -> str:
        nonlocal updated
        line = match.group(1)
        url = match.group(2)
        coords = url_to_coords.get(url)
        if not coords:
            return line
        updated += 1
        return f"{line}\n- 📌 Toạ độ: {coords[0]}, {coords[1]}"

    # Bước 1: xoá hết dòng toạ độ cũ để tránh trùng lặp
    text = COORD_LINE_RX.sub("", text)
    # Dọn dòng trống dư
    text = re.sub(r"\n{3,}", "\n\n", text)

    # Bước 2: chèn lại dòng toạ độ ngay sau map_url
    new_text = MAP_LINE_RX.sub(repl, text)

    if new_text != md_path.read_text(encoding="utf-8"):
        md_path.write_text(new_text, encoding="utf-8")
    return updated


# ---------- MAIN ----------

def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0, help="Chỉ xử lý N showroom đầu (test)")
    ap.add_argument("--no-md", action="store_true", help="Không patch các file markdown")
    args = ap.parse_args()

    if not CATALOG_PATH.exists():
        print(f"Không tìm thấy {CATALOG_PATH}. Chạy tools/sync_dealers.py trước.")
        sys.exit(1)

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    showrooms = catalog.get("showrooms", [])
    if not showrooms:
        print("Catalog rỗng.")
        return

    pending = [s for s in showrooms if (s.get("map_url") or "").strip()]
    if args.limit > 0:
        pending = pending[: args.limit]

    print(f"Tổng showroom: {len(showrooms)} | có map_url: {len(pending)}")

    # Cache kết quả theo map_url để tránh expand cùng short link 2 lần
    url_cache: dict[str, tuple[float, float, str, str]] = {}
    url_to_coords: dict[str, tuple[float, float]] = {}  # cho MD patch

    ok, fail, drift = 0, 0, 0

    for i, s in enumerate(pending, 1):
        url = s["map_url"].strip()
        title = s.get("title", "?")

        if url in url_cache:
            res = url_cache[url]
            print(f"[{i}/{len(pending)}] (cache) {title}")
        else:
            print(f"[{i}/{len(pending)}] resolve {title} ← {url[:60]}")
            res = resolve(url)
            time.sleep(SLEEP_SECONDS)
            if res:
                url_cache[url] = res

        if not res:
            fail += 1
            print(f"    ✗ không parse được lat/lon — giữ nguyên giá trị cũ")
            continue

        lat, lon, source, final_url = res
        old_lat, old_lon = s.get("lat"), s.get("lon")

        # Cảnh báo nếu lệch > ~5km so với lat/lon cũ
        if isinstance(old_lat, (int, float)) and isinstance(old_lon, (int, float)):
            # haversine xấp xỉ — đủ để phát hiện drift
            dy = (lat - old_lat) * 111.0
            dx = (lon - old_lon) * 111.0 * 0.94  # cos(~20°)
            dist_km = (dy * dy + dx * dx) ** 0.5
            if dist_km > 5:
                drift += 1
                print(f"    ⚠ drift {dist_km:.1f} km so với cũ (cũ: {old_lat},{old_lon})")

        s["lat"] = lat
        s["lon"] = lon
        s["coord_source"] = source
        ok += 1
        url_to_coords[url] = (lat, lon)

    # Stats
    geocoded = sum(1 for s in showrooms if isinstance(s.get("lat"), (int, float)))
    catalog.setdefault("stats", {})
    catalog["stats"]["geocoded"] = geocoded
    catalog["stats"]["geocoded_unique_urls"] = len(url_cache)

    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"\nĐã ghi {CATALOG_PATH}")
    print(f"  ~ updated: {ok} | failed: {fail} | drift>5km: {drift}")
    print(f"  ~ tổng có lat/lon: {geocoded}/{len(showrooms)}")

    # Patch MD
    if args.no_md:
        return
    if not url_to_coords:
        print("Không có URL nào parse được → bỏ qua patch MD.")
        return

    print(f"\nPatching markdown trong {DEALERS_DIR.relative_to(ROOT)}...")
    md_files = sorted(DEALERS_DIR.glob("showroom-*.md"))
    total_blocks = 0
    for md in md_files:
        n = patch_md_file(md, url_to_coords)
        if n:
            print(f"  • {md.name}: +{n} block")
            total_blocks += n
    print(f"Done. Patched {total_blocks} block trên {len(md_files)} file MD.")


if __name__ == "__main__":
    main()

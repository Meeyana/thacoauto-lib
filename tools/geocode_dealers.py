#!/usr/bin/env python3
"""
geocode_dealers.py — Bổ sung lat/lon cho từng showroom trong wiki/dealers/catalog.json.

Quy tắc:
- Gọi Nominatim với query = address.full (URL-encoded).
- Lấy kết quả ĐẦU TIÊN trong mảng trả về.
- Dedupe: nếu nhiều showroom có cùng address.full thì chỉ gọi 1 lần và share lat/lon.
- Idempotent: showroom đã có lat/lon (và không truyền --force) sẽ bỏ qua.
- Tuân thủ Nominatim usage policy: User-Agent rõ ràng + sleep ≥ 1s giữa các request mới.

Usage:
    python tools/geocode_dealers.py
    python tools/geocode_dealers.py --force      # geocode lại toàn bộ
    python tools/geocode_dealers.py --limit 5    # test 5 showroom đầu
"""
import argparse
import json
import sys
import time
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = ROOT / "wiki" / "dealers" / "catalog.json"

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search?format=json&q={q}"
USER_AGENT = "thacoauto-lib-geocoder/1.0 (contact: phogotarot@gmail.com)"
SLEEP_SECONDS = 1.1  # Nominatim fair-use: tối đa 1 req/s


def _query_nominatim(q: str) -> dict | None:
    if not q:
        return None
    url = NOMINATIM_URL.format(q=quote(q))
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
    try:
        with urlopen(req, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (URLError, HTTPError, json.JSONDecodeError) as e:
        print(f"    ! lỗi khi gọi Nominatim: {e}")
        return None
    if not isinstance(data, list) or not data:
        return None
    first = data[0]
    try:
        return {
            "lat": float(first["lat"]),
            "lon": float(first["lon"]),
            "display_name": first.get("display_name", ""),
        }
    except (KeyError, ValueError, TypeError):
        return None


import re


def _simplify_address(full: str, address_obj: dict | None = None) -> list[str]:
    """Sinh các biến thể địa chỉ đơn giản hơn để retry khi full address fail.

    Chiến lược (theo thứ tự ưu tiên):
      1. Bỏ tiền tố nhiễu trong street (L1, Tổ XX, Khu phố X, Ấp X, Lô CC3...).
      2. Lấy đơn giản: "<số nhà + đường>, <ward>, <province>".
      3. Chỉ "<đường>, <province>".
    """
    variants: list[str] = []
    parts = [p.strip() for p in full.split(",") if p.strip()]
    if not parts:
        return variants

    street = parts[0]
    # Bỏ các prefix kiểu "L1", "Lô CC3", "Số 7" giữ phần còn lại
    cleaned = re.sub(r"^(L\d+|Lô\s+\S+|Số)\s*[,.]?\s*", "", street, flags=re.IGNORECASE).strip()
    if cleaned and cleaned != street:
        variants.append(", ".join([cleaned] + parts[1:]))

    if address_obj:
        street2 = address_obj.get("street") or street
        # Bỏ luôn các phần "Tổ X", "Khu phố Y", "Ấp Z" trong street nếu xuất hiện
        street2 = re.sub(r",?\s*(Tổ|Khu phố|Ấp|KP)\s+\S+", "", street2, flags=re.IGNORECASE).strip()
        ward = address_obj.get("ward") or ""
        province = address_obj.get("province") or (parts[-1] if len(parts) > 1 else "")
        if street2 and province:
            simple = ", ".join([x for x in [street2, f"Phường {ward}" if ward else "", province] if x])
            if simple not in variants:
                variants.append(simple)

        # Variant tối giản: chỉ tên đường (bỏ số nhà) + ward + province
        m = re.search(r"\b([A-ZĐ][^\d,]+?)$", street2)  # phần chữ ở cuối
        if m and province:
            road_only = m.group(1).strip()
            simple2 = ", ".join([x for x in [road_only, f"Phường {ward}" if ward else "", province] if x])
            if simple2 and simple2 not in variants:
                variants.append(simple2)

    return variants


def geocode(address: str, address_obj: dict | None = None) -> dict | None:
    """Gọi Nominatim với address.full; nếu fail, retry với các biến thể đơn giản hoá."""
    if not address:
        return None

    res = _query_nominatim(address)
    if res:
        return res

    # Retry với các biến thể đơn giản hơn
    for variant in _simplify_address(address, address_obj):
        time.sleep(SLEEP_SECONDS)
        print(f"    ↺ retry với: {variant[:70]}")
        res = _query_nominatim(variant)
        if res:
            res["display_name"] = res["display_name"] + f" [via fallback]"
            return res
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="Geocode lại toàn bộ kể cả đã có lat/lon")
    ap.add_argument("--limit", type=int, default=0, help="Chỉ xử lý N showroom đầu (test)")
    args = ap.parse_args()

    if not CATALOG_PATH.exists():
        print(f"Không tìm thấy {CATALOG_PATH}. Chạy tools/sync_dealers.py trước.")
        sys.exit(1)

    catalog = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    showrooms = catalog.get("showrooms", [])
    if not showrooms:
        print("Catalog rỗng.")
        return

    # Bước 1: gom các địa chỉ duy nhất cần geocode
    address_to_coords: dict[str, dict] = {}  # cache trong run này

    # Nạp coords sẵn có (để dedupe & tránh gọi lại cùng địa chỉ)
    if not args.force:
        for s in showrooms:
            addr = (s.get("address") or {}).get("full", "").strip()
            if not addr:
                continue
            if s.get("lat") is not None and s.get("lon") is not None and addr not in address_to_coords:
                address_to_coords[addr] = {
                    "lat": s["lat"],
                    "lon": s["lon"],
                    "display_name": s.get("geocode_display_name", ""),
                }

    # Tính số showroom phải xử lý
    pending = []
    for s in showrooms:
        addr = (s.get("address") or {}).get("full", "").strip()
        if not addr:
            continue
        if not args.force and s.get("lat") is not None and s.get("lon") is not None:
            continue
        pending.append(s)

    if args.limit > 0:
        pending = pending[: args.limit]

    print(f"Tổng showroom: {len(showrooms)} | cần geocode: {len(pending)}")
    if not pending:
        print("Không có gì để làm. Dùng --force nếu muốn geocode lại.")
        return

    # Bước 2: thực hiện geocode (chỉ gọi mạng cho địa chỉ chưa cache)
    miss_count = 0
    for i, s in enumerate(pending, 1):
        addr = s["address"]["full"].strip()
        if addr in address_to_coords:
            coords = address_to_coords[addr]
            print(f"[{i}/{len(pending)}] (cache) {s.get('title')} ← {addr[:60]}")
        else:
            print(f"[{i}/{len(pending)}] geocode  {s.get('title')} ← {addr[:60]}")
            coords = geocode(addr, s.get("address"))
            time.sleep(SLEEP_SECONDS)
            if coords is None:
                miss_count += 1
                print(f"    ✗ không có kết quả")
                continue
            address_to_coords[addr] = coords

        s["lat"] = coords["lat"]
        s["lon"] = coords["lon"]
        s["geocode_display_name"] = coords["display_name"]

    # Bước 3: cập nhật stat & ghi file
    geocoded = sum(1 for s in showrooms if s.get("lat") is not None)
    catalog["stats"] = catalog.get("stats", {})
    catalog["stats"]["geocoded"] = geocoded
    catalog["stats"]["geocoded_unique_addresses"] = len(
        {s["address"]["full"] for s in showrooms if s.get("lat") is not None}
    )

    CATALOG_PATH.write_text(
        json.dumps(catalog, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    print(f"\nDone. Đã ghi {CATALOG_PATH}")
    print(f"  ~ {geocoded}/{len(showrooms)} showroom có lat/lon")
    print(f"  ~ {len(address_to_coords)} địa chỉ duy nhất đã geocode")
    if miss_count:
        print(f"  ! {miss_count} showroom không tìm thấy toạ độ — kiểm tra lại address.full")


if __name__ == "__main__":
    main()

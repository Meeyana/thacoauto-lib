#!/usr/bin/env python3
"""
watch_all.py — Watcher tổng quản trị mọi sync script.

Theo dõi mọi file JSON trong raw/ và tự động chạy sync script tương ứng
khi phát hiện thay đổi.

Mapping: pattern JSON  ->  script sync
  raw/models/**/*.json           ->  tools/sync_models.py
  raw/*-listshowroom.json        ->  tools/sync_dealers.py
  (mở rộng sau: promotions, services...)

Usage:
    python tools/watch_all.py          # watch liên tục
    python tools/watch_all.py --once   # chạy 1 lần tất cả script rồi thoát
"""
import subprocess
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "raw"
PYTHON = sys.executable

# Mapping: glob pattern -> script tương ứng
WATCHERS = [
    {
        "name": "models",
        "patterns": ["models/**/*.json"],
        "script": ROOT / "tools" / "sync_models.py",
    },
    {
        "name": "dealers",
        "patterns": ["*-listshowroom.json"],
        "script": ROOT / "tools" / "sync_dealers.py",
    },
    # Mở rộng: thêm promotions, services... ở đây
    # {
    #     "name": "promotions",
    #     "patterns": ["promotions/*.json"],
    #     "script": ROOT / "tools" / "sync_promotions.py",
    # },
]


def collect_files(patterns):
    files = {}
    for pat in patterns:
        for f in RAW.glob(pat):
            if f.is_file():
                files[f] = f.stat().st_mtime
    return files


def run_script(script: Path, label: str):
    if not script.exists():
        print(f"  ! Bỏ qua {label}: không tìm thấy {script.name}")
        return
    print(f"\n[{time.strftime('%H:%M:%S')}] ▶ Sync {label} ({script.name})")
    try:
        result = subprocess.run(
            [PYTHON, str(script)],
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        # In gọn output
        out = (result.stdout or "").strip()
        if out:
            for line in out.splitlines():
                print(f"  {line}")
        if result.returncode != 0:
            print(f"  ! Script thoát với code {result.returncode}")
            if result.stderr:
                print(f"  stderr: {result.stderr.strip()[:300]}")
    except Exception as e:
        print(f"  ! LỖI chạy {script.name}: {e}")


def run_all_once():
    print(f"=== Sync tất cả ({len(WATCHERS)} nhóm) ===")
    for w in WATCHERS:
        run_script(w["script"], w["name"])
    print(f"\n=== Done ===")


def watch():
    print(f"👀 Watching raw/ ... (Ctrl+C để dừng)")
    print(f"   Theo dõi {len(WATCHERS)} nhóm: {', '.join(w['name'] for w in WATCHERS)}\n")

    # Sync 1 lần lúc khởi động
    run_all_once()

    # Khởi tạo state
    state = {w["name"]: collect_files(w["patterns"]) for w in WATCHERS}

    try:
        while True:
            time.sleep(2)
            for w in WATCHERS:
                current = collect_files(w["patterns"])
                if current != state[w["name"]]:
                    # Phát hiện thay đổi: file mới, file xoá, hoặc mtime đổi
                    diff_added = set(current) - set(state[w["name"]])
                    diff_removed = set(state[w["name"]]) - set(current)
                    diff_changed = {
                        f for f in current
                        if f in state[w["name"]] and current[f] != state[w["name"]][f]
                    }
                    parts = []
                    if diff_added: parts.append(f"+{len(diff_added)} mới")
                    if diff_removed: parts.append(f"-{len(diff_removed)} xoá")
                    if diff_changed: parts.append(f"~{len(diff_changed)} sửa")
                    print(f"\n📝 [{w['name']}] phát hiện thay đổi: {', '.join(parts)}")
                    run_script(w["script"], w["name"])
                    state[w["name"]] = current
    except KeyboardInterrupt:
        print("\n\n⏹  Stopped.")


if __name__ == "__main__":
    if "--once" in sys.argv:
        run_all_once()
    else:
        watch()

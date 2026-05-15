#!/usr/bin/env python3
"""
watch_all.py — Watcher tổng quản trị mọi sync script.

Theo dõi file nguồn (raw/ và wiki/models/use_case_map.json) và tự động chạy
chuỗi sync script tương ứng khi phát hiện thay đổi.

Mapping (mỗi watcher có thể có `post` — chạy nối tiếp sau script chính):
  raw/models/**/*.json
      -> sync_models.py
      -> merge_use_case.js   (gộp use_case vào catalog)

  raw/*-listshowroom.json
      -> sync_dealers.py
      -> geocode_dealers.py  (parse lat/lon từ map_url + patch MD)

  wiki/models/use_case_map.json
      -> merge_use_case.js   (chỉ merge, không sync lại từ raw)

Usage:
    python tools/watch_all.py          # watch liên tục
    python tools/watch_all.py --once   # chạy 1 lần tất cả script rồi thoát
"""
import shutil
import subprocess
import sys
import time
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = Path(__file__).resolve().parent.parent
PYTHON = sys.executable
NODE = shutil.which("node") or "node"

TOOLS = ROOT / "tools"

# Mỗi watcher:
#   name      : nhãn log
#   base      : thư mục gốc để glob (relative ROOT)
#   patterns  : list glob
#   script    : script chính (Path)
#   post      : list script chạy nối tiếp sau script chính (có thể rỗng)
WATCHERS = [
    {
        "name": "models",
        "base": ROOT / "raw",
        "patterns": ["models/**/*.json"],
        "script": TOOLS / "sync_models.py",
        "post": [TOOLS / "merge_use_case.js"],
    },
    {
        "name": "use_case_map",
        "base": ROOT / "wiki",
        "patterns": ["models/use_case_map.json"],
        "script": TOOLS / "merge_use_case.js",
        "post": [],
    },
    {
        "name": "dealers",
        "base": ROOT / "raw",
        "patterns": ["*-listshowroom.json"],
        "script": TOOLS / "sync_dealers.py",
        "post": [TOOLS / "geocode_dealers.py"],
    },
]


def collect_files(base: Path, patterns):
    files = {}
    for pat in patterns:
        for f in base.glob(pat):
            if f.is_file():
                files[f] = f.stat().st_mtime
    return files


def run_script(script: Path, label: str):
    if not script.exists():
        print(f"  ! Bỏ qua {label}: không tìm thấy {script.name}")
        return
    suffix = script.suffix.lower()
    if suffix == ".py":
        cmd = [PYTHON, str(script)]
    elif suffix == ".js":
        cmd = [NODE, str(script)]
    else:
        print(f"  ! Bỏ qua {label}: không hỗ trợ extension {suffix}")
        return

    print(f"\n[{time.strftime('%H:%M:%S')}] ▶ {label} ({script.name})")
    try:
        result = subprocess.run(
            cmd,
            cwd=str(ROOT),
            capture_output=True,
            text=True,
            encoding="utf-8",
        )
        out = (result.stdout or "").strip()
        if out:
            for line in out.splitlines():
                print(f"  {line}")
        if result.returncode != 0:
            print(f"  ! Script thoát với code {result.returncode}")
            if result.stderr:
                print(f"  stderr: {result.stderr.strip()[:500]}")
    except Exception as e:
        print(f"  ! LỖI chạy {script.name}: {e}")


def run_watcher(w):
    """Chạy script chính + post chain."""
    run_script(w["script"], w["name"])
    for post in w.get("post", []):
        run_script(post, f"{w['name']}/post:{post.stem}")


def run_all_once():
    print(f"=== Sync tất cả ({len(WATCHERS)} nhóm) ===")
    for w in WATCHERS:
        run_watcher(w)
    print(f"\n=== Done ===")


def watch():
    print(f"👀 Watching ... (Ctrl+C để dừng)")
    print(f"   Theo dõi {len(WATCHERS)} nhóm: {', '.join(w['name'] for w in WATCHERS)}\n")

    # Sync 1 lần lúc khởi động
    run_all_once()

    # Khởi tạo state
    state = {w["name"]: collect_files(w["base"], w["patterns"]) for w in WATCHERS}

    try:
        while True:
            time.sleep(2)
            for w in WATCHERS:
                current = collect_files(w["base"], w["patterns"])
                if current != state[w["name"]]:
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
                    run_watcher(w)
                    state[w["name"]] = current
    except KeyboardInterrupt:
        print("\n\n⏹  Stopped.")


if __name__ == "__main__":
    if "--once" in sys.argv:
        run_all_once()
    else:
        watch()

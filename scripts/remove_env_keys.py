"""Removes specific KEY=... lines from .env by key name only -- never reads
or prints the values, so it's safe to use on a file holding live secrets.

Run with: venv/Scripts/python scripts/remove_env_keys.py KEY_ONE KEY_TWO ...
"""

import sys
from pathlib import Path

ENV_PATH = Path(__file__).resolve().parent.parent / ".env"


def main():
    keys_to_remove = set(sys.argv[1:])
    if not keys_to_remove:
        print("Usage: remove_env_keys.py KEY_ONE KEY_TWO ...")
        sys.exit(1)

    lines = ENV_PATH.read_text().splitlines(keepends=True)
    kept = []
    removed = []

    for line in lines:
        stripped = line.strip()
        key = stripped.split("=", 1)[0] if "=" in stripped else None
        if key in keys_to_remove:
            removed.append(key)
        else:
            kept.append(line)

    ENV_PATH.write_text("".join(kept))
    print(f"Removed: {removed}")
    print(f"Kept {len(kept)} lines.")


if __name__ == "__main__":
    main()

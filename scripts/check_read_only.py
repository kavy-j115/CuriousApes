"""Static check of the house rule: Meta and Shopify are read-only for us.

Fails (exit 1) if the code contains:
  - a GraphQL mutation,
  - PUT / PATCH / DELETE requests,
  - a POST to a Meta or Shopify host outside the short, explicit allowlist below.

Run with: venv/Scripts/python scripts/check_read_only.py
Safe to run any time: it only reads source files.
"""

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Files that may POST to Meta/Shopify, and why:
ALLOWED_POST = {
    "src/connectors/shopify.py": "GraphQL QUERIES (reads) + the bulk order export (bulkOperationRunQuery, the only mutation readonly.py lets through)",
    "src/connectors/shopify_token.py": "OAuth refresh-token exchange for a public app (keeps our read access alive)",
    "src/notifications/whatsapp.py": "sending WhatsApp messages (the delivery channel)",
    "web/src/lib/whatsappBot.ts": "replying to WhatsApp messages (the delivery channel)",
    "web/src/app/api/shopify/callback/route.ts": "OAuth code -> read-access token exchange for an install",
}

# Checked in every file.
CHECKS = [
    (re.compile(r"\bmutation\b", re.I), "GraphQL mutation"),
    (re.compile(r"subscribed_apps"), "Meta write-style endpoint (app subscription)"),
]
# Checked only in files that talk to Meta or Shopify (our own database and storage
# may of course use PUT / DELETE).
PLATFORM_CHECKS = [
    (re.compile(r"requests\.(put|patch|delete)\("), "PUT/PATCH/DELETE request"),
    (re.compile(r"method:\s*[\"'](PUT|PATCH|DELETE)[\"']"), "PUT/PATCH/DELETE fetch"),
]


def tracked_sources() -> list[str]:
    out = subprocess.run(["git", "ls-files", "src", "scripts", "web/src"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [p for p in out.splitlines() if p.endswith((".py", ".ts", ".tsx")) and p != "scripts/check_read_only.py"]


def main() -> int:
    problems: list[str] = []
    for rel in tracked_sources():
        path = ROOT / rel
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="replace")
        if rel == "src/connectors/readonly.py":
            continue
        talks_to_platform = "graph.facebook.com" in text or "myshopify.com" in text or "/admin/api/" in text
        checks = CHECKS + (PLATFORM_CHECKS if talks_to_platform else [])
        for line_no, line in enumerate(text.splitlines(), 1):
            stripped = line.strip()
            if stripped.startswith(("#", "//", "*")):
                continue
            if rel == "src/connectors/shopify.py" and stripped == "mutation($q: String!) {":
                continue  # the one approved call: Shopify's bulk order EXPORT (read-only in effect)
            for pattern, label in checks:
                if pattern.search(line):
                    problems.append(f"{rel}:{line_no}: {label}: {stripped[:100]}")
        # POSTs to Meta/Shopify hosts outside the allowlist
        posts = re.search(r"requests\.post\(|method:\s*[\"']POST[\"']", text)
        if talks_to_platform and posts and rel not in ALLOWED_POST:
            problems.append(f"{rel}: POST in a file that talks to Meta/Shopify (not on the allowlist)")

    if problems:
        print("Read-only rule broken:\n  " + "\n  ".join(problems))
        return 1
    print("OK: no writes to Meta or Shopify found. Allowed non-read calls:")
    for rel, why in ALLOWED_POST.items():
        print(f"  {rel}: {why}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

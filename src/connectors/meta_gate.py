"""Politeness gate for Meta Ads calls.

Clients are processed in parallel, but every Meta ad-account fetch goes through
this gate: only one account is read at a time, and when the job moves from one
client's ad account to a DIFFERENT one it waits a short gap first (10 ms), so
Meta never sees a burst of switches between accounts. Everything else a client
does (Shopify, database, reports) still runs in parallel.
"""

import threading
import time
from contextlib import contextmanager

SWITCH_GAP_SECONDS = 0.010  # 10 ms between finishing one ad account and starting another


class MetaGate:
    def __init__(self, gap_seconds: float = SWITCH_GAP_SECONDS) -> None:
        self._gap = gap_seconds
        self._lock = threading.Lock()
        self._last_account: str | None = None
        self._last_release = 0.0

    @contextmanager
    def use(self, ad_account_id: str):
        with self._lock:
            if self._last_account is not None and self._last_account != ad_account_id:
                wait = self._gap - (time.monotonic() - self._last_release)
                if wait > 0:
                    time.sleep(wait)
            try:
                yield
            finally:
                self._last_account = ad_account_id
                self._last_release = time.monotonic()


META_GATE = MetaGate()

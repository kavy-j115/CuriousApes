"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { listNotifications, markAllNotificationsRead, markNotificationRead, type NotificationRow } from "../tasks/actions";

function ago(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

// The bell in the top bar: unread count plus the latest notifications (new tasks for
// the user's clients). Loaded after the page has drawn, then refreshed every minute and
// whenever the list is opened, so it never slows a page down.
export default function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<NotificationRow[]>([]);
  const rootRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await listNotifications();
      setUnread(r.unread);
      setItems(r.items);
    } catch {
      /* keep what is shown */
    }
  }, []);

  useEffect(() => {
    const first = setTimeout(load, 500);
    const id = setInterval(load, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  async function openItem(n: NotificationRow) {
    setOpen(false);
    if (!n.read_at) {
      setItems((list) => list.map((x) => (x.id === n.id ? { ...x, read_at: new Date().toISOString() } : x)));
      setUnread((c) => Math.max(0, c - 1));
      void markNotificationRead(n.id);
    }
    if (n.link) router.push(n.link);
  }

  async function readAll() {
    setItems((list) => list.map((x) => ({ ...x, read_at: x.read_at ?? new Date().toISOString() })));
    setUnread(0);
    await markAllNotificationsRead();
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void load();
        }}
        aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"}
        className="relative rounded-md p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
      >
        <Bell size={18} />
        {unread > 0 && (
          <span className="absolute right-0.5 top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-lg border border-zinc-800 bg-zinc-950 shadow-xl">
          <div className="flex items-center justify-between border-b border-zinc-900 px-3 py-2">
            <p className="text-sm font-semibold text-zinc-100">Notifications</p>
            {unread > 0 && (
              <button onClick={readAll} className="text-xs text-accent hover:underline">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto scrollbar-thin">
            {items.length === 0 && <p className="px-3 py-6 text-center text-sm text-zinc-500">Nothing new.</p>}
            {items.map((n) => (
              <button
                key={n.id}
                onClick={() => openItem(n)}
                className={`flex w-full flex-col gap-0.5 border-b border-zinc-900 px-3 py-2.5 text-left hover:bg-zinc-900 ${n.read_at ? "opacity-60" : ""}`}
              >
                <span className="flex items-center gap-2 text-sm font-medium text-zinc-100">
                  {!n.read_at && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
                  <span className="truncate">{n.title}</span>
                </span>
                {n.body && <span className="text-xs text-zinc-400">{n.body}</span>}
                <span className="text-[11px] text-zinc-500">{ago(n.created_at)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

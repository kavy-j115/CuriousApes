"use client";

// claude.ai sends X-Frame-Options: SAMEORIGIN (confirmed directly, not
// assumed), which blocks it from ever rendering inside an <iframe> on this
// site. A popup window isn't affected by that restriction -- it only
// blocks embedding, not opening a separate window -- so that's what this
// does instead of a broken iframe.
function openAssistant() {
  window.open(
    "https://claude.ai",
    "ai_assistant",
    "width=420,height=680,resizable=yes,scrollbars=yes"
  );
}

export default function AIAssistantButton() {
  return (
    <button
      onClick={openAssistant}
      className="fixed bottom-5 right-5 z-50 rounded-full bg-[#4472C4] px-4 py-2 text-sm font-medium text-white shadow-lg hover:bg-[#375aa0]"
    >
      Ask AI
    </button>
  );
}

// Split out from selectedClient.ts so the client-side ClientDropdown can
// import just the cookie name without pulling in next/headers (server-only).
export const SELECTED_CLIENT_COOKIE = "selected_client";

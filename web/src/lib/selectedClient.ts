import { cookies } from "next/headers";
import { SELECTED_CLIENT_COOKIE } from "./selectedClientCookie";

// A deep link's own ?client= always wins (so shared links keep working);
// otherwise fall back to the last client picked via ClientDropdown (the
// cookie it sets), which is what survives sidebar navigation -- sidebar
// links don't carry ?client=, so without this every page fell back to
// "alphabetically first" on every click.
export async function resolveSelectedClient(
  queryParam: string | undefined,
  clients: { client_id: string }[]
): Promise<string> {
  if (queryParam) return queryParam;

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(SELECTED_CLIENT_COOKIE)?.value;
  if (cookieValue && clients.some((c) => c.client_id === cookieValue)) {
    return cookieValue;
  }

  return clients[0]?.client_id ?? "";
}

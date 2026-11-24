// The functions people in the agency work in. Stored as plain text on user_profiles.team and
// tasks.team (no database constraint), so adding a new kind of specialist means adding one
// line here -- no migration.
export const TEAMS = [
  { key: "marketing", label: "Performance marketing" },
  { key: "smm", label: "Social media" },
  { key: "graphics", label: "Graphic design" },
  { key: "video", label: "Video editing" },
] as const;

export type TeamKey = (typeof TEAMS)[number]["key"];

export const TEAM_LABEL: Record<string, string> = Object.fromEntries(TEAMS.map((t) => [t.key, t.label]));

export function isTeam(value: unknown): value is TeamKey {
  return typeof value === "string" && TEAMS.some((t) => t.key === value);
}

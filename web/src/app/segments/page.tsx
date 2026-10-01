import { redirect } from "next/navigation";

export default function LegacySegmentsPage() {
  redirect("/dashboard/segments");
}

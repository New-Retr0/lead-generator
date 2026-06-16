import { redirect } from "next/navigation";

export default function TriageRedirectPage() {
  redirect("/workspace?tab=triage");
}

import { redirect } from "next/navigation";

export default function DudsRedirectPage() {
  redirect("/workspace?tab=triage");
}

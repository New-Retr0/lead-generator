import { redirect } from "next/navigation";

export default function DudsRedirect() {
  redirect("/data?tab=triage");
}

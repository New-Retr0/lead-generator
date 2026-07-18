import { redirect } from "next/navigation";

export default function RequestsPage() {
  redirect("/launch?mode=request");
}

import { redirect } from "next/navigation";

export default function CampaignsPage() {
  redirect("/launch?mode=campaign");
}

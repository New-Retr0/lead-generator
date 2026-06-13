import type { IconType } from "react-icons";
import {
  FaFacebook,
  FaInstagram,
  FaLinkedin,
  FaXTwitter,
  FaYoutube,
} from "react-icons/fa6";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";

const PLATFORM_ICONS: Record<string, IconType> = {
  facebook: FaFacebook,
  instagram: FaInstagram,
  linkedin: FaLinkedin,
  youtube: FaYoutube,
  x: FaXTwitter,
  twitter: FaXTwitter,
};

export function socialPlatformLabel(platform: string): string {
  const key = platform.trim().toLowerCase();
  if (key === "x" || key === "twitter") return "X";
  if (!key) return "Social";
  return key.charAt(0).toUpperCase() + key.slice(1);
}

export function SocialIcon({
  platform,
  className,
}: {
  platform: string;
  className?: string;
}) {
  const key = platform.trim().toLowerCase();
  const Icon = PLATFORM_ICONS[key] ?? Globe;
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden />;
}

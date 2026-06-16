import type { Metadata } from "next";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_top,_oklch(0.55_0.18_262/0.12),_transparent_55%)]"
        aria-hidden
      />
      <SignInForm />
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Admin-provisioned accounts only · Central Valley exterior cleaning leads
      </p>
    </div>
  );
}

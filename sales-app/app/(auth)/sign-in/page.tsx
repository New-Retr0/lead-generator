import type { Metadata } from "next";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default function SignInPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      <SignInForm />
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Admin-provisioned accounts only · Central Valley exterior cleaning leads
      </p>
    </div>
  );
}

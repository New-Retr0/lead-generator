import type { Metadata } from "next";
import { SignInForm } from "@/components/sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

type SignInSearchParams = {
  error?: string | string[];
};

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<SignInSearchParams>;
}) {
  const params = await searchParams;
  const initialError =
    firstParam(params.error) === "auth"
      ? "That sign-in link expired or was opened in a different app. Request a new link and open it in your browser."
      : null;

  return (
    <div className="flex min-h-svh flex-col items-center justify-center px-4 py-[calc(2rem+env(safe-area-inset-top))] pb-[calc(2rem+env(safe-area-inset-bottom))]">
      <SignInForm initialError={initialError} />
      <p className="mt-8 text-center text-xs text-muted-foreground">
        Admin-provisioned accounts only · Central Valley exterior cleaning leads
      </p>
    </div>
  );
}

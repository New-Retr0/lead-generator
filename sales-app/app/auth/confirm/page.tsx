"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type OtpType =
  | "email"
  | "signup"
  | "invite"
  | "recovery"
  | "email_change"
  | "magiclink";

export default function AuthConfirmPage() {
  const router = useRouter();
  const [message, setMessage] = useState("Completing sign-in…");

  useEffect(() => {
    let cancelled = false;

    async function confirm() {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type");

      try {
        if (tokenHash && type) {
          const otpType = type as OtpType;
          let { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: otpType,
          });
          // Some links use type=magiclink; retry as email if needed.
          if (error && otpType === "magiclink") {
            ({ error } = await supabase.auth.verifyOtp({
              token_hash: tokenHash,
              type: "email",
            }));
          }
          if (error) throw error;
        } else if (code) {
          // PKCE — requires the same browser that requested the link.
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else {
          // Implicit / hash fallback (detectSessionInUrl).
          const {
            data: { session },
            error,
          } = await supabase.auth.getSession();
          if (error) throw error;
          if (!session) throw new Error("Missing auth parameters in sign-in link.");
        }

        if (cancelled) return;
        window.location.href = "/crm";
      } catch {
        if (cancelled) return;
        setMessage("Sign-in link expired or invalid. Request a new magic link.");
        router.replace("/sign-in?error=auth");
      }
    }

    void confirm();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}

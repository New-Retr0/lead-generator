"use client";

import { useState } from "react";
import { Droplets } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

function friendlyAuthError(message: string): string {
  if (/signup|not allowed|user not found|invalid login/i.test(message)) {
    return "This email isn't registered yet. Ask your admin to add your account in Supabase.";
  }
  return message;
}

export function SignInForm() {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<"email" | "sent">("email");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const normalized = email.trim().toLowerCase();
    const { error: err } = await supabase.auth.signInWithOtp({
      email: normalized,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: `${window.location.origin}/auth/confirm`,
      },
    });
    setLoading(false);
    if (err) {
      setError(friendlyAuthError(err.message));
      return;
    }
    setPhase("sent");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const normalized = email.trim().toLowerCase();
    const { error: err } = await supabase.auth.verifyOtp({
      email: normalized,
      token: code.trim(),
      type: "email",
    });
    setLoading(false);
    if (err) {
      setError(friendlyAuthError(err.message));
      return;
    }
    window.location.href = "/crm";
  }

  return (
    <Card className="w-full max-w-md border-border/60 bg-card/80 shadow-xl backdrop-blur-sm">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.55_0.16_300)] text-primary-foreground shadow-lg">
          <Droplets className="size-6" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-2xl tracking-tight">PALLARES Sales</CardTitle>
          <CardDescription>
            Registered reps only — enter your email for a magic link or 6-digit code.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {phase === "email" && (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <Input
              type="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="h-11"
            />
            <Button type="submit" className="h-11 w-full" disabled={loading}>
              {loading ? "Sending…" : "Send magic link"}
            </Button>
          </form>
        )}
        {phase === "sent" && (
          <p className="text-center text-sm text-muted-foreground">
            Check your email for the sign-in link. You can close this tab after clicking it,
            or enter the 6-digit code below.
          </p>
        )}
        {phase === "sent" && (
          <form onSubmit={verifyCode} className="space-y-3">
            <Input
              inputMode="numeric"
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              className="h-11 text-center text-lg tracking-[0.3em]"
            />
            <Button type="submit" variant="secondary" className="h-11 w-full" disabled={loading}>
              {loading ? "Verifying…" : "Verify code"}
            </Button>
          </form>
        )}
        {phase === "sent" && (
          <button
            type="button"
            className="mx-auto block text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={() => {
              setPhase("email");
              setCode("");
              setError(null);
            }}
          >
            Use a different email
          </button>
        )}
        {error && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-center text-sm text-destructive">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

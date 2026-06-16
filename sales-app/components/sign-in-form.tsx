"use client";

import { useEffect, useState } from "react";
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
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("error") === "auth") {
      const timeout = window.setTimeout(() => {
        setError(
          "That sign-in link expired or was opened in a different app. Request a new link and open it in your browser.",
        );
      }, 0);
      return () => window.clearTimeout(timeout);
    }
  }, []);

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
    setSent(true);
  }

  return (
    <Card className="w-full max-w-md shadow-lg">
      <CardHeader className="space-y-3 text-center">
        <div className="mx-auto flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-[oklch(0.55_0.16_300)] text-primary-foreground shadow-lg">
          <Droplets className="size-6" />
        </div>
        <div className="space-y-1">
          <CardTitle className="text-2xl tracking-tight">PALLARES Sales</CardTitle>
          <CardDescription>
            Registered reps only — enter your email and we&apos;ll send a sign-in link.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {!sent ? (
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
        ) : (
          <>
            <p className="text-center text-sm text-muted-foreground">
              Check your email and click the sign-in link on this device. If the link
              opens in a different app, use &quot;Open in browser&quot; (Safari/Chrome).
            </p>
            <button
              type="button"
              className="mx-auto block text-sm text-muted-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setSent(false);
                setError(null);
              }}
            >
              Use a different email
            </button>
          </>
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

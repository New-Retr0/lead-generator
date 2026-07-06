"use client";

import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";

type PartnerKeyRow = {
  id: string;
  key_prefix: string;
  partner_name: string;
  active: boolean;
  rate_limit_per_minute: number;
  daily_row_limit: number;
  created_at: string;
  last_used_at: string | null;
};

export function PartnerKeyAdminPanel() {
  const [keys, setKeys] = useState<PartnerKeyRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [partnerName, setPartnerName] = useState("Ben / Pallares");
  const [createdKey, setCreatedKey] = useState<string | null>(null);

  const loadKeys = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/partner-keys", { cache: "no-store" });
      const body = (await res.json()) as { keys?: PartnerKeyRow[]; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to load keys");
      setKeys(body.keys ?? []);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load partner keys");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initial admin key fetch
    void loadKeys();
  }, [loadKeys]);

  async function createKey() {
    try {
      const res = await fetch("/api/admin/partner-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partner_name: partnerName,
          deactivate_existing: false,
        }),
      });
      const body = (await res.json()) as { api_key?: string; error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to create key");
      setCreatedKey(body.api_key ?? null);
      toast.success("Partner API key created");
      await loadKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create key");
    }
  }

  async function revokeKey(id: string) {
    try {
      const res = await fetch(`/api/admin/partner-keys/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: false }),
      });
      const body = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "Failed to revoke key");
      toast.success("Key revoked");
      await loadKeys();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to revoke key");
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <KeyRound className="size-4 text-muted-foreground" />
          Partner key management
        </CardTitle>
        <CardDescription>
          Admin-only. Keys are hashed at rest; plaintext is shown once on create.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div className="space-y-2">
            <Label htmlFor="partner-name">Partner label</Label>
            <Input
              id="partner-name"
              value={partnerName}
              onChange={(e) => setPartnerName(e.target.value)}
            />
          </div>
          <Button type="button" onClick={() => void createKey()}>
            <Plus className="size-4" />
            Create key
          </Button>
        </div>

        {createdKey ? (
          <div className="rounded-lg border border-warning/40 bg-warning/10 p-3 text-sm">
            <p className="font-medium text-warning">Copy this key now — it will not be shown again.</p>
            <code className="mt-2 block break-all text-xs">{createdKey}</code>
          </div>
        ) : null}

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading keys…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No partner keys yet.</p>
        ) : (
          <ul className="space-y-2">
            {keys.map((key) => (
              <li
                key={key.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border/50 px-3 py-2 text-sm"
              >
                <div>
                  <p className="font-medium">{key.partner_name}</p>
                  <p className="font-mono text-xs text-muted-foreground">{key.key_prefix}…</p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={key.active ? "success" : "secondary"}>
                    {key.active ? "active" : "revoked"}
                  </Badge>
                  {key.active ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void revokeKey(key.id)}
                    >
                      <ShieldOff className="size-3.5" />
                      Revoke
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

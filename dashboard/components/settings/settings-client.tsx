"use client";

import CodeMirror from "@uiw/react-codemirror";
import { yaml } from "@codemirror/lang-yaml";
import { Eye, EyeOff, Loader2, RotateCcw, Save } from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import YAML from "yaml";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const GROUP_ORDER = [
  "Credentials",
  "Supabase",
  "Discovery",
  "Firecrawl",
  "AI Gateway",
  "Owner Chain",
  "Caching & Archive",
  "Scoring",
  "Paths",
] as const;

type SchemaProperty = {
  type?: string | string[];
  group?: string;
  secret?: boolean;
  readonly?: boolean;
  help?: string;
  title?: string;
  default?: unknown;
};

type FieldValue =
  | { value: string | number | boolean; default: unknown; modified: boolean; env_key: string; readonly?: boolean }
  | { masked: string; is_set: boolean; modified: boolean; env_key: string; readonly?: boolean };

import type { SettingsSchemaPayload } from "@/lib/settings-server";

type ConfigFileSummary = {
  name: string;
  size: number;
  mtime: string;
  description: string;
  warnManualEdit: boolean;
};

type ConfigFileDetail = ConfigFileSummary & {
  content: string;
  warning: string | null;
};

function fieldTitle(name: string, prop?: SchemaProperty): string {
  if (prop?.title) {
    return prop.title;
  }
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function isSecretField(name: string, prop: SchemaProperty | undefined, payload: SettingsSchemaPayload): boolean {
  return Boolean(prop?.secret || payload.secret_fields?.includes(name));
}

function resolvedType(prop: SchemaProperty | undefined): string {
  const t = prop?.type;
  if (Array.isArray(t)) {
    return t.find((x) => x !== "null") ?? "string";
  }
  return t ?? "string";
}

function formatDefault(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "(empty)";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function SettingsClient({
  initialSettings,
  initialFiles,
  initialError,
  initialConfigName,
  initialConfigContent,
}: {
  initialSettings: SettingsSchemaPayload | null;
  initialFiles: ConfigFileSummary[];
  initialError: string | null;
  initialConfigName: string | null;
  initialConfigContent: string;
}) {
  const [payload, setPayload] = useState<SettingsSchemaPayload | null>(initialSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [restartRequired, setRestartRequired] = useState<string[]>([]);

  const [configFiles] = useState<ConfigFileSummary[]>(initialFiles);
  const [selectedFile, setSelectedFile] = useState<string | null>(initialConfigName);
  const [fileContent, setFileContent] = useState(initialConfigContent);
  const [savedContent, setSavedContent] = useState(initialConfigContent);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [yamlError, setYamlError] = useState<{ line: number; message: string } | null>(null);
  const [pendingFileSwitch, setPendingFileSwitch] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings");
      const data = (await res.json()) as SettingsSchemaPayload & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load settings");
      }
      setPayload(data);
      setEdits({});
      setCleared(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConfigFile = useCallback(async (name: string) => {
    setFileLoading(true);
    setYamlError(null);
    try {
      const res = await fetch(`/api/config-files/${encodeURIComponent(name)}`);
      const data = (await res.json()) as ConfigFileDetail & { error?: string };
      if (!res.ok) {
        throw new Error(data.error ?? "Failed to load file");
      }
      setFileContent(data.content);
      setSavedContent(data.content);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load file");
    } finally {
      setFileLoading(false);
    }
  }, []);

  const groupedFields = useMemo(() => {
    if (!payload?.schema.properties) {
      return [];
    }
    const groups = new Map<string, string[]>();
    for (const [name, prop] of Object.entries(payload.schema.properties)) {
      const group = prop.group ?? "Other";
      const list = groups.get(group) ?? [];
      list.push(name);
      groups.set(group, list);
    }
    return GROUP_ORDER.filter((g) => groups.has(g)).map((group) => ({
      group,
      fields: (groups.get(group) ?? []).sort(),
    }));
  }, [payload]);

  const dirtyFields = useMemo(() => {
    const dirty = new Set<string>();
    for (const name of cleared) {
      dirty.add(name);
    }
    for (const [name, value] of Object.entries(edits)) {
      if (value.trim() !== "") {
        dirty.add(name);
      }
    }
    return dirty;
  }, [cleared, edits]);

  const configDirty = selectedFile !== null && fileContent !== savedContent;

  function setFieldEdit(name: string, value: string) {
    setEdits((prev) => ({ ...prev, [name]: value }));
    setCleared((prev) => {
      if (!prev.has(name)) {
        return prev;
      }
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function resetField(name: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setCleared((prev) => new Set(prev).add(name));
  }

  async function saveSettings() {
    if (!payload || dirtyFields.size === 0) {
      return;
    }
    setSaving(true);
    try {
      const updates: Record<string, string | number | boolean | null> = {};
      for (const name of dirtyFields) {
        if (cleared.has(name)) {
          updates[name] = null;
          continue;
        }
        const prop = payload.schema.properties?.[name];
        const type = resolvedType(prop);
        const raw = edits[name] ?? "";
        if (type === "boolean") {
          updates[name] = raw === "true";
        } else if (type === "integer") {
          updates[name] = parseInt(raw, 10);
        } else if (type === "number") {
          updates[name] = parseFloat(raw);
        } else {
          updates[name] = raw;
        }
      }

      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ updates }),
      });
      const data = (await res.json()) as SettingsSchemaPayload & {
        error?: string;
        restartRequired?: string[];
        ok?: boolean;
      };
      if (!res.ok) {
        throw new Error(data.error ?? "Save failed");
      }
      if (data.schema && data.values) {
        setPayload(data);
      } else {
        await loadSettings();
      }
      setEdits({});
      setCleared(new Set());
      setRestartRequired(data.restartRequired ?? []);
      toast.success("Settings saved to .env");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  function validateYamlLocally(): boolean {
    try {
      YAML.parse(fileContent);
      setYamlError(null);
      toast.success("YAML is valid");
      return true;
    } catch (err) {
      if (err instanceof YAML.YAMLParseError) {
        setYamlError({
          line: err.linePos?.[0]?.line ?? 1,
          message: err.message,
        });
      } else {
        setYamlError({ line: 1, message: err instanceof Error ? err.message : "Invalid YAML" });
      }
      return false;
    }
  }

  async function saveConfigFile() {
    if (!selectedFile) {
      return;
    }
    if (!validateYamlLocally()) {
      return;
    }
    setFileSaving(true);
    try {
      const res = await fetch(`/api/config-files/${encodeURIComponent(selectedFile)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: fileContent }),
      });
      const data = (await res.json()) as { error?: string; line?: number; message?: string };
      if (res.status === 422) {
        setYamlError({ line: data.line ?? 1, message: data.message ?? data.error ?? "Invalid YAML" });
        return;
      }
      if (!res.ok) {
        throw new Error(data.error ?? "Save failed");
      }
      setSavedContent(fileContent);
      setYamlError(null);
      toast.success(`${selectedFile} saved`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setFileSaving(false);
    }
  }

  function requestFileSwitch(name: string) {
    if (configDirty && name !== selectedFile) {
      setPendingFileSwitch(name);
      return;
    }
    setPendingFileSwitch(null);
    setSelectedFile(name);
    void loadConfigFile(name);
  }

  function renderField(name: string) {
    if (!payload) {
      return null;
    }
    const prop = payload.schema.properties?.[name];
    const meta = payload.values[name] as FieldValue | undefined;
    if (!meta) {
      return null;
    }

    const readonly = Boolean(prop?.readonly || meta.readonly);
    const secret = isSecretField(name, prop, payload);
    const type = resolvedType(prop);
    const modified = meta.modified || cleared.has(name) || edits[name] !== undefined;

    if (readonly) {
      const display =
        "value" in meta ? formatDefault(meta.value) : meta.is_set ? meta.masked : "(empty)";
      return (
        <div key={name} className="space-y-1 rounded-lg border border-border/40 bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-sm font-medium">{fieldTitle(name, prop)}</Label>
            <code className="text-[10px] text-muted-foreground">{meta.env_key}</code>
          </div>
          <p className="font-mono text-xs text-muted-foreground break-all">{display}</p>
          {prop?.help ? <p className="text-xs text-muted-foreground/80">{prop.help}</p> : null}
        </div>
      );
    }

    if (type === "boolean") {
      const current = cleared.has(name)
        ? false
        : edits[name] !== undefined
          ? edits[name] === "true"
          : "value" in meta
            ? Boolean(meta.value)
            : false;
      return (
        <div key={name} className="flex items-center justify-between gap-4 rounded-lg border border-border/40 p-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor={name}>{fieldTitle(name, prop)}</Label>
              {modified ? <Badge variant="secondary">modified</Badge> : null}
            </div>
            <code className="text-[10px] text-muted-foreground">{meta.env_key}</code>
            {prop?.help ? <p className="text-xs text-muted-foreground/80">{prop.help}</p> : null}
            <p className="text-xs text-muted-foreground">Default: {formatDefault(prop?.default)}</p>
          </div>
          <Switch
            id={name}
            checked={current}
            onCheckedChange={(checked) => setFieldEdit(name, checked ? "true" : "false")}
          />
        </div>
      );
    }

    const inputType = type === "integer" || type === "number" ? "number" : secret && !revealed.has(name) ? "password" : "text";
    const placeholder =
      secret && "masked" in meta
        ? meta.is_set
          ? meta.masked
          : "(not set)"
        : "value" in meta
          ? formatDefault(meta.value)
          : "";
    const inputValue = edits[name] ?? "";

    return (
      <div key={name} className="space-y-2 rounded-lg border border-border/40 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={name}>{fieldTitle(name, prop)}</Label>
            {modified ? <Badge variant="secondary">modified</Badge> : null}
          </div>
          <div className="flex items-center gap-2">
            {modified ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => resetField(name)}>
                <RotateCcw className="size-3.5" />
                Reset
              </Button>
            ) : null}
            {secret ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() =>
                  setRevealed((prev) => {
                    const next = new Set(prev);
                    if (next.has(name)) {
                      next.delete(name);
                    } else {
                      next.add(name);
                    }
                    return next;
                  })
                }
              >
                {revealed.has(name) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </Button>
            ) : null}
          </div>
        </div>
        <code className="text-[10px] text-muted-foreground">{meta.env_key}</code>
        {prop?.help ? <p className="text-xs text-muted-foreground/80">{prop.help}</p> : null}
        <p className="text-xs text-muted-foreground">
          Default: {formatDefault(prop?.default ?? ("default" in meta ? meta.default : ""))}
        </p>
        <Input
          id={name}
          type={inputType}
          value={inputValue}
          placeholder={placeholder}
          onChange={(e) => setFieldEdit(name, e.target.value)}
        />
      </div>
    );
  }

  if (loading && !payload) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        Loading settings…
      </div>
    );
  }

  if (error || !payload) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Settings unavailable</CardTitle>
          <CardDescription>{error ?? "Could not load settings schema"}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button onClick={() => void loadSettings()}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {restartRequired.length > 0 ? (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            Restart the dashboard dev server to apply: {restartRequired.join(", ")}
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="pipeline">
        <TabsList>
          <TabsTrigger value="pipeline">Pipeline settings</TabsTrigger>
          <TabsTrigger value="config">Config files</TabsTrigger>
        </TabsList>

        <TabsContent value="pipeline" className="space-y-4 pt-4">
          {groupedFields.map(({ group, fields }) => (
            <Card key={group}>
              <CardHeader>
                <CardTitle className="text-base">{group}</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2">{fields.map(renderField)}</CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="config" className="pt-4">
          <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">YAML files</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 p-2">
                {configFiles.map((file) => (
                  <button
                    key={file.name}
                    type="button"
                    onClick={() => requestFileSwitch(file.name)}
                    className={`w-full rounded-md px-2 py-2 text-left text-sm transition-colors ${
                      selectedFile === file.name
                        ? "bg-primary/10 text-foreground"
                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    }`}
                  >
                    <div className="font-mono text-xs">{file.name}</div>
                    <div className="mt-0.5 text-[11px] leading-snug">{file.description}</div>
                  </button>
                ))}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
                <div>
                  <CardTitle className="font-mono text-sm">{selectedFile ?? "Select a file"}</CardTitle>
                  {selectedFile && configFiles.find((f) => f.name === selectedFile)?.warnManualEdit ? (
                    <CardDescription className="text-amber-600 dark:text-amber-400">
                      Normally written by insights --fit-score. Manual edits may be overwritten.
                    </CardDescription>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={validateYamlLocally}>
                    Validate
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!configDirty || fileSaving || !selectedFile}
                    onClick={() => void saveConfigFile()}
                  >
                    {fileSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {yamlError ? (
                  <p className="text-sm text-destructive">
                    Line {yamlError.line}: {yamlError.message}
                  </p>
                ) : null}
                {fileLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading file…
                  </div>
                ) : (
                  <div className="overflow-hidden rounded-md border">
                    <CodeMirror
                      value={fileContent}
                      height="520px"
                      extensions={[yaml()]}
                      onChange={(value) => {
                        setFileContent(value);
                        setYamlError(null);
                      }}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {dirtyFields.size > 0 ? (
        <div className="sticky bottom-4 z-10 flex items-center justify-between gap-3 rounded-lg border bg-background/95 p-3 shadow-lg backdrop-blur">
          <p className="text-sm text-muted-foreground">
            {dirtyFields.size} unsaved setting{dirtyFields.size === 1 ? "" : "s"}
          </p>
          <Button onClick={() => void saveSettings()} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save to .env
          </Button>
        </div>
      ) : null}

      {pendingFileSwitch ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4">
          <Card className="w-full max-w-md">
            <CardHeader>
              <CardTitle>Unsaved YAML changes</CardTitle>
              <CardDescription>Discard edits and switch files?</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setPendingFileSwitch(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  setPendingFileSwitch(null);
                  setSelectedFile(pendingFileSwitch);
                  void loadConfigFile(pendingFileSwitch);
                }}
              >
                Discard & switch
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

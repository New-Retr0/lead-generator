"use client";

import dynamic from "next/dynamic";
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Loader2,
  Save,
  Search,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import YAML from "yaml";
import { toast } from "sonner";
import {
  SettingsField,
  isFieldSet,
  resolvedType,
  type FieldValue,
  type SchemaProperty,
} from "@/components/settings/settings-field";
import {
  CONNECTION_STATUS_FIELDS,
  FIRECRAWL_SPEND_FIELDS,
  GROUP_META,
  TAB_META,
  YAML_CATEGORIES,
  groupAnchorId,
  parseSettingsTab,
  type SettingsGroupId,
  type SettingsTab,
} from "@/components/settings/settings-meta";
import { SectionHeading } from "@/components/console/section-heading";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { SettingsSchemaPayload } from "@/lib/settings-server";
import { cn } from "@/lib/utils";

const YamlEditor = dynamic(
  () => import("@/components/settings/yaml-editor").then((m) => m.YamlEditor),
  {
    ssr: false,
    loading: () => <Skeleton className="h-[560px] w-full rounded-md" />,
  },
);

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

function matchesQuery(
  name: string,
  prop: SchemaProperty | undefined,
  query: string,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const hay = [
    name,
    prop?.title ?? "",
    prop?.help ?? "",
    prop?.group ?? "",
    name.toUpperCase(),
  ]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tab = parseSettingsTab(searchParams.get("tab"));

  const [payload, setPayload] = useState<SettingsSchemaPayload | null>(initialSettings);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(initialError);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [cleared, setCleared] = useState<Set<string>>(new Set());
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [restartRequired, setRestartRequired] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [activeSection, setActiveSection] = useState<string | null>(null);

  const [configFiles] = useState<ConfigFileSummary[]>(initialFiles);
  const [selectedFile, setSelectedFile] = useState<string | null>(initialConfigName);
  const [fileContent, setFileContent] = useState(initialConfigContent);
  const [savedContent, setSavedContent] = useState(initialConfigContent);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileSaving, setFileSaving] = useState(false);
  const [yamlError, setYamlError] = useState<{ line: number; message: string } | null>(null);
  const [pendingFileSwitch, setPendingFileSwitch] = useState<string | null>(null);
  const [pathsOpen, setPathsOpen] = useState(false);

  const setTab = useCallback(
    (next: SettingsTab) => {
      setActiveSection(null);
      const params = new URLSearchParams(searchParams.toString());
      params.set("tab", next);
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

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
      const group = (prop as SchemaProperty).group ?? "Other";
      if (!matchesQuery(name, prop as SchemaProperty, query)) continue;
      const list = groups.get(group) ?? [];
      list.push(name);
      groups.set(group, list);
    }

    const ordered: { group: SettingsGroupId | string; fields: string[]; meta?: (typeof GROUP_META)[number] }[] = [];
    for (const meta of GROUP_META) {
      const fields = groups.get(meta.id);
      if (!fields?.length) continue;
      const sorted =
        meta.id === "Firecrawl"
          ? [
              ...FIRECRAWL_SPEND_FIELDS.filter((f) => fields.includes(f)),
              ...fields.filter((f) => !(FIRECRAWL_SPEND_FIELDS as readonly string[]).includes(f)).sort(),
            ]
          : [...fields].sort();
      ordered.push({ group: meta.id, fields: sorted, meta });
      groups.delete(meta.id);
    }
    for (const [group, fields] of groups) {
      ordered.push({ group, fields: [...fields].sort() });
    }
    return ordered;
  }, [payload, query]);

  const sectionsForTab = useMemo(() => {
    if (tab === "yaml") return [];
    return groupedFields.filter(({ meta }) => {
      if (meta) return meta.tab === tab;
      return tab === "runtime";
    });
  }, [groupedFields, tab]);

  const defaultSectionId = sectionsForTab[0]
    ? groupAnchorId(sectionsForTab[0].group)
    : null;
  const highlightedSection = activeSection ?? defaultSectionId;

  const dirtyFields = useMemo(() => {
    const dirty = new Set<string>(cleared);
    for (const [name, value] of Object.entries(edits)) {
      const prop = payload?.schema.properties?.[name] as SchemaProperty | undefined;
      const type = resolvedType(prop);
      if (type === "boolean") {
        dirty.add(name);
        continue;
      }
      // Blank text/secret edits mean "keep current" — not unsaved.
      if (value.trim() === "") continue;
      dirty.add(name);
    }
    return dirty;
  }, [cleared, edits, payload]);

  const configDirty = selectedFile !== null && fileContent !== savedContent;

  useEffect(() => {
    if (tab === "yaml" || sectionsForTab.length === 0) return;
    const ids = sectionsForTab.map(({ group }) => groupAnchorId(group));
    const elements = ids
      .map((id) => document.getElementById(id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (elements.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-20% 0px -55% 0px", threshold: [0.15, 0.4, 0.7] },
    );
    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [tab, sectionsForTab]);

  function setFieldEdit(name: string, value: string) {
    setEdits((prev) => ({ ...prev, [name]: value }));
    setCleared((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function revertField(name: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setCleared((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }

  function clearOverride(name: string) {
    setEdits((prev) => {
      const next = { ...prev };
      delete next[name];
      return next;
    });
    setCleared((prev) => new Set(prev).add(name));
  }

  function toggleReveal(name: string) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }

  async function saveSettings() {
    if (!payload || dirtyFields.size === 0) return;
    setSaving(true);
    try {
      const updates: Record<string, string | number | boolean | null> = {};
      for (const name of dirtyFields) {
        if (cleared.has(name)) {
          updates[name] = null;
          continue;
        }
        const prop = payload.schema.properties?.[name] as SchemaProperty | undefined;
        const type = resolvedType(prop);
        const raw = edits[name] ?? "";
        if (type === "boolean") {
          updates[name] = raw === "true";
        } else if (type === "integer") {
          const n = parseInt(raw, 10);
          if (Number.isNaN(n)) {
            throw new Error(`${name}: enter a whole number`);
          }
          updates[name] = n;
        } else if (type === "number") {
          const n = parseFloat(raw);
          if (Number.isNaN(n)) {
            throw new Error(`${name}: enter a number`);
          }
          updates[name] = n;
        } else {
          if (raw.trim() === "") {
            // blank secret/text edit is not dirty — skip
            continue;
          }
          updates[name] = raw;
        }
      }

      if (Object.keys(updates).length === 0) {
        toast.message("Nothing to save");
        setEdits({});
        setCleared(new Set());
        return;
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
      toast.success("Saved to .env");
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
    if (!selectedFile) return;
    try {
      YAML.parse(fileContent);
      setYamlError(null);
    } catch (err) {
      if (err instanceof YAML.YAMLParseError) {
        setYamlError({
          line: err.linePos?.[0]?.line ?? 1,
          message: err.message,
        });
      } else {
        setYamlError({ line: 1, message: err instanceof Error ? err.message : "Invalid YAML" });
      }
      toast.error("Fix YAML errors before saving");
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

  const connectionStatus = useMemo(() => {
    if (!payload) return [];
    return CONNECTION_STATUS_FIELDS.map((item) => {
      const meta = payload.values[item.name] as FieldValue | undefined;
      const local = edits[item.name];
      const set =
        cleared.has(item.name)
          ? false
          : local !== undefined
            ? local.trim().length > 0
            : isFieldSet(meta);
      return { ...item, set };
    });
  }, [payload, edits, cleared]);

  const yamlFilesByCategory = useMemo(() => {
    const known = new Set(YAML_CATEGORIES.flatMap((c) => c.files));
    const categories = YAML_CATEGORIES.map((cat) => ({
      ...cat,
      items: cat.files
        .map((name) => configFiles.find((f) => f.name === name))
        .filter((f): f is ConfigFileSummary => Boolean(f)),
    })).filter((c) => c.items.length > 0);

    const other = configFiles.filter((f) => !known.has(f.name));
    if (other.length) {
      categories.push({
        id: "other",
        title: "Other",
        description: "Additional YAML under config/",
        files: other.map((f) => f.name),
        items: other,
      });
    }
    return categories;
  }, [configFiles]);

  function renderField(name: string, emphasize = false) {
    if (!payload) return null;
    return (
      <SettingsField
        key={name}
        name={name}
        payload={payload}
        edits={edits}
        cleared={cleared}
        revealed={revealed}
        onEdit={setFieldEdit}
        onRevert={revertField}
        onClearOverride={clearOverride}
        onToggleReveal={toggleReveal}
        emphasize={emphasize}
      />
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
        <div className="flex items-start gap-3 rounded-lg border border-amber-500/40 bg-amber-500/5 px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600" />
          <div>
            <p className="font-medium text-foreground">Restart required</p>
            <p className="text-muted-foreground">
              Restart the dashboard dev server to apply:{" "}
              <code className="text-foreground">{restartRequired.join(", ")}</code>
            </p>
          </div>
        </div>
      ) : null}

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(parseSettingsTab(value))}
        className="gap-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <TabsList variant="line" className="h-auto w-full flex-wrap justify-start gap-1 sm:w-auto">
            {(Object.keys(TAB_META) as SettingsTab[]).map((key) => (
              <TabsTrigger key={key} value={key} className="px-3 py-2">
                {TAB_META[key].label}
                {key !== "yaml" && dirtyFields.size > 0 && (key === "connections" || key === "runtime") ? (
                  <span className="ml-1.5 size-1.5 rounded-full bg-primary" aria-hidden />
                ) : null}
                {key === "yaml" && configDirty ? (
                  <span className="ml-1.5 size-1.5 rounded-full bg-primary" aria-hidden />
                ) : null}
              </TabsTrigger>
            ))}
          </TabsList>
          {tab !== "yaml" ? (
            <div className="relative w-full sm:max-w-xs">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter settings…"
                className="h-9 pl-8"
              />
            </div>
          ) : null}
        </div>

        <p className="text-sm text-muted-foreground">{TAB_META[tab].blurb}</p>

        <TabsContent value="connections" className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {connectionStatus.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-card px-3 py-2.5"
              >
                {item.set ? (
                  <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                ) : (
                  <XCircle className="size-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{item.label}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {item.set ? `Ready · ${item.hint}` : `Missing · ${item.hint}`}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {renderSections(sectionsForTab, highlightedSection, renderField, pathsOpen, setPathsOpen)}
          {sectionsForTab.length === 0 && query ? (
            <p className="text-sm text-muted-foreground">No settings match “{query}”.</p>
          ) : null}
        </TabsContent>

        <TabsContent value="runtime" className="space-y-4">
          {renderSections(sectionsForTab, highlightedSection, renderField, pathsOpen, setPathsOpen)}
          {sectionsForTab.length === 0 && query ? (
            <p className="text-sm text-muted-foreground">No settings match “{query}”.</p>
          ) : null}
        </TabsContent>

        <TabsContent value="yaml" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
            <Card className="h-fit">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Config files</CardTitle>
                <CardDescription className="text-xs">
                  Edits write to <code className="text-foreground">config/</code> with a{" "}
                  <code className="text-foreground">.backups</code> copy.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4 p-3">
                {yamlFilesByCategory.map((cat) => (
                  <div key={cat.id} className="space-y-1.5">
                    <div className="px-1">
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                        {cat.title}
                      </p>
                      <p className="text-[11px] leading-snug text-muted-foreground/80">
                        {cat.description}
                      </p>
                    </div>
                    <div className="space-y-0.5">
                      {cat.items.map((file) => {
                        const selected = selectedFile === file.name;
                        const dirty = selected && configDirty;
                        return (
                          <button
                            key={file.name}
                            type="button"
                            onClick={() => requestFileSwitch(file.name)}
                            className={cn(
                              "w-full rounded-md px-2.5 py-2 text-left transition-colors",
                              selected
                                ? "bg-primary/10 text-foreground"
                                : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                            )}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-mono text-xs">{file.name}</span>
                              {dirty ? (
                                <Badge variant="secondary" className="text-[10px]">
                                  unsaved
                                </Badge>
                              ) : file.warnManualEdit ? (
                                <Badge variant="outline" className="text-[10px]">
                                  auto
                                </Badge>
                              ) : null}
                            </div>
                            <p className="mt-0.5 text-[11px] leading-snug opacity-80">
                              {file.description}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="min-w-0">
              <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-1">
                  <CardTitle className="flex items-center gap-2 font-mono text-sm">
                    <FileCode2 className="size-4 text-primary" />
                    {selectedFile ?? "Select a file"}
                  </CardTitle>
                  {selectedFile ? (
                    <CardDescription>
                      {configFiles.find((f) => f.name === selectedFile)?.description}
                    </CardDescription>
                  ) : null}
                  {selectedFile &&
                  configFiles.find((f) => f.name === selectedFile)?.warnManualEdit ? (
                    <p className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-400">
                      <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                      Normally written by <code>insights --fit-score</code>. Manual edits may be
                      overwritten.
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={!selectedFile || fileLoading}
                    onClick={validateYamlLocally}
                  >
                    Validate
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!configDirty || fileSaving || !selectedFile}
                    onClick={() => void saveConfigFile()}
                  >
                    {fileSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
                    Save YAML
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {yamlError ? (
                  <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                    Line {yamlError.line}: {yamlError.message}
                  </p>
                ) : null}
                {fileLoading ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Loading file…
                  </div>
                ) : selectedFile ? (
                  <div className="overflow-hidden rounded-md border">
                    <YamlEditor
                      value={fileContent}
                      height="560px"
                      onChange={(value) => {
                        setFileContent(value);
                        setYamlError(null);
                      }}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Pick a YAML file from the list.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>

      {dirtyFields.size > 0 && tab !== "yaml" ? (
        <div className="panel sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 shadow-lg">
          <div>
            <p className="text-sm font-medium">
              {dirtyFields.size} unsaved .env change{dirtyFields.size === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-muted-foreground">
              Writes to the repo <code>.env</code>. Secrets stay masked after save.
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setEdits({});
                setCleared(new Set());
              }}
            >
              Discard
            </Button>
            <Button onClick={() => void saveSettings()} disabled={saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save to .env
            </Button>
          </div>
        </div>
      ) : null}

      {configDirty && tab === "yaml" ? (
        <div className="panel sticky bottom-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg p-3 shadow-lg">
          <div>
            <p className="text-sm font-medium">Unsaved YAML — {selectedFile}</p>
            <p className="text-xs text-muted-foreground">Validated on save. Previous copy kept in .backups.</p>
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setFileContent(savedContent)}>
              Discard
            </Button>
            <Button onClick={() => void saveConfigFile()} disabled={fileSaving}>
              {fileSaving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
              Save YAML
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={pendingFileSwitch !== null} onOpenChange={(open) => !open && setPendingFileSwitch(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unsaved YAML changes</DialogTitle>
            <DialogDescription>
              Discard edits to {selectedFile} and open {pendingFileSwitch}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingFileSwitch(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (!pendingFileSwitch) return;
                const next = pendingFileSwitch;
                setPendingFileSwitch(null);
                setSelectedFile(next);
                void loadConfigFile(next);
              }}
            >
              Discard & switch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function renderSections(
  sections: {
    group: string;
    fields: string[];
    meta?: (typeof GROUP_META)[number];
  }[],
  activeSection: string | null,
  renderField: (name: string, emphasize?: boolean) => ReactNode,
  pathsOpen: boolean,
  setPathsOpen: (open: boolean) => void,
) {
  if (sections.length === 0) {
    return null;
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[200px_minmax(0,1fr)]">
      <nav
        aria-label="Settings sections"
        className="panel sticky top-4 z-10 hidden h-fit rounded-lg p-2 lg:block"
      >
        <p className="mb-2 px-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          On this page
        </p>
        <ul className="space-y-0.5">
          {sections.map(({ group, meta }, index) => {
            const id = groupAnchorId(group);
            const label = meta?.short ?? group;
            return (
              <li key={group}>
                <a
                  href={`#${id}`}
                  className={cn(
                    "block rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors",
                    activeSection === id
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                  )}
                >
                  [{String(index + 1).padStart(2, "0")}] {label}
                </a>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="space-y-4">
        {sections.map(({ group, fields, meta }, index) => {
          const id = groupAnchorId(group);
          const title = (meta?.title ?? group).toUpperCase();
          const description = meta?.description ?? "";
          const isPaths = group === "Paths";
          const spendFields = fields.filter((f) =>
            (FIRECRAWL_SPEND_FIELDS as readonly string[]).includes(f),
          );
          const otherFields = fields.filter(
            (f) => !(FIRECRAWL_SPEND_FIELDS as readonly string[]).includes(f),
          );

          const body = (
            <>
              {group === "Firecrawl" && spendFields.length > 0 ? (
                <div className="mb-4 space-y-3 rounded-lg border border-primary/20 bg-primary/[0.04] p-4">
                  <div>
                    <p className="text-sm font-medium text-foreground">Cost brakes</p>
                    <p className="text-xs text-muted-foreground">
                      Set these before long campaigns. <code>0</code> usually means unlimited / off
                      — check each field help.
                    </p>
                  </div>
                  <div className="grid gap-3">{spendFields.map((f) => renderField(f, true))}</div>
                </div>
              ) : null}
              <div className="grid gap-3">
                {(group === "Firecrawl" ? otherFields : fields).map((f) => renderField(f))}
              </div>
            </>
          );

          if (isPaths) {
            return (
              <Card key={group} id={id} className="scroll-mt-4">
                <Collapsible open={pathsOpen} onOpenChange={setPathsOpen}>
                  <CardHeader className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <SectionHeading
                        index={String(index + 1).padStart(2, "0")}
                        title={title}
                      />
                      <CollapsibleTrigger asChild>
                        <Button variant="outline" size="sm">
                          {pathsOpen ? "Hide" : "Show paths"}
                        </Button>
                      </CollapsibleTrigger>
                    </div>
                    {description ? <CardDescription>{description}</CardDescription> : null}
                  </CardHeader>
                  <CollapsibleContent>
                    <CardContent>{body}</CardContent>
                  </CollapsibleContent>
                </Collapsible>
              </Card>
            );
          }

          return (
            <Card key={group} id={id} className="scroll-mt-4">
              <CardHeader className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <SectionHeading
                    index={String(index + 1).padStart(2, "0")}
                    title={title}
                    className="flex-1"
                  />
                  {meta?.costCritical ? (
                    <Badge variant="outline" className="text-[10px]">
                      cost control
                    </Badge>
                  ) : null}
                </div>
                {description ? <CardDescription>{description}</CardDescription> : null}
              </CardHeader>
              <CardContent>{body}</CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

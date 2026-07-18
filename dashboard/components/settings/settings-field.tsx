"use client";

import { Eye, EyeOff, RotateCcw, Undo2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { FIELD_TITLE_OVERRIDES } from "@/components/settings/settings-meta";
import type { SettingsSchemaPayload } from "@/lib/settings-server";

export type SchemaProperty = {
  type?: string | string[];
  group?: string;
  secret?: boolean;
  readonly?: boolean;
  help?: string;
  title?: string;
  default?: unknown;
};

export type FieldValue =
  | {
      value: string | number | boolean;
      default: unknown;
      modified: boolean;
      env_key: string;
      readonly?: boolean;
    }
  | {
      masked: string;
      is_set: boolean;
      modified: boolean;
      env_key: string;
      readonly?: boolean;
    };

export function fieldTitle(name: string, prop?: SchemaProperty): string {
  if (FIELD_TITLE_OVERRIDES[name]) {
    return FIELD_TITLE_OVERRIDES[name];
  }
  if (prop?.title) {
    return prop.title;
  }
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function isSecretField(
  name: string,
  prop: SchemaProperty | undefined,
  payload: SettingsSchemaPayload,
): boolean {
  return Boolean(prop?.secret || payload.secret_fields?.includes(name));
}

export function resolvedType(prop: SchemaProperty | undefined): string {
  const t = prop?.type;
  if (Array.isArray(t)) {
    return t.find((x) => x !== "null") ?? "string";
  }
  return t ?? "string";
}

export function formatDefault(value: unknown): string {
  if (value === null || value === undefined || value === "") {
    return "(empty)";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  return String(value);
}

export function isFieldSet(meta: FieldValue | undefined): boolean {
  if (!meta) return false;
  if ("masked" in meta) return meta.is_set;
  if (typeof meta.value === "boolean") return true;
  if (typeof meta.value === "number") return true;
  return String(meta.value ?? "").trim().length > 0;
}

type SettingsFieldProps = {
  name: string;
  payload: SettingsSchemaPayload;
  edits: Record<string, string>;
  cleared: Set<string>;
  revealed: Set<string>;
  onEdit: (name: string, value: string) => void;
  onRevert: (name: string) => void;
  onClearOverride: (name: string) => void;
  onToggleReveal: (name: string) => void;
  emphasize?: boolean;
};

export function SettingsField({
  name,
  payload,
  edits,
  cleared,
  revealed,
  onEdit,
  onRevert,
  onClearOverride,
  onToggleReveal,
  emphasize,
}: SettingsFieldProps) {
  const prop = payload.schema.properties?.[name] as SchemaProperty | undefined;
  const meta = payload.values[name] as FieldValue | undefined;
  if (!meta) {
    return null;
  }

  const readonly = Boolean(prop?.readonly || meta.readonly);
  const secret = isSecretField(name, prop, payload);
  const type = resolvedType(prop);
  const hasLocalEdit = edits[name] !== undefined;
  const willClear = cleared.has(name);
  const dirty = hasLocalEdit || willClear;
  const envOverride = meta.modified && !willClear;

  const shellClass = emphasize
    ? "space-y-2 rounded-lg border border-primary/25 bg-primary/[0.03] p-4"
    : "space-y-2 rounded-lg border border-border/50 bg-card p-4";

  if (readonly) {
    const display =
      "value" in meta ? formatDefault(meta.value) : meta.is_set ? meta.masked : "(empty)";
    return (
      <div key={name} className={shellClass}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <Label className="text-sm font-medium">{fieldTitle(name, prop)}</Label>
          <Badge variant="outline" className="font-mono text-[10px]">
            read-only
          </Badge>
        </div>
        {prop?.help ? <p className="text-sm text-muted-foreground">{prop.help}</p> : null}
        <p className="break-all font-mono text-xs text-foreground/80">{display}</p>
        <p className="font-mono text-[10px] text-muted-foreground">{meta.env_key}</p>
      </div>
    );
  }

  if (type === "boolean") {
    const current = willClear
      ? Boolean(prop?.default)
      : hasLocalEdit
        ? edits[name] === "true"
        : "value" in meta
          ? Boolean(meta.value)
          : Boolean(prop?.default);

    return (
      <div key={name} className={`flex items-start justify-between gap-4 ${shellClass}`}>
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={name} className="text-sm font-medium">
              {fieldTitle(name, prop)}
            </Label>
            {dirty ? <Badge variant="secondary">unsaved</Badge> : null}
            {envOverride ? (
              <Badge variant="outline" className="text-[10px]">
                .env override
              </Badge>
            ) : null}
          </div>
          {prop?.help ? <p className="text-sm text-muted-foreground">{prop.help}</p> : null}
          <p className="font-mono text-[10px] text-muted-foreground">
            {meta.env_key} · default {formatDefault(prop?.default)}
          </p>
          {dirty || envOverride ? (
            <div className="flex flex-wrap gap-1 pt-1">
              {dirty ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onRevert(name)}>
                  <Undo2 className="size-3.5" />
                  Revert
                </Button>
              ) : null}
              {envOverride && !dirty ? (
                <Button type="button" variant="ghost" size="sm" onClick={() => onClearOverride(name)}>
                  <RotateCcw className="size-3.5" />
                  Use default
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        <Switch
          id={name}
          checked={current}
          onCheckedChange={(checked) => onEdit(name, checked ? "true" : "false")}
        />
      </div>
    );
  }

  const inputType =
    type === "integer" || type === "number"
      ? "number"
      : secret && !revealed.has(name)
        ? "password"
        : "text";

  const placeholder =
    willClear
      ? `Will use default: ${formatDefault(prop?.default)}`
      : secret && "masked" in meta
        ? meta.is_set
          ? meta.masked
          : "Not set — paste key to add"
        : "value" in meta
          ? formatDefault(meta.value)
          : "";

  const inputValue = willClear ? "" : (edits[name] ?? "");

  return (
    <div key={name} className={shellClass}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor={name} className="text-sm font-medium">
              {fieldTitle(name, prop)}
            </Label>
            {dirty ? <Badge variant="secondary">unsaved</Badge> : null}
            {secret && "masked" in meta && meta.is_set && !dirty ? (
              <Badge variant="outline" className="text-[10px] text-emerald-700 dark:text-emerald-400">
                set
              </Badge>
            ) : null}
            {secret && "masked" in meta && !meta.is_set && !dirty ? (
              <Badge variant="outline" className="text-[10px] text-amber-700 dark:text-amber-400">
                missing
              </Badge>
            ) : null}
            {envOverride && !secret ? (
              <Badge variant="outline" className="text-[10px]">
                .env override
              </Badge>
            ) : null}
          </div>
          {prop?.help ? <p className="text-sm text-muted-foreground">{prop.help}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {dirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onRevert(name)}>
              <Undo2 className="size-3.5" />
              Revert
            </Button>
          ) : null}
          {envOverride && !dirty ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onClearOverride(name)}>
              <RotateCcw className="size-3.5" />
              Use default
            </Button>
          ) : null}
          {secret ? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => onToggleReveal(name)}>
              {revealed.has(name) ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              <span className="sr-only">{revealed.has(name) ? "Hide" : "Show"}</span>
            </Button>
          ) : null}
        </div>
      </div>
      <Input
        id={name}
        type={inputType}
        value={inputValue}
        placeholder={placeholder}
        onChange={(e) => onEdit(name, e.target.value)}
        autoComplete={secret ? "off" : undefined}
        spellCheck={false}
      />
      <p className="font-mono text-[10px] text-muted-foreground">
        {meta.env_key}
        {!secret ? ` · default ${formatDefault(prop?.default ?? ("default" in meta ? meta.default : ""))}` : null}
        {secret && "masked" in meta && meta.is_set
          ? " · leave blank to keep current value"
          : null}
      </p>
    </div>
  );
}

import { listConfigFiles, readConfigFile, type ConfigFileSummary } from "./config-files";
import { runCli } from "./cli-exec";

export type SettingsSchemaPayload = {
  schema: {
    properties?: Record<
      string,
      {
        type?: string | string[];
        group?: string;
        secret?: boolean;
        readonly?: boolean;
        help?: string;
        title?: string;
        default?: unknown;
      }
    >;
  };
  values: Record<string, unknown>;
  defaults?: Record<string, unknown>;
  env_keys_present?: string[];
  secret_fields?: string[];
  readonly_fields?: string[];
};

export async function fetchSettingsSchema(): Promise<SettingsSchemaPayload> {
  const { stdout, stderr, code } = await runCli(["settings-schema"]);
  if (code !== 0) {
    throw new Error(stderr.trim() || stdout.trim() || "settings-schema failed");
  }
  return JSON.parse(stdout) as SettingsSchemaPayload;
}

export function fetchConfigFileList(): ConfigFileSummary[] {
  return listConfigFiles();
}

export function fetchInitialConfigFile(name: string | undefined): {
  name: string | null;
  content: string;
} {
  if (!name) {
    return { name: null, content: "" };
  }
  try {
    return { name, content: readConfigFile(name) };
  } catch {
    return { name, content: "" };
  }
}

import type { Metadata } from "next";
import { SettingsClient } from "@/components/settings/settings-client";
import { fetchConfigFileList, fetchInitialConfigFile, fetchSettingsSchema } from "@/lib/settings-server";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function SettingsPage() {
  let initialSettings = null;
  const initialFiles = fetchConfigFileList();
  const firstFile = initialFiles[0]?.name;
  const initialConfig = fetchInitialConfigFile(firstFile);
  let loadError: string | null = null;

  try {
    initialSettings = await fetchSettingsSchema();
  } catch (err) {
    loadError = err instanceof Error ? err.message : "Failed to load settings schema";
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Pipeline environment variables (.env) and YAML configuration files.
        </p>
      </div>
      <SettingsClient
        initialSettings={initialSettings}
        initialFiles={initialFiles}
        initialError={loadError}
        initialConfigName={initialConfig.name}
        initialConfigContent={initialConfig.content}
      />
    </div>
  );
}

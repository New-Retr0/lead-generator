import type { Metadata } from "next";
import { SettingsClient } from "@/components/settings/settings-client";
import { SettingsPageIntro } from "@/components/settings/settings-page-intro";
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
      <SettingsPageIntro />
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

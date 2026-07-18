import type { Metadata } from "next";
import { Suspense } from "react";
import { SettingsClient } from "@/components/settings/settings-client";
import { SettingsPageIntro } from "@/components/settings/settings-page-intro";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fetchConfigFileList,
  fetchInitialConfigFile,
  fetchSettingsSchema,
} from "@/lib/settings-server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Settings",
};

function SettingsClientFallback() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-10 w-full max-w-md" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-64 w-full" />
    </div>
  );
}

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
      <Suspense fallback={<SettingsClientFallback />}>
        <SettingsClient
          initialSettings={initialSettings}
          initialFiles={initialFiles}
          initialError={loadError}
          initialConfigName={initialConfig.name}
          initialConfigContent={initialConfig.content}
        />
      </Suspense>
    </div>
  );
}

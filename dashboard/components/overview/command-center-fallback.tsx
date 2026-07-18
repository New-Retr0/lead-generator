import { Skeleton } from "@/components/ui/skeleton";

/** Suspense fallback for Command Center — never render null. */
export function CommandCenterFallback() {
  return (
    <div className="space-y-6 p-4 md:p-8" aria-busy="true" aria-label="Loading Command Center">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton className="h-56 rounded-xl" />
        <Skeleton className="h-56 rounded-xl" />
      </div>
    </div>
  );
}

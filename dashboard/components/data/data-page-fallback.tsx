import { Skeleton } from "@/components/ui/skeleton";

export function DataPageFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading lead data">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="h-3 w-80" />
      <Skeleton className="h-9 w-44 rounded-lg" />
      <Skeleton className="h-24 w-full rounded-2xl" />
      <Skeleton className="h-[28rem] w-full rounded-2xl" />
    </div>
  );
}

import { Skeleton } from "@/components/ui/skeleton";

export default function RunsLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-24 w-full rounded-xl shimmer" />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-md rounded-md" />
      <div className="space-y-2">
        {Array.from({ length: 10 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

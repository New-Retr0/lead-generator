import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-8">
      <Skeleton className="h-32 w-full rounded-xl shimmer" />
      <Skeleton className="h-4 w-48" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg shimmer" />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-lg shimmer" />
        <Skeleton className="h-48 rounded-lg shimmer" />
      </div>
    </div>
  );
}

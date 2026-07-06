import { Skeleton } from "@/components/ui/skeleton";

export default function DashboardLoading() {
  return (
    <div className="space-y-10">
      <Skeleton className="h-56 w-full rounded-xl shimmer md:h-72" />
      <Skeleton className="h-4 w-32" />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-lg" />
        ))}
      </div>
      <Skeleton className="h-24 w-full rounded-lg" />
      <div className="grid gap-6 lg:grid-cols-3">
        <Skeleton className="h-52 rounded-lg lg:col-span-2" />
        <Skeleton className="h-52 rounded-lg" />
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <Skeleton className="h-48 rounded-lg" />
        <Skeleton className="h-48 rounded-lg" />
      </div>
    </div>
  );
}

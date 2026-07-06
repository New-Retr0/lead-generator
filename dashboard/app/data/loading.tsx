import { Skeleton } from "@/components/ui/skeleton";

export default function DataLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-20 w-full rounded-xl shimmer" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>
      <Skeleton className="h-9 w-full max-w-lg rounded-md" />
      <div className="space-y-2">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}

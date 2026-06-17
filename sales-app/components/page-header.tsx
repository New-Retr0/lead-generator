export function PageHeader({
  description,
  children,
}: {
  /** @deprecated title is shown in SiteHeader — pass description only */
  title?: string;
  description?: string;
  children?: React.ReactNode;
}) {
  if (!description && !children) return null;
  return (
    <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
      {description ? (
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
      ) : (
        <div />
      )}
      {children ? (
        <div className="flex min-w-0 shrink-0 items-center gap-2 overflow-x-auto pb-0.5 sm:overflow-visible sm:pb-0">
          {children}
        </div>
      ) : null}
    </div>
  );
}

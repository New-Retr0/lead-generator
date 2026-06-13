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
    <div className="flex flex-wrap items-end justify-between gap-3">
      {description ? (
        <p className="max-w-2xl text-sm text-muted-foreground">{description}</p>
      ) : (
        <div />
      )}
      {children ? <div className="flex shrink-0 items-center gap-2">{children}</div> : null}
    </div>
  );
}

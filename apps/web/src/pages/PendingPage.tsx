export function PendingPage({ title }: { title: string }) {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="m-0 text-display font-semibold">{title}</h1>
      <p className="m-0 text-ink-muted">Esta sección todavía no está construida.</p>
    </div>
  );
}

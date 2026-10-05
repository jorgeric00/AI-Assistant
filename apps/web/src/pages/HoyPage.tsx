import { Card, EmptyState } from '../components/Card';

const dateFormatter = new Intl.DateTimeFormat('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function HoyPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="m-0 text-display font-semibold">Hoy</h1>
          <p className="mt-1 mb-0 text-ink-muted">{capitalize(dateFormatter.format(new Date()))}</p>
        </div>
        <button
          type="button"
          disabled
          className="h-10 rounded-md border border-line-strong bg-surface-raised px-4 font-medium text-ink disabled:cursor-not-allowed disabled:text-ink-faint"
        >
          Resumen para la daily
        </button>
      </header>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] gap-4">
        <Card title="Recordatorios de hoy" action={<a href="#/recordatorios" className="text-small text-info">Ver todos</a>}>
          <EmptyState>No tienes recordatorios para hoy.</EmptyState>
        </Card>
        <Card title="Tareas en curso" action={<a href="#/tareas" className="text-small text-info">Ver tareas</a>}>
          <EmptyState>Conecta JIRA para ver tus tareas.</EmptyState>
        </Card>
        <Card title="Avisos de tus PR">
          <EmptyState>Sin avisos. Aquí verás CI en rojo y comentarios nuevos.</EmptyState>
        </Card>
        <Card title="Diario de hoy" action={<a href="#/diario" className="text-small text-info">Ver diario</a>}>
          <EmptyState>Aún no hay entradas hoy.</EmptyState>
        </Card>
      </div>
    </div>
  );
}

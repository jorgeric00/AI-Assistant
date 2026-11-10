import { useQuery } from '@tanstack/react-query';
import { TriangleAlert } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../api';

/** Aviso en las sesiones con opencode cuando algún MCP no arranca o le falta iniciar sesión, con enlace a Ajustes. */
export function McpWarning() {
  const { t } = useTranslation('common');
  const status = useQuery({
    queryKey: queryKeys.aiMcp,
    queryFn: api.aiMcp,
    staleTime: 60_000,
  });
  const broken = status.data?.servers.filter((s) => s.state === 'failed' || s.state === 'needs_auth') ?? [];
  if (!broken.length) return null;
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-line border-l-[3px] border-l-accent bg-surface px-3.5 py-2.5 text-small">
      <TriangleAlert size={16} strokeWidth={1.5} className="shrink-0 text-accent" aria-hidden />
      <span className="min-w-0 flex-1">
        {t('mcpWarning.text', {
          count: broken.length,
          names: broken.map((s) => s.name).join(', '),
        })}
      </span>
      <a href="#/ajustes" className="shrink-0 text-info">
        {t('mcpWarning.link')}
      </a>
    </div>
  );
}

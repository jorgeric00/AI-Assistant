import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Language } from '@dev-assistant/shared';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { api, queryKeys } from '../api';
import { applyLanguage, browserLanguage } from '.';

/**
 * Idioma de la app. El servidor guarda el elegido; la primera vez (sin elegir) se guarda el del navegador.
 * Al cambiarlo se vuelven a pedir los datos, porque el servidor también responde en ese idioma.
 */
export function useLanguage() {
  const { i18n } = useTranslation();
  const queryClient = useQueryClient();
  const setting = useQuery({ queryKey: queryKeys.language, queryFn: api.getLanguage, staleTime: Infinity });
  const change = useMutation({
    mutationFn: api.setLanguage,
    onSuccess: (data) => {
      queryClient.setQueryData(queryKeys.language, data);
      if (data.language) applyLanguage(data.language);
      void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'settings' });
    },
  });

  const stored = setting.data?.language;
  useEffect(() => {
    if (!setting.data) return;
    if (stored) applyLanguage(stored);
    else if (!change.isPending) change.mutate(browserLanguage());
    // Solo al cargar el ajuste del servidor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setting.data]);

  return {
    language: (stored ?? i18n.language) as Language,
    setLanguage: (lang: Language) => change.mutate(lang),
    isChanging: change.isPending,
  };
}

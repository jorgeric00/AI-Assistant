import 'i18next';
import type { resources } from './resources';

// Claves tipadas: t('clave') que no existe en el castellano no compila.
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: (typeof resources)['es'];
  }
}

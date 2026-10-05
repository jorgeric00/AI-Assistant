import notifier from 'node-notifier';
import type { SystemNotifier } from './scheduler.js';

/** Notificación del sistema (en Windows, el centro de notificaciones) aunque el navegador esté cerrado. */
export const desktopNotifier: SystemNotifier = ({ reminder, late }) =>
  new Promise((resolve, reject) => {
    notifier.notify(
      {
        title: late ? 'Recordatorio atrasado' : 'Recordatorio',
        message: reminder.title,
        appID: 'AI-Assistant',
        wait: false,
      },
      (err) => (err ? reject(err) : resolve()),
    );
  });

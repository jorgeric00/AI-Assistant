import type { Reminder } from '@dev-assistant/shared';
import { useTranslation } from 'react-i18next';
import { Modal } from '../../components/Modal';
import { ReminderForm } from './ReminderForm';

/** Diálogo "Nuevo recordatorio" / "Editar recordatorio". */
export function ReminderDialog({ reminder, onClose }: { reminder?: Reminder; onClose: () => void }) {
  const { t } = useTranslation('reminders');
  return (
    <Modal labelledBy="recordatorio-titulo" onClose={onClose}>
      <h1 id="recordatorio-titulo" className="m-0 text-title font-semibold">
        {reminder ? t('dialog.edit') : t('dialog.new')}
      </h1>
      <ReminderForm reminder={reminder} onSaved={onClose} onCancel={onClose} onDeleted={onClose} />
    </Modal>
  );
}

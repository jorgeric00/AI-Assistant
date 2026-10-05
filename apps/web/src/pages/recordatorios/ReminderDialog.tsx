import type { Reminder } from '@dev-assistant/shared';
import { Modal } from '../../components/Modal';
import { ReminderForm } from './ReminderForm';

/** Diálogo "Nuevo recordatorio" / "Editar recordatorio". */
export function ReminderDialog({ reminder, onClose }: { reminder?: Reminder; onClose: () => void }) {
  return (
    <Modal labelledBy="recordatorio-titulo" onClose={onClose}>
      <h1 id="recordatorio-titulo" className="m-0 text-title font-semibold">
        {reminder ? 'Editar recordatorio' : 'Nuevo recordatorio'}
      </h1>
      <ReminderForm reminder={reminder} onSaved={onClose} onCancel={onClose} onDeleted={onClose} />
    </Modal>
  );
}

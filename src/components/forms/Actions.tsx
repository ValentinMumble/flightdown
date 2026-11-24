import {Trash} from 'lucide-react';

/** A form's last row: Delete, when it edits an item, and its main button. */
export function Actions({onDelete, label}: {onDelete?: () => void; label: string}) {
  return (
    <div className="form-actions">
      {onDelete ? (
        <button type="button" className="button danger" onClick={onDelete}>
          <Trash size={15} /> Delete
        </button>
      ) : (
        <span />
      )}
      <button type="submit" className="button solid">
        {label}
      </button>
    </div>
  );
}

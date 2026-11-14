import { useId, useState } from "react";
import { Modal } from "./Dialog";

export function BookmarkRename({ name, onSave, onClose }: {
  name: string;
  onSave: (name: string) => void;
  onClose: () => void;
}) {
  const heading = useId();
  const [value, setValue] = useState(name);
  return (
    <Modal onClose={onClose} labelledBy={heading}>
      <form onSubmit={(event) => {
        event.preventDefault();
        if (value.trim()) onSave(value.trim());
      }}>
        <h2 className="ccd-title" id={heading}>Rename bookmark</h2>
        <div className="ccd-field">
          <input type="text" aria-label="Bookmark name" data-first value={value}
            onFocus={(event) => event.currentTarget.select()} onChange={(event) => setValue(event.target.value)} />
        </div>
        <div className="ccd-row">
          <button className="ccd-btn" type="button" onClick={onClose}>Cancel</button>
          <button className="ccd-btn go" type="submit" disabled={!value.trim()}>Save</button>
        </div>
      </form>
    </Modal>
  );
}

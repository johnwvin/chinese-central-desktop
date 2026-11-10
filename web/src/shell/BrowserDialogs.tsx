import { useId, useState } from "react";
import { Modal } from "../ui/Dialog";
import { ActionIcon } from "../ui/ActionIcon";

export function BookmarkDialog({ title, folder, folders, onSave, onClose }: {
  title: string;
  folder: string;
  folders: { id: string; name: string }[];
  onSave: (name: string, folder: string) => void;
  onClose: () => void;
}) {
  const heading = useId();
  const [name, setName] = useState(title);
  const [destination, setDestination] = useState(folder);
  return <Modal onClose={onClose} labelledBy={heading}>
    <form className="browser-dialog-fields" onSubmit={(event) => { event.preventDefault(); if (name.trim()) onSave(name, destination); }}>
      <h2 id={heading}>Bookmark</h2>
      <label>Name<input data-first required value={name} onFocus={(event) => event.currentTarget.select()} onChange={(event) => setName(event.target.value)} /></label>
      <label>Folder<select value={destination} onChange={(event) => setDestination(event.target.value)}>
        <option value="">None</option>
        {folders.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
      </select></label>
      <div className="browser-dialog-actions"><button className="ccd-btn" type="button" onClick={onClose}>Cancel</button><button className="ccd-btn go" type="submit" disabled={!name.trim()}>Save</button></div>
    </form>
  </Modal>;
}

export function AdBlockDialog({ enabled, rules, onToggle, onPick, onRemove, onClose }: {
  enabled: boolean;
  rules: string[];
  onToggle: () => void;
  onPick: () => void;
  onRemove: (selector: string) => void;
  onClose: () => void;
}) {
  const heading = useId();
  return <Modal onClose={onClose} labelledBy={heading}>
    <div className="browser-dialog-fields">
      <h2 id={heading}>Ad blocker</h2>
      <label className="browser-block-switch"><input type="checkbox" checked={enabled} onChange={onToggle} /> Block ads</label>
      {rules.length > 0 && <ul className="browser-element-rules">
        {rules.map((selector) => <li key={selector}><code title={selector}>{selector}</code>
          <button className="ccd-btn" type="button" aria-label={`Remove filter ${selector}`} title="Remove filter" onClick={() => onRemove(selector)}><ActionIcon name="trash" /></button>
        </li>)}
      </ul>}
      <div className="browser-dialog-actions"><button className="ccd-btn" type="button" onClick={onClose}>Close</button>
        <button className="ccd-btn go" type="button" disabled={!enabled} onClick={onPick}>Pick element</button></div>
    </div>
  </Modal>;
}

import { useState } from 'react';

type Props = {
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  title: string;
  hint?: string;
  onFiles: (files: File[]) => void;
  onReject?: (names: string[]) => void;
};

// Dropped files skip the picker's accept filter, so apply it here.
const allowed = (file: File, accept?: string) => {
  if (!accept) return true;
  return accept.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean).some((t) =>
    t.startsWith('.') ? file.name.toLowerCase().endsWith(t) : t.endsWith('/*') ? file.type.startsWith(t.slice(0, -1)) : file.type === t);
};

export function FileDrop({ accept, multiple, disabled, title, hint, onFiles, onReject }: Props) {
  const [over, setOver] = useState(false);
  const take = (list: FileList | null) => {
    const all = Array.from(list ?? []);
    const ok = all.filter((f) => allowed(f, accept));
    const bad = all.filter((f) => !allowed(f, accept)).map((f) => f.name);
    if (bad.length) onReject?.(bad);
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
  };
  return (
    <label
      className={'dropzone' + (over ? ' over' : '') + (disabled ? ' disabled' : '')}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false); }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files); }}
    >
      <input type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={(e) => { take(e.target.files); e.target.value = ''; }} />
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5" /><path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" /></svg>
      <strong>{title}</strong>
      <small><span className="dz-desktop">Datei hierher ziehen oder klicken</span><span className="dz-touch">Tippen zum Auswählen</span>{hint ? ` · ${hint}` : ''}</small>
    </label>
  );
}

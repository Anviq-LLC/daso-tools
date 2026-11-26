"use client"

import { useState } from "react"
import { Upload } from "lucide-react"

type Props = {
  accept?: string
  multiple?: boolean
  disabled?: boolean
  compact?: boolean
  title: string
  hint?: string
  onFiles: (files: File[]) => void
  onReject?: (names: string[]) => void
}

// Dropped files skip the picker's accept filter, so apply it here.
const allowed = (file: File, accept?: string) => {
  if (!accept) return true
  return accept.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).some((t) =>
    t.startsWith(".") ? file.name.toLowerCase().endsWith(t) : t.endsWith("/*") ? file.type.startsWith(t.slice(0, -1)) : file.type === t)
}

export function FileDrop({ accept, multiple, disabled, compact, title, hint, onFiles, onReject }: Props) {
  const [over, setOver] = useState(false)
  const take = (list: FileList | null) => {
    const all = Array.from(list ?? [])
    const ok = all.filter((f) => allowed(f, accept))
    const bad = all.filter((f) => !allowed(f, accept)).map((f) => f.name)
    if (bad.length) onReject?.(bad)
    if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1))
  }
  return (
    <label
      className={"dropzone" + (compact ? " compact" : "") + (over ? " over" : "") + (disabled ? " disabled" : "")}
      onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true) }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOver(false) }}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!disabled) take(e.dataTransfer.files) }}
    >
      <input type="file" accept={accept} multiple={multiple} disabled={disabled} onChange={(e) => { take(e.target.files); e.target.value = "" }} />
      <Upload size={compact ? 16 : 26} aria-hidden="true" />
      <strong>{title}</strong>
      <small><span className="dz-desktop">{compact ? "oder Datei hierher ziehen" : "Datei hierher ziehen oder klicken"}</span><span className="dz-touch">{compact ? "" : "Tippen zum Auswählen"}</span>{hint ? `${compact ? "" : " · "}${hint}` : ""}</small>
    </label>
  )
}

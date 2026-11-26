"use client"

import { useCallback, useEffect, useState } from "react"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"

type Entry = { id: string; date: string; endDate: string; team: string; reason: string; user: string; at: string; files: number }

const day = (iso: string) => iso.slice(0, 10).split("-").reverse().join(".")

export function ArchivePanel({ projectId, canPurge, refreshKey }: { projectId: string; canPurge: boolean; refreshKey: number }) {
  const [items, setItems] = useState<Entry[]>([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    fetch("/api/archive?project=" + encodeURIComponent(projectId))
      .then((r) => r.json() as Promise<{ archive?: Entry[]; error?: string }>)
      .then((j) => { if (j.error) throw Error(j.error); setItems(j.archive || []); setError("") })
      .catch((e: Error) => setError(e.message))
  }, [projectId])
  useEffect(load, [load, refreshKey])

  const purge = async (entry: Entry) => {
    if (!window.confirm(`Aufmaß vom ${day(entry.date)} (${entry.team}) endgültig löschen? Das kann nicht rückgängig gemacht werden.`)) return
    setBusy(true)
    try {
      const r = await fetch("/api/archive", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ projectId, id: entry.id }) })
      const j = await r.json() as { error?: string }
      if (j.error) throw Error(j.error)
      load()
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  if (!items.length && !error) return null
  return (
    <details className="panel archive-panel">
      <summary>Archiv gelöschter Aufmaße ({items.length})</summary>
      <div className="padding">
        {error && <div className="message error" role="alert">{error}</div>}
        {items.map((e) => (
          <div className="archive-row" key={e.id}>
            <div>
              <strong>{day(e.date)}{e.endDate && e.endDate !== e.date ? ` bis ${day(e.endDate)}` : ""} · {e.team || "ohne Team"}</strong>
              <p>{e.reason}</p>
              <small>Gelöscht von {e.user} am {day(e.at)}{e.files ? ` · ${e.files} Anlage${e.files > 1 ? "n" : ""}` : ""}</small>
            </div>
            {canPurge && <Button variant="outline" disabled={busy} onClick={() => purge(e)}><Trash2 />Endgültig löschen</Button>}
          </div>
        ))}
        {!canPurge && items.length > 0 && <small>Endgültig löschen dürfen nur freigeschaltete Personen.</small>}
      </div>
    </details>
  )
}

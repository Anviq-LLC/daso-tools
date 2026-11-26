export type NuFirm = { name: string; aliases: string[] }
export type NuFirms = { master: boolean; firms: NuFirm[] }

const key = (v: string) => v.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')

// The firm's name as the nachunternehmer tool spells it, or null when no active firm matches.
export function nuFirmName(firms: NuFirm[], name: string): string | null {
  const k = key(name)
  return firms.find((f) => [f.name, ...f.aliases].some((n) => key(n) === k))?.name ?? null
}

// Contractors still carrying an old spelling of a firm get the nachunternehmer spelling, unless that name is already taken.
export function contractorRenames(contractors: { id: string; name: string }[], firms: NuFirm[]): { id: string; name: string }[] {
  const taken = new Set(contractors.map((c) => key(c.name)))
  const out: { id: string; name: string }[] = []
  for (const c of contractors) {
    const own = nuFirmName(firms, c.name)
    if (!own || own === c.name || taken.has(key(own))) continue
    taken.add(key(own))
    out.push({ id: c.id, name: own })
  }
  return out
}

export type NuFirm = { name: string; aliases: string[] }
export type NuFirms = { master: boolean; firms: NuFirm[] }

const key = (v: string) => v.trim().normalize('NFKC').toLowerCase().replace(/\s+/g, ' ')

// The firm's name as the nachunternehmer tool spells it, or null when no active firm matches.
export function nuFirmName(firms: NuFirm[], name: string): string | null {
  const k = key(name)
  return firms.find((f) => [f.name, ...f.aliases].some((n) => key(n) === k))?.name ?? null
}

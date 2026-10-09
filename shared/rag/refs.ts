/**
 * RAG pilot - provisions as people cite them, and links to the legislation (used by /api/rag/question and /rag).
 * Pure: no database, no corpus. The anchors are the legislation's own XML ids, which the NSW legislation website uses as
 * fragment ids, so `<instrument source_url>#<anchor>` opens the instrument at that provision.
 */

export interface ProvRef { local_id: string; doc_kind: string; path?: string[] | null; heading?: string | null }

/** "Randwick LEP cl 4.4A(2)", "Housing SEPP s 52(1)", "Randwick LEP Sch 1 cl 2(2)", "Randwick LEP Land Use Table, Zone R2 (Prohibited)" */
export function labelOf(p: ProvRef): string {
  const inst = p.doc_kind === 'sepp' ? 'Housing SEPP' : 'Randwick LEP'
  const grp = p.local_id.startsWith('pt-cg') ? p.local_id : (p.path ?? []).find(x => x.startsWith('pt-cg'))
  if (grp) return `${inst} Land Use Table, ${grp.replace(/^pt-cg1\.Zone_/, 'Zone ')}${p.heading && !p.local_id.startsWith('pt-cg') ? ` (${p.heading})` : ''}`
  if (/-def\./.test(p.local_id)) return `${inst} definition of "${p.heading ?? p.local_id.split('-def.')[1]}"`
  let s = ''
  for (const seg of p.local_id.split('#')[0]!.split('-').filter(x => !/^oc\.\d+$/.test(x))) {
    let m: RegExpMatchArray | null
    if ((m = seg.match(/^sec\.(.+)$/))) s += p.doc_kind === 'sepp' || s.startsWith('Sch') ? `${s ? ' ' : ''}${p.doc_kind === 'sepp' ? 's' : 'cl'} ${m[1]}` : `cl ${m[1]}`
    else if ((m = seg.match(/^(?:ssec|para\d)\.(.+)$/))) s += `(${m[1]})`
    else if ((m = seg.match(/^sch\.(.+)$/))) s += `Sch ${m[1]}`
    else if ((m = seg.match(/^ch\.(.+)$/))) s += `Ch ${m[1]} `
    else if ((m = seg.match(/^pt\.(.+)$/))) s += `Pt ${m[1]} `
    else if (seg === 'dict') s += 'Dictionary'
  }
  if (p.local_id.includes('#')) s += ' (table)'
  return `${inst} ${s.trim()}`
}

/** the website anchor: a table cell's anchor is its clause's (cells are not anchored on the site) */
export const anchorOf = (local_id: string) => local_id.split('#')[0]!
export const urlOf = (sourceUrl: string | null | undefined, local_id: string) => sourceUrl ? `${sourceUrl}#${anchorOf(local_id)}` : null

/**
 * A citation as a model or an engine writes it -> the instrument kind and the local ids it may mean, most specific
 * first ("Housing SEPP 2021 s 168(2)(e)" -> sepp: sec.168-ssec.2-para1.e, sec.168-ssec.2, sec.168).
 */
export function refToLocal(ref: string, hint?: 'lep' | 'sepp'): { kind: 'lep' | 'sepp'; ids: string[] } | null {
  const raw = ref
  const r = ref.replace(/\((Housing)\)/i, '$1').replace(/\b(19|20)\d{2}\b/g, ' ')
  const kind: 'lep' | 'sepp' = /housing|sepp|policy/i.test(raw) ? 'sepp' : /randwick|lep|plan\b/i.test(raw) ? 'lep' : (hint ?? 'lep')
  const zone = r.match(/Land Use Table.*?\b(R\d|RE\d|E\d|SP\d|C\d|MU\d|IN\d|RU\d|W\d)\b/i)
  if (zone && kind === 'lep') return { kind, ids: [`pt-cg1.Zone_${zone[1]!.toUpperCase()}`] }
  const sch = r.match(/\bSch(?:edule)?\.?\s*(\d+[A-Z]?)(?:[,\s]+(?:s|section|cl|clause)\.?\s*(\d+[A-Z]?))?((?:\s*\(\w{1,4}\))*)/i)
  if (sch) {
    const base = sch[2] ? `sch.${sch[1]}-sec.${sch[2]}` : `sch.${sch[1]}`
    const parts = [...(sch[3] ?? '').matchAll(/\((\w+)\)/g)].map(x => x[1]!)
    const ids = [base]; if (parts[0]) ids.push(`${base}-ssec.${parts[0]}`); if (parts[1]) ids.push(`${ids[1]}-para1.${parts[1]}`)
    return { kind, ids: ids.reverse() }
  }
  const m = r.match(/(?:cl(?:ause)?|s(?:ection)?|§)?\.?\s*(\d+(?:\.\d+)*[A-Z]{0,3})((?:\s*\(\w{1,4}\))*)/i); if (!m) return null
  const parts = [...m[2]!.matchAll(/\((\w+)\)/g)].map(x => x[1]!)
  const ids = [`sec.${m[1]}`]
  if (parts[0]) ids.push(`${ids[0]}-ssec.${parts[0]}`)
  if (parts[1]) ids.push(`${ids[1]}-para1.${parts[1]}`)
  if (parts[2]) ids.push(`${ids[2]}-para2.${parts[2]}`)
  return { kind, ids: ids.reverse() }
}

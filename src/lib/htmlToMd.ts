/*
  Pasted rich text (Word, Outlook, a web page) kept as Markdown, so bold, italic, links and
  lists survive into a Digest post (the user, 13 Oct).
*/
export function htmlToMd(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html')
  const walk = (n: Node): string => {
    if (n.nodeType === Node.TEXT_NODE) return (n.textContent ?? '').replace(/\s+/g, ' ')
    if (!(n instanceof HTMLElement)) return ''
    const inner = () => Array.from(n.childNodes).map(walk).join('')
    const st = n.getAttribute('style') ?? ''
    const tag = n.tagName
    if (tag === 'STYLE' || tag === 'SCRIPT' || tag === 'HEAD') return ''
    if (tag === 'BR') return '\n'
    if (tag === 'A') { const h = n.getAttribute('href') ?? ''; const t = inner().trim(); return /^https?:/.test(h) ? (t && t !== h ? `[${t}](${h})` : h) : t }
    const wrap = (m: string) => { const t = inner(); const s = t.trim(); return s ? t.replace(s, m + s + m) : t }
    if (tag === 'B' || tag === 'STRONG' || /font-weight:\s*(bold|[6-9]00)/.test(st)) return wrap('**')
    if (tag === 'I' || tag === 'EM' || /font-style:\s*italic/.test(st)) return wrap('*')
    if (tag === 'LI') return '\n- ' + inner().trim()
    if (/^(P|DIV|H[1-6]|UL|OL|TR)$/.test(tag)) return '\n' + inner() + '\n'
    return inner()
  }
  return walk(doc.body).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

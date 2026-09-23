/* ==========================================================================
   Your Business build.

     node build.mjs

   1. Copies site/ to dist/ as it is committed.
   2. With TUSK_TOKEN set: downloads the site's published snapshot from Tusk
      (GET /api/published/<site>/snapshot?assets=1, bearer build token) and
      every photo and file it references into dist/assets/tusk/, rewrites the
      media URLs to that path, and keeps a copy at .tusk/published.json.
      Same logic as @tuskcms/sdk pull(), inlined so the site has no
      dependencies.
   3. Applies the snapshot onto every HTML page in dist/:

        <p   data-tusk="home.eyebrow">        text  -> the element's text
        <p   data-tusk="home.lead">           textarea -> paragraphs
        <img data-tusk="home.photos">         photos -> src (first photo), alt
        <a   data-tusk="home.brochure">       file  -> href (an upload, or a link)
        <div data-tusk-list="work.projects">  list  -> the first [data-tusk-item] is the
             [data-tusk-item] [data-tusk-field=…]     template, cloned per entry
        <div data-tusk-photos="home.photos" data-tusk-skip="1">
                                              build-only: the first child is the template,
                                              cloned per photo after the first `skip`

      The data-tusk marks stay in the output so the Tusk editor's overlay
      can find them on the live page.

   Without TUSK_TOKEN the committed HTML is the site (step 1 only), so a
   build never fails because Tusk was unreachable.

   Environment: TUSK_SITE (default your-site), TUSK_TOKEN, TUSK_URL
   (default https://tuskcms.com). Node 18+, no dependencies.
   ========================================================================== */

import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(here, 'site')
const DIST = path.join(here, 'dist')
const ASSETS = path.join(DIST, 'assets', 'tusk')
const PUBLIC_PATH = '/assets/tusk'

const SITE = process.env.TUSK_SITE || 'your-site'
const TOKEN = process.env.TUSK_TOKEN || ''
const BASE = (process.env.TUSK_URL || 'https://tuskcms.com').replace(/\/+$/, '')

const log = (l) => console.log(l)

/* ---------- pull ---------------------------------------------------------- */

const basenameOf = (u) => { if (!u) return ''; try { return decodeURIComponent(u.split('?')[0].split('#')[0].split('/').pop() || '') } catch { return '' } }
const safeName = (name) => path.basename(name).replace(/[\x00-\x1f<>:"|?*\\/]/g, '_')

async function fetchJSON(url) {
  let r
  try { r = await fetch(url, { headers: { authorization: `Bearer ${TOKEN}`, accept: 'application/json' } }) }
  catch (e) { throw new Error(`Could not reach Tusk at ${url}: ${e.message}`) }
  const text = await r.text()
  let body = null
  try { body = JSON.parse(text) } catch { /* not JSON */ }
  if (!r.ok) {
    if (r.status === 401) throw new Error('Tusk refused the request (401). Check TUSK_TOKEN.')
    if (r.status === 404) throw new Error('Tusk answered 404: the slug or the build token is wrong. Check TUSK_SITE and TUSK_TOKEN.')
    throw new Error(`Tusk answered ${r.status}${body?.error ? ': ' + body.error : ''}.`)
  }
  if (!body || typeof body !== 'object') throw new Error(`Tusk answered with something that is not JSON from ${url}.`)
  return body
}

const sameSize = async (file, size) => { if (!size) return false; try { return (await stat(file)).size === size } catch { return false } }

async function pull() {
  const feed = await fetchJSON(`${BASE}/api/published/${encodeURIComponent(SITE)}/snapshot?assets=1`)
  const { assets = [], stored, ...snapshot } = feed
  if (!snapshot.pages) throw new Error('The snapshot has no pages. Has the site been published?')
  log(`tusk: ${snapshot.site?.name || SITE} · ${Object.keys(snapshot.pages).length} pages · ${Object.keys(snapshot.media || {}).length} media${stored === false ? ' (live view; publish once to store a snapshot)' : ''}`)

  if (assets.length) await mkdir(ASSETS, { recursive: true })
  const written = new Map()
  const failed = []
  let downloaded = 0, skipped = 0
  for (const a of assets) {
    const name = safeName(a.filename)
    if (!name) continue
    const dest = path.join(ASSETS, name)
    if (await sameSize(dest, a.size)) { skipped++; written.set(a.filename, name); continue }
    try {
      const r = await fetch(a.url, { headers: { authorization: `Bearer ${TOKEN}` } })
      if (!r.ok) throw new Error(String(r.status))
      await writeFile(dest, new Uint8Array(await r.arrayBuffer()))
      written.set(a.filename, name)
      downloaded++
    } catch (e) { failed.push(`${a.filename} (${e.message})`) }
  }

  let rewritten = 0
  for (const m of Object.values(snapshot.media || {})) {
    for (const key of ['url', 'thumb', 'card', 'hero']) {
      const u = m[key]
      if (!u) continue
      const name = written.get(basenameOf(u))
      if (name) { m[key] = `${PUBLIC_PATH}/${encodeURIComponent(name)}`; rewritten++ }
    }
  }
  const out = { ...snapshot, pulled: { at: new Date().toISOString(), from: BASE, assets: written.size, publicPath: PUBLIC_PATH } }
  await mkdir(path.join(here, '.tusk'), { recursive: true })
  await writeFile(path.join(here, '.tusk', 'published.json'), JSON.stringify(out, null, 2))
  /* Served at /assets/tusk/build.json so Tusk can confirm the site is serving this publish. */
  await mkdir(ASSETS, { recursive: true })
  await writeFile(path.join(ASSETS, 'build.json'), JSON.stringify({ site: snapshot.site && snapshot.site.slug, publishedAt: snapshot.publishedAt || null, snapshotAt: snapshot.snapshotAt || null, builtAt: out.pulled.at }))
  log(`tusk: ${downloaded} file${downloaded === 1 ? '' : 's'} downloaded, ${skipped} already there, ${rewritten} URLs rewritten -> .tusk/published.json`)
  for (const f of failed) log(`tusk: could not fetch ${f}`)
  return out
}

/* ---------- reading the snapshot ------------------------------------------ */

const walk = (root, parts) => { let cur = root; for (const p of parts) { if (cur === null || cur === undefined || typeof cur !== 'object') return undefined; cur = cur[p] } return cur }
const fieldValue = (snap, ref) => { const [key, ...rest] = ref.split('.'); const p = snap.pages?.[key]; return p && rest.length ? walk(p.content, rest) : undefined }
const fieldKind = (snap, ref) => { const [key, id] = ref.split('.'); const p = snap.pages?.[key]; const specs = snap.schema?.pages?.[key]?.fields || snap.schema?.pages?.[p?.kind]?.fields || []; return specs.find((f) => f.id === id)?.kind }
const mediaOf = (snap, id) => { if (id === null || id === undefined) return null; const raw = typeof id === 'object' ? id.id ?? id.photo : id; return snap.media?.[String(raw)] || null }
const isFileLink = (v) => !!v && typeof v === 'object' && !('id' in v) && typeof v.url === 'string' && /^https?:\/\/\S+$/i.test(v.url)

/* a photos value -> [{ media, alt }] in order; missing ids skipped */
function photoList(snap, v) {
  if (!Array.isArray(v)) return []
  return v.map((e) => {
    const m = mediaOf(snap, e)
    if (!m) return null
    const alt = e && typeof e === 'object' && typeof e.alt === 'string' && e.alt ? e.alt : m.alt || ''
    return { media: m, alt }
  }).filter(Boolean)
}
const bestSrc = (m) => m.hero || m.card || m.url || ''

/* ---------- a very small HTML manipulator --------------------------------- */

const VOID = new Set(['img', 'br', 'hr', 'input', 'meta', 'link', 'source'])
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))

/* The element whose start tag begins at `start`: { start, tagEnd, end, tag,
   startTag, inner }. `end` is just past the closing tag; for a void element
   it equals tagEnd. Nested tags of the same name are counted. */
function elementAt(html, start) {
  const m = /^<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/.exec(html.slice(start))
  if (!m) return null
  const tag = m[1].toLowerCase()
  const tagEnd = start + m[0].length
  const base = { start, tagEnd, tag, startTag: m[0] }
  if (VOID.has(tag) || m[0].endsWith('/>')) return { ...base, end: tagEnd, inner: '' }
  const scan = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi')
  scan.lastIndex = tagEnd
  let depth = 1, c
  while ((c = scan.exec(html))) {
    if (c[1]) depth--; else if (!c[0].endsWith('/>')) depth++
    if (depth === 0) return { ...base, end: c.index + c[0].length, inner: html.slice(tagEnd, c.index) }
  }
  return { ...base, end: html.length, inner: html.slice(tagEnd) }
}

/* The next element carrying `attr` at or after `from`, with that attribute's value as `value`. */
function nextElement(html, attr, from = 0) {
  const re = new RegExp(`<[a-zA-Z][a-zA-Z0-9-]*\\b[^>]*?\\s${attr}(?:=("[^"]*"|'[^']*'))?[\\s/>]`, 'g')
  re.lastIndex = from
  const m = re.exec(html)
  if (!m) return null
  const el = elementAt(html, m.index)
  return el ? { ...el, value: m[1] ? m[1].slice(1, -1) : '' } : null
}

/* The first element child inside `inner`. */
function firstChild(inner) {
  const i = inner.search(/<[a-zA-Z]/)
  return i < 0 ? null : elementAt(inner, i)
}

function setAttr(startTag, name, value) {
  const re = new RegExp(`\\s${name}(?:=("[^"]*"|'[^']*'|[^\\s>]*))?(?=[\\s>/])`, 'i')
  const attr = value === null ? '' : ` ${name}="${esc(value)}"`
  if (re.test(startTag)) return startTag.replace(re, attr)
  return startTag.replace(/\s*\/?>$/, (t) => attr + t)
}

/* Replace element `el` with `startTag + inner + close`. */
const rebuild = (html, el, startTag, inner) =>
  html.slice(0, el.start) + startTag + (el.end === el.tagEnd ? '' : inner + html.slice(el.end - (`</${el.tag}>`.length), el.end)) + html.slice(el.end)

/* ---------- applying values -------------------------------------------- */

const paragraphs = (v) => String(v ?? '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean)

/* One marked element and one value. Returns the new outer HTML, or null to leave it. */
function fill(el, kind, value, snap) {
  const { tag } = el
  let startTag = el.startTag
  if (kind === 'photos' || (kind === undefined && tag === 'img')) {
    const first = photoList(snap, value)[0]
    if (!first) return null
    startTag = setAttr(setAttr(startTag, 'src', bestSrc(first.media)), 'alt', first.alt)
    return startTag
  }
  if (kind === 'photo') {
    const m = mediaOf(snap, value)
    if (!m) return null
    return setAttr(setAttr(startTag, 'src', bestSrc(m)), 'alt', m.alt || '')
  }
  if (kind === 'file' || (kind === undefined && tag === 'a' && value && typeof value === 'object')) {
    /* a link to a file kept elsewhere goes straight into the href; an upload is a local asset */
    if (isFileLink(value)) return setAttr(setAttr(startTag, 'href', value.url), 'download', null) + el.inner + `</${tag}>`
    const m = mediaOf(snap, value)
    if (!m || !m.url) return null
    return setAttr(setAttr(startTag, 'href', m.url), 'download', m.filename || '') + el.inner + `</${tag}>`
  }
  if (value === undefined || value === null) return null
  if (typeof value !== 'string') return null
  if (kind === 'textarea' || (kind === undefined && /\n\s*\n/.test(value))) {
    const ps = paragraphs(value)
    const inner = tag === 'p' || tag === 'span' || /^h[1-6]$/.test(tag) ? ps.map(esc).join('<br><br>') : ps.map((p) => `<p>${esc(p)}</p>`).join('\n')
    return startTag + inner + `</${tag}>`
  }
  return startTag + esc(value) + (VOID.has(tag) ? '' : `</${tag}>`)
}

/* the page this file stands for, when a mark is a bare field name */
function pageKeyOf(html, rel) {
  const body = html.match(/<body\b[^>]*\sdata-tusk-page=("[^"]*"|'[^']*')/i)
  if (body) return body[1].slice(1, -1).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'home'
  const p = rel.replace(/\\/g, '/').replace(/index\.html$/, '').replace(/\.html$/, '').replace(/^\/+|\/+$/g, '')
  return p ? p.replace(/\//g, '-') : 'home'
}
const qualify = (ref, page) => (ref.includes('.') ? ref : `${page}.${ref}`)

/* Fill the sub-fields of one list item's HTML from one entry. */
function fillItem(itemHtml, entry, subKinds, snap) {
  let out = itemHtml, pos = 0, el
  while ((el = nextElement(out, 'data-tusk-field', pos))) {
    const sub = el.value.trim().replace(/[^A-Za-z0-9_]/g, '_')
    const kind = subKinds[sub] || (el.tag === 'img' ? 'photo' : undefined)
    const v = entry?.[sub]
    const next = kind === 'photo' ? fill(el, 'photo', v, snap) : fill(el, kind, v === undefined || v === null ? '' : v, snap)
    if (next === null) { pos = el.tagEnd; continue }
    out = out.slice(0, el.start) + next + out.slice(el.end)
    pos = el.start + next.length
  }
  return out
}

function applyLists(html, snap, page) {
  let pos = 0, el
  while ((el = nextElement(html, 'data-tusk-list', pos))) {
    const ref = qualify(el.value.trim(), page)
    const entries = fieldValue(snap, ref)
    if (!Array.isArray(entries)) { pos = el.tagEnd; continue }
    const [pageKey, fieldId] = ref.split('.')
    const specs = snap.schema?.pages?.[pageKey]?.fields || []
    const spec = specs.find((f) => f.id === fieldId)
    const subKinds = {}
    for (const s of spec?.fields || []) { if (Array.isArray(s)) subKinds[s[0]] = s[2]; else subKinds[s.id] = s.kind }

    /* the items inside this wrapper: first one is the template, all are replaced */
    const items = []
    let ip = 0, it
    while ((it = nextElement(el.inner, 'data-tusk-item', ip))) { items.push(it); ip = it.end }
    if (!items.length) { pos = el.tagEnd; continue }
    const first = items[0], last = items[items.length - 1]
    const template = el.inner.slice(first.start, first.end)
    const gap = items.length > 1 ? el.inner.slice(items[0].end, items[1].start) : '\n'
    const rendered = entries.map((e) => fillItem(template, e, subKinds, snap)).join(gap)
    const inner = el.inner.slice(0, first.start) + rendered + el.inner.slice(last.end)
    html = rebuild(html, el, el.startTag, inner)
    pos = el.start + el.startTag.length + inner.length
  }
  return html
}

function applyPhotoStrips(html, snap, page) {
  let pos = 0, el
  while ((el = nextElement(html, 'data-tusk-photos', pos))) {
    const ref = qualify(el.value.trim(), page)
    const value = fieldValue(snap, ref)
    if (!Array.isArray(value)) { pos = el.tagEnd; continue }
    const skip = Number((el.startTag.match(/\sdata-tusk-skip="(\d+)"/) || [])[1] || 0)
    const list = photoList(snap, value).slice(skip)
    /* the template is the wrapper's first element child; its <img> takes each photo */
    const tplEl = firstChild(el.inner)
    if (!tplEl) { pos = el.tagEnd; continue }
    const template = el.inner.slice(tplEl.start, tplEl.end)
    const rendered = list.map((p) => {
      const img = nextElement(template, 'src', 0)
      if (!img) return template
      return template.slice(0, img.start) + setAttr(setAttr(img.startTag, 'src', bestSrc(p.media)), 'alt', p.alt) + template.slice(img.end)
    }).join('\n')
    const inner = '\n' + rendered + '\n'
    html = rebuild(html, el, el.startTag, inner)
    pos = el.start + el.startTag.length + inner.length
  }
  return html
}

function applyMarks(html, snap, page) {
  let pos = 0, el
  while ((el = nextElement(html, 'data-tusk', pos))) {
    const ref = qualify(el.value.trim(), page)
    const value = fieldValue(snap, ref)
    let kind = fieldKind(snap, ref)
    const forced = (el.startTag.match(/\sdata-tusk-kind="([a-z]+)"/) || [])[1]
    if (!kind && forced) kind = forced
    const next = fill(el, kind, value, snap)
    if (next === null) { pos = el.tagEnd; continue }
    html = html.slice(0, el.start) + next + html.slice(el.end)
    pos = el.start + next.length
  }
  return html
}

export function apply(html, snap, rel = 'index.html') {
  const page = pageKeyOf(html, rel)
  html = applyLists(html, snap, page)
  html = applyPhotoStrips(html, snap, page)
  html = applyMarks(html, snap, page)
  return html
}

/* ---------- run ----------------------------------------------------------- */

async function htmlFiles(dir, out = []) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await htmlFiles(p, out)
    else if (e.name.endsWith('.html')) out.push(p)
  }
  return out
}

async function main() {
  await rm(DIST, { recursive: true, force: true })
  await cp(SRC, DIST, { recursive: true })
  log(`build: copied site/ -> dist/`)

  if (!TOKEN) {
    log('build: no TUSK_TOKEN, so the committed HTML is the site. Set TUSK_SITE, TUSK_TOKEN and TUSK_URL to pull from Tusk.')
    return
  }
  const snap = await pull()
  let n = 0
  for (const file of await htmlFiles(DIST)) {
    const rel = path.relative(DIST, file)
    const before = await readFile(file, 'utf8')
    const after = apply(before, snap, rel)
    if (after !== before) { await writeFile(file, after); n++ }
  }
  log(`build: ${n} page${n === 1 ? '' : 's'} filled from Tusk (${snap.site?.name || SITE}, published ${snap.publishedAt || 'never'})`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error('build failed:', e.message); process.exit(1) })
}

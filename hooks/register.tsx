import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderElement, SessionUsage } from 'claude-code'

import type {
  Statuspane,
  StatuspaneCompact as Compact,
  StatuspaneFigures as Figures,
  StatuspaneLimit as Limit,
  StatuspanePrefs as Prefs,
  StatuspaneRow as Row,
  StatuspaneState as State,
} from '../types'

const EMPTY: Figures = { dir: null, branch: null, model: null, effort: null, progress: [] }
export const DEFAULT_PREFS: Prefs = {
  model: true, ctx: true, limits: true, eta: true, location: true, cost: true, progress: true,
  ciBranch: false, ciPush: false, barWidth: 12, // CI calls GitHub through `gh`: off until asked for
}
const figures = atom({ plugin: 'statuspane', key: 'figures' } as const, EMPTY)
const isHidden = atom({ plugin: 'statuspane', key: 'isHidden' } as const, false)
const prefs = atom({ plugin: 'statuspane', key: 'prefs' } as const, DEFAULT_PREFS)
const isSettingsOpen = atom({ plugin: 'statuspane', key: 'isSettingsOpen' } as const, false)
const compactAsk = atom({ plugin: 'statuspane', key: 'compact' } as const, null)

const CARD_WIDTH = 34 // inside the border, at least; a wider line widens the card
const MAX_CARD_WIDTH = 50
const MIN_COLUMNS = 70 // narrower than this the card would cover too much; draw nothing
// Right of the first line, after a space: '● working', then the ' ⚙ ' and '▾ hide' buttons, each with room to click.
const HEAD_RIGHT = '● working'
const BUTTONS_WIDTH = HEAD_RIGHT.length + 2 + 3 + 1 + 6
const LIMIT_GAUGE = 5 // cells of each limit's gauge
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']
const PENDING = '—'
const CONFIRM_MS = 5_000 // a pressed ⟲ compact waits this long for the press that confirms it
const COMPACT_MAX_MS = 600_000 // a compaction still marked running after this was lost (a reload mid-run)
const HIDDEN_RIGHT_PAD = 5 // clear of Claude Code's own [-] panel toggle, drawn at the band's top right
const BAR_MIN = 6
const BAR_MAX = 24
const MAX_PROGRESS_ROWS = 5
const MAX_PROGRESS_FILES = 20 // the newest by mtime; older, stale files fall out of the window
const MAX_PROGRESS_BYTES = 65_536 // fields are cut to length after reading, so a long text only shortens
const MAX_API_REPORTS = 20
const DEFAULT_TTL = 300
const PROGRESS_POLL_MS = 1_000 // no file watcher in the mod API: poll, re-reading only files whose mtime or size moved
const PROGRESS_DIR_DEFAULT = '.claude/statuspane/progress' // under the home folder
const CI_TICK_MS = 5_000 // how often the CI poller looks for a target that is due
const CI_IDLE_MS = 60_000 // a target whose runs are done
const CI_BUSY_MS = 10_000 // a target whose runs are under way, or a push waiting for its runs
const CI_WAIT_MS = 180_000 // a push whose runs have not shown by then is let go
const CI_LINGER_MS = 600_000 // a push's finished result stays this long
const CI_SKEW_MS = 60_000 // GitHub's clock against ours, when telling a push's runs from older ones

export const STRINGS = {
  settings: 'Status settings', model: 'Model · effort', ctx: 'Context bar', limits: '5h / week limits',
  eta: 'Reset countdowns', location: 'Directory · branch', cost: 'Session cost', progress: 'Progress rows',
  ciBranch: 'CI · this branch', ciPush: 'CI · after a push',
  bar: 'Bar width', done: '✓ Done', hide: '▾ hide', show: '◂ status',
  hidden: 'Status card hidden.', shown: 'Status card shown.',
  tooNarrow: 'Status card shown; it draws once the terminal is at least 70 columns wide.',
} as const

type Switch = Exclude<keyof Prefs, 'barWidth'>
// The settings page's switches, in the card's order.
export const SWITCHES: Switch[] = ['model', 'ctx', 'limits', 'eta', 'location', 'cost', 'progress', 'ciBranch', 'ciPush']

// `press` makes the part a button: the one the card has in its lines, ⟲ compact.
export type Part = { text: string; color?: string; dim?: boolean; bold?: boolean; press?: 'compact' }

// Claude Code's own colors, by theme key, so the card follows the person's theme: the accent, then the
// theme's warning and error past a classic statusline script's thresholds.
const levelColor = (pct: number, warnAt: number, errAt: number) => (pct >= errAt ? 'error' : pct >= warnAt ? 'warning' : 'claude')
export const usedColor = (pct: number) => levelColor(pct, 60, 85)
const ctxColor = (pct: number) => levelColor(pct, 50, 80)

// Emoji below the emoji block that terminals draw two columns wide (East Asian Width W): ⌛ ⚡ ✅ ❌ ⭐ …
const EMOJI_WIDE: [number, number][] = [
  [0x231a, 0x231b], [0x23e9, 0x23ec], [0x23f0, 0x23f0], [0x23f3, 0x23f3], [0x25fd, 0x25fe], [0x2614, 0x2615],
  [0x2648, 0x2653], [0x267f, 0x267f], [0x2693, 0x2693], [0x26a1, 0x26a1], [0x26aa, 0x26ab], [0x26bd, 0x26be],
  [0x26c4, 0x26c5], [0x26ce, 0x26ce], [0x26d4, 0x26d4], [0x26ea, 0x26ea], [0x26f2, 0x26f3], [0x26f5, 0x26f5],
  [0x26fa, 0x26fa], [0x26fd, 0x26fd], [0x2705, 0x2705], [0x270a, 0x270b], [0x2728, 0x2728], [0x274c, 0x274c],
  [0x274e, 0x274e], [0x2753, 0x2755], [0x2757, 0x2757], [0x2795, 0x2797], [0x27b0, 0x27b0], [0x27bf, 0x27bf],
  [0x2b1b, 0x2b1c], [0x2b50, 0x2b50], [0x2b55, 0x2b55],
]

// Terminal columns a string takes: East Asian wide and fullwidth characters and emoji take two.
// lazy: range table, not full Unicode East Asian Width; upgrade to a generated table if a script draws wrong.
export const cols = (s: string) => {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd) ||
      (c >= 0x231a && c <= 0x2b55 && EMOJI_WIDE.some(([lo, hi]) => c >= lo && c <= hi))
    n += wide ? 2 : 1
  }
  return n
}

// Cut text to `max` columns, keeping its end ("…tail") or its start ("head…").
export const fit = (s: string, max: number, keep: 'end' | 'start' = 'start') => {
  if (cols(s) <= max) return s
  const chars = [...s]
  const out: string[] = []
  let n = 1 // the ellipsis
  for (const ch of keep === 'end' ? chars.reverse() : chars) {
    if (n + cols(ch) > max) break
    n += cols(ch)
    out.push(ch)
  }
  return keep === 'end' ? `…${out.reverse().join('')}` : `${out.join('')}…`
}

// A long directory keeps its last segments: "~/Desktop/a/b/project" -> "…/b/project".
export const shortDir = (dir: string, max = 20) => {
  if (cols(dir) <= max) return dir
  const segs = dir.split('/')
  let tail = segs.pop() ?? ''
  if (cols(tail) + 2 > max) return fit(tail, max, 'end')
  while (segs.length && cols(`…/${segs[segs.length - 1]}/${tail}`) <= max) tail = `${segs.pop()}/${tail}`
  return `…/${tail}`
}

// Untrusted text from progress files and other mods: no control, escape or bidi characters, bounded length.
// C0/C1 controls (escape included), bidi marks and isolates, zero-width and line/paragraph separators.
const UNSAFE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u2028-\u202e\u2060-\u2069\ufeff]/g
export const clean = (v: unknown, max: number) =>
  typeof v === 'string' ? [...v.replace(UNSAFE, '')].slice(0, max).join('').trim() : ''

const ID = /^[A-Za-z0-9._-]{1,64}$/
const STATE_COLOR = { running: 'claude', ok: 'success', error: 'error' } as const
const isState = (v: unknown): v is State => typeof v === 'string' && Object.hasOwn(STATE_COLOR, v)

// A progress report as a row, or null when it is not one; `seenAt` is when it was written.
export const toRow = (raw: unknown, seenAt: number, fallbackId?: string): Row | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : fallbackId && ID.test(fallbackId) ? fallbackId : null
  if (!id) return null
  const label = fit(clean(o.label, 64), 24) || id.slice(0, 24)
  const percent = typeof o.percent === 'number' && Number.isFinite(o.percent) ? Math.min(100, Math.max(0, o.percent)) : undefined
  const text = clean(o.text, 60) || undefined
  if (percent === undefined && !text) return null
  const ttl = typeof o.ttl === 'number' && Number.isFinite(o.ttl) ? Math.min(86_400, Math.max(5, o.ttl)) : DEFAULT_TTL
  const state = isState(o.state) ? o.state : undefined
  return { id, label, ...(percent !== undefined && { percent }), ...(text && { text }), ...(state && { state }), expiresAt: seenAt + ttl * 1000 }
}

// Stored prefs over the defaults: a key a later version added keeps its default, a bad value is dropped.
export const loadPrefs = (stored: unknown): Prefs => {
  const out: Prefs = { ...DEFAULT_PREFS }
  if (stored && typeof stored === 'object')
    for (const [k, v] of Object.entries(stored)) {
      if (k === 'barWidth' && typeof v === 'number') out.barWidth = Math.min(BAR_MAX, Math.max(BAR_MIN, Math.round(v)))
      else if ((SWITCHES as string[]).includes(k) && typeof v === 'boolean') out[k as Switch] = v
    }
  return out
}

export const fmtEta = (resetsAt: string | undefined, now: number) => {
  if (!resetsAt) return ''
  const s = Math.floor((Date.parse(resetsAt) - now) / 1000)
  if (!(s > 0)) return 'now'
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60)
  return d > 0 ? `${d}d${h}h` : `${h}h${m}m`
}

// A gauge as Claude Code draws one: ▰ used, ▱ left.
export const gauge = (pct: number, width: number) => {
  const on = Math.min(width, Math.max(0, Math.round((pct * width) / 100)))
  return { on: '▰'.repeat(on), off: '▱'.repeat(width - on) }
}
const gaugeParts = (pct: number, width: number, color: string): Part[] => {
  const g = gauge(pct, width)
  return [{ text: g.on, color }, { text: g.off, color: 'subtle' }]
}

// "claude-opus-5-5[1m]" -> "Opus 5.5 (1M)", "claude-opus-4-20250514" -> "Opus 4"; anything else as given.
export const prettyModel = (id: string) => {
  const m = /^claude-([a-z]+)-(\d{1,2})(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/.exec(id)
  if (!m || !m[1]) return id
  return `${m[1][0]?.toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? `.${m[3]}` : ''}${m[4] ? ' (1M)' : ''}`
}

// The usage figures, from session.measure's input or $.session.usage() alike.
export const fromUsage = (u: Pick<SessionUsage, 'context' | 'rateLimits' | 'cost'>): Partial<Figures> => {
  const find = (kind: string) => {
    const r = u.rateLimits.find(l => l.kind === kind)
    return r ? { pct: r.percentUsed, resetsAt: r.resetsAt } : undefined
  }
  return {
    ctxPct: u.context.percent,
    ctxTokens: u.context.tokens,
    ctxWindow: u.context.window,
    fiveHour: find('five_hour'),
    week: find('seven_day'),
    costUsd: u.cost?.usd,
  }
}

const limit = (label: string, l: Limit | undefined, now: number, showEta: boolean): Part[] => {
  if (!l) return [{ text: `${label} `, dim: true }, { text: PENDING, dim: true }]
  const eta = showEta ? fmtEta(l.resetsAt, now) : ''
  const color = usedColor(l.pct)
  return [
    { text: `${label} `, dim: true },
    ...gaugeParts(l.pct, LIMIT_GAUGE, color),
    { text: ` ${Math.round(l.pct)}%`, ...(color === 'claude' ? { dim: true } : { color }) },
    ...(eta ? [{ text: ` ↻${eta}`, dim: true }] : []),
  ]
}

const progressLine = (r: Row, barWidth: number): Part[] => {
  const color = r.state && STATE_COLOR[r.state]
  // The gauge gives way before ' 100%' would pass the widest card.
  const width = Math.max(4, Math.min(barWidth, MAX_CARD_WIDTH - cols(r.label) - 1 - 5))
  return [
    { text: `${r.label} `, dim: true },
    ...(r.percent !== undefined ? [...gaugeParts(r.percent, width, color ?? 'claude'), { text: ` ${Math.round(r.percent)}%` }] : []),
    ...(r.text ? [{ text: r.percent !== undefined ? ` ${r.text}` : r.text, color }] : []),
  ]
}

// The button's state as it stands at `now`: an arming or a run past its limit (lost to a reload, or a clock
// set back) counts as none, so the button never sticks and a lone press never compacts.
export const compactNow = (c: Compact, now: number): 'armed' | 'running' | null => {
  if (!c || now < c.at) return null
  return now - c.at < (c.state === 'armed' ? CONFIRM_MS : COMPACT_MAX_MS) ? c.state : null
}

// The ⟲ compact button after the context gauge: a press arms it, a second runs /compact.
const compactParts = (state: 'armed' | 'running' | null): Part[] =>
  state === 'running' ? [{ text: '  ⟲ compacting…', color: 'claude' }]
  : state === 'armed' ? [{ text: '  ' }, { text: '⟲ ', color: 'warning' }, { text: 'confirm', press: 'compact' }]
  : [{ text: '  ' }, { text: '⟲ compact', dim: true, press: 'compact' }]

// "effort ▮▮▮▯▯ high"; a level it does not know, as a word alone.
const effortLine = (effort: string): Part[] => {
  const n = EFFORTS.indexOf(effort) + 1
  return [
    { text: 'effort ', dim: true },
    ...(n ? [{ text: `${'▮'.repeat(n)}${'▯'.repeat(EFFORTS.length - n)} `, color: 'claude' }] : []),
    { text: effort, color: 'claude', bold: true },
  ]
}

// Pure: the card's lines, each a run of colored parts, as the prefs pick them.
export const cardLines = (f: Figures, now: number, p: Prefs = DEFAULT_PREFS, compact: Compact = null): Part[][] => {
  const sep: Part = { text: ' · ', dim: true }
  const lines: Part[][] = []
  if (p.model) {
    lines.push([{ text: f.model ? prettyModel(f.model) : PENDING, color: 'claude', bold: true }])
    if (f.effort) lines.push(effortLine(f.effort))
  }
  if (p.ctx) {
    if (f.ctxPct !== undefined) {
      const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
      const tokens = f.ctxTokens !== undefined && f.ctxWindow ? ` ${k(f.ctxTokens)}/${k(f.ctxWindow)}` : ''
      const ctx: Part[] = [{ text: 'ctx ', dim: true }, ...gaugeParts(f.ctxPct, p.barWidth, ctxColor(f.ctxPct)), { text: ` ${Math.round(f.ctxPct)}%`, bold: true }]
      const button = compactParts(compactNow(compact, now))
      // The button stays whole: past the widest card, the tokens give way.
      const withTokens = [...ctx, { text: tokens, dim: true }, ...button]
      lines.push(lineWidth(withTokens) <= MAX_CARD_WIDTH ? withTokens : [...ctx, ...button])
    } else lines.push([{ text: 'ctx ', dim: true }, { text: gauge(0, p.barWidth).off, color: 'subtle' }, { text: ` ${PENDING}`, dim: true }])
  }
  if (p.limits) lines.push([...limit('5h', f.fiveHour, now, p.eta), { text: '   ' }, ...limit('7d', f.week, now, p.eta)])
  const place: Part[][] = [
    ...(p.location ? [[{ text: f.dir ? shortDir(f.dir) : PENDING }]] : []),
    ...(p.location && f.branch ? [[{ text: `⎇ ${fit(f.branch, 16)}` }]] : []),
    ...(p.cost && f.costUsd !== undefined ? [[{ text: `$${f.costUsd.toFixed(2)}` }]] : []),
  ]
  if (place.length) lines.push(place.flatMap((parts, n) => (n > 0 ? [sep, ...parts] : parts)))
  if (p.progress)
    for (const r of f.progress.filter(r => r.expiresAt > now).slice(0, MAX_PROGRESS_ROWS)) lines.push(progressLine(r, p.barWidth))
  return lines
}

export const lineWidth = (parts: Part[]) => parts.reduce((n, p) => n + cols(p.text), 0)

// The card's inner width and where the buttons go: beside the first line, or on a row of their own
// above it when that line and the buttons together would pass the widest card.
export const layout = (lines: Part[][]) => {
  const first = lineWidth(lines[0] ?? [])
  const buttonsOwnRow = lines.length > 0 && first + BUTTONS_WIDTH > MAX_CARD_WIDTH
  const width = Math.min(MAX_CARD_WIDTH, Math.max(CARD_WIDTH, ...lines.map(lineWidth), buttonsOwnRow ? BUTTONS_WIDTH : first + BUTTONS_WIDTH))
  return { width, buttonsOwnRow }
}
export const cardWidth = (lines: Part[][]) => layout(lines).width

type Entry = { name: string; kind: string; size: number; mtimeMs: number }

// The progress files worth reading: *.json, not oversized, newest first, at most MAX_PROGRESS_FILES.
export const pickFiles = <E extends Entry>(entries: readonly E[]): E[] =>
  entries
    .filter(f => f.kind === 'file' && f.name.endsWith('.json') && f.size <= MAX_PROGRESS_BYTES)
    .sort((a, b) => b.mtimeMs - a.mtimeMs || a.name.localeCompare(b.name))
    .slice(0, MAX_PROGRESS_FILES)

// Live rows from both sources (a mod's report wins over a file of the same id), by id, at most MAX_PROGRESS_ROWS.
export const mergeRows = (fileRows: readonly Row[], apiRows: readonly Row[], now: number): Row[] => {
  const rows = new Map<string, Row>()
  for (const r of [...fileRows, ...apiRows]) if (r.expiresAt > now) rows.set(r.id, r)
  return [...rows.values()].sort((a, b) => a.id.localeCompare(b.id)).slice(0, MAX_PROGRESS_ROWS)
}

// The progress folder: STATUSPANE_PROGRESS_DIR (absolute, or starting with ~), else ~/.claude/statuspane/progress.
export const resolveDir = (custom: string | undefined, home: string | undefined) => {
  const expand = (p: string) => (p === '~' || p.startsWith('~/') ? (home ? `${home}${p.slice(1)}` : null) : p)
  const isAbsolute = (p: string) => p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith('\\\\')
  const dir = custom ? expand(custom) : null
  if (dir && isAbsolute(dir)) return dir
  return home ? `${home}/${PROGRESS_DIR_DEFAULT}` : null
}

// Rows other mods reported through $.statuspane, stamped with an expiry on the next poll.
// lazy: module state, so a reload of this mod forgets them until their sources report again.
const apiReports = new Map<string, { raw: unknown; row: Row | null }>()
const fileCache = new Map<string, { mtimeMs: number; size: number; row: Row | null }>()
// What the band last drew at, so /statuspane can say when the card cannot show.
let lastBand = { columns: Infinity, hasSurvey: false }

async function progressDir($: EngineInterface) {
  const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
  return resolveDir(await $.env.get('STATUSPANE_PROGRESS_DIR'), home)
}

// Never rejects: a missing, unreadable or vanishing folder just means no file rows this poll.
async function readProgress($: EngineInterface) {
  try {
    const now = await $.clock.now()
    const fileRows: Row[] = []
    const dir = await progressDir($)
    const exists = dir ? await $.fs.exists(dir).catch(() => false) : false // a missing folder is the usual case: no log line each second
    const entries = dir && exists ? await $.fs.list(dir).catch(() => []) : []
    const files = pickFiles(entries)
    for (const f of files) {
      let hit = fileCache.get(f.name)
      if (!hit || hit.mtimeMs !== f.mtimeMs || hit.size !== f.size) {
        const raw = await $.fs.read(`${dir}/${f.name}`).then(t => JSON.parse(t) as unknown).catch(() => null)
        hit = { mtimeMs: f.mtimeMs, size: f.size, row: toRow(raw, f.mtimeMs, f.name.slice(0, -'.json'.length)) }
        fileCache.set(f.name, hit)
      }
      if (hit.row) fileRows.push(hit.row)
    }
    for (const name of fileCache.keys()) if (!files.some(f => f.name === name)) fileCache.delete(name)
    const apiRows: Row[] = []
    for (const [id, report] of apiReports) {
      report.row ??= toRow(report.raw, now, id)
      if (report.row && report.row.expiresAt > now) apiRows.push(report.row)
      else apiReports.delete(id)
    }
    const progress = mergeRows(fileRows, [...apiRows, ...ciRows.values()], now)
    const before = (await read($, figures)).progress
    if (JSON.stringify(before) !== JSON.stringify(progress)) await update($, figures, f => ({ ...f, progress }))
  } catch {
    // lazy: swallowed silently; a debug line would help a user whose rows never show.
  }
}

// Never rejects; runs off the turn's path (callers do not await it).
// ⟲ compact: the first press arms it for CONFIRM_MS, the second runs /compact as if typed (queued until the
// turn ends, when Claude is working). Clearing the context gauge is the session.compact hook's. One press is
// handled at a time, so a double press never compacts twice.
let compactBusy = false
async function pressCompact($: EngineInterface) {
  if (compactBusy) return
  compactBusy = true
  try {
    const now = await $.clock.now()
    const state = compactNow(await read($, compactAsk), now)
    if (state === 'running') return
    if (state !== 'armed') {
      await update($, compactAsk, () => ({ state: 'armed', at: now }))
      // Redraws the button once the arming lapses; were this timer lost, the arming still reads as lapsed.
      $.clock.after(CONFIRM_MS, () => void update($, compactAsk, c => (c?.state === 'armed' && c.at === now ? null : c)))
      return
    }
    await update($, compactAsk, () => ({ state: 'running', at: now }))
    try {
      await $.command.run({ command: 'compact', args: '' })
    } catch (err) {
      $.ui.toast(`Could not compact: ${clean(err instanceof Error ? err.message : String(err), 120)}`)
    } finally {
      await update($, compactAsk, () => null)
    }
  } finally {
    compactBusy = false
  }
}

async function refresh($: EngineInterface) {
  try {
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
    const cwd = await $.session.cwd()
    const dir = clean(home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd, 400)
    const repo = await $.session.repo()
    const b = repo ? await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 3000 }).catch(() => null) : null
    const branch = (b && b.exitCode === 0 && clean(b.stdout, 200)) || null
    await update($, figures, f => ({ ...f, dir, branch }))
    const repoSlug = branch ? await repoHere($) : null
    ciHere = repoSlug && branch ? { repo: repoSlug, branch } : null
  } catch {
    // keep the last directory and branch
  }
}

// ---- CI: GitHub Actions runs, read through `gh` ----

export type Run = {
  databaseId: number; status: string; conclusion: string; workflowName: string
  headSha: string; createdAt: string; updatedAt: string; event: string
}
export type Job = { name: string; status: string; conclusion: string }
type Target = { repo: string; branch: string }
type Watch = Target & { since: number; endsAt: number; finishedAt?: number }

const RUN_FIELDS = 'databaseId,status,conclusion,workflowName,headSha,createdAt,updatedAt,event'
const FAILED = new Set(['failure', 'timed_out', 'startup_failure', 'action_required'])
const isDeploy = (job: string) => /deploy/i.test(job)

// "1m20s" for a run under way, "3m" for how long ago one finished.
export const fmtSpan = (ms: number, precise: boolean) => {
  const s = Math.max(0, Math.floor(ms / 1000)), m = Math.floor(s / 60), h = Math.floor(m / 60), d = Math.floor(h / 24)
  if (s < 60) return `${s}s`
  if (m < 60) return precise ? `${m}m${String(s % 60).padStart(2, '0')}s` : `${m}m`
  if (h < 24) return precise ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${h}h`
  return `${d}d`
}

// "owner/repo" for a github.com remote, "host/owner/repo" for another host; null when it is not one.
export const repoSlug = (url: string) => {
  const m = /^(?:https?:\/\/|ssh:\/\/)?(?:[^@/\s]+@)?([^/:\s]+)[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/.exec(url.trim())
  if (!m) return null
  const [, host, owner, name] = m
  return host === 'github.com' ? `${owner}/${name}` : `${host}/${owner}/${name}`
}

// The refs a `git push` updated, from its report: "abc..def  main -> main", "* [new branch]  x -> x".
export const pushedRefs = (output: string) =>
  // [ \t], never \s: \s spans lines, and on output of blank lines the pattern backtracks for minutes.
  [...output.matchAll(/^[ \t]*[+*]?[ \t]*(?:[0-9a-f]{4,}\.\.\.?[0-9a-f]{4,}|\[new (?:branch|tag)\])[ \t]+\S+[ \t]+->[ \t]+(\S+)/gm)].map(m => m[1] as string)

// The commit's runs on a branch: the newest commit's, scheduled and bot-dispatched runs left out.
// lazy: looks at the 40 newest runs; a branch where schedules crowd out a push needs a per-event query.
export const latestGroup = (runs: readonly Run[]) => {
  const own = runs.filter(r => r.event !== 'schedule' && r.event !== 'dynamic')
  const sha = own[0]?.headSha
  return own.filter(r => r.headSha === sha)
}

// Pure: one commit's runs, and their jobs, as a row's text and state.
export const ciSummary = (runs: readonly Run[], jobs: readonly Job[], now: number): { text: string; state?: State; busy: boolean } => {
  if (runs.some(r => r.status !== 'completed')) {
    const started = Math.min(...runs.map(r => Date.parse(r.createdAt)))
    const active = jobs.filter(j => j.status === 'in_progress').map(j => j.name)
    const what = active.some(isDeploy) ? 'deploying' : active.join(', ') || 'queued'
    return { text: `⟳ ${what} · ${fmtSpan(now - started, true)}`, state: 'running', busy: true }
  }
  const ago = `${fmtSpan(now - Math.max(...runs.map(r => Date.parse(r.updatedAt))), false)} ago`
  const failed = jobs.find(j => FAILED.has(j.conclusion))?.name ?? runs.find(r => FAILED.has(r.conclusion))?.workflowName
  if (failed) return { text: `✗ ${failed} failed · ${ago}`, state: 'error', busy: false }
  if (runs.every(r => r.conclusion === 'cancelled' || r.conclusion === 'skipped')) return { text: `⊘ cancelled · ${ago}`, busy: false }
  const deployed = jobs.some(j => isDeploy(j.name) && j.conclusion === 'success')
  return { text: `✓ ${deployed ? 'deployed' : 'passed'} · ${ago}`, state: 'ok', busy: false }
}

const ciKey = (t: Target) => `ci.${t.repo}.${t.branch}`.replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 64)

// The session's repo and branch (refresh sets it), pushes being followed, and the rows they draw.
let ciHere: Target | null = null
const ciWatches = new Map<string, Watch>()
const ciRows = new Map<string, Row>()
const ciDue = new Map<string, number>()
const jobsCache = new Map<string, Job[]>() // finished runs only, by id and update time
let ciBusy = false

// `gh … --json` as parsed JSON; null when gh is missing, signed out, offline or the repo is not on GitHub.
async function gh($: EngineInterface, args: string[]) {
  const r = await $.process.run(['gh', ...args], { timeoutMs: 15_000 }).catch(() => null)
  if (!r || r.exitCode !== 0) return null
  try {
    return JSON.parse(r.stdout) as unknown
  } catch {
    return null
  }
}

async function repoHere($: EngineInterface) {
  const r = await $.process.run(['git', 'remote', 'get-url', 'origin'], { timeoutMs: 3000 }).catch(() => null)
  return r && r.exitCode === 0 ? repoSlug(r.stdout) : null
}

async function runJobs($: EngineInterface, repo: string, runs: readonly Run[]) {
  const jobs: Job[] = []
  for (const run of runs) {
    const key = `${run.databaseId}:${run.updatedAt}`
    let got = run.status === 'completed' ? jobsCache.get(key) : undefined
    if (!got) {
      const view = (await gh($, ['run', 'view', String(run.databaseId), '-R', repo, '--json', 'jobs'])) as { jobs?: Job[] } | null
      got = Array.isArray(view?.jobs) ? view.jobs : []
      if (run.status === 'completed' && view) {
        if (jobsCache.size >= 50) jobsCache.delete(jobsCache.keys().next().value as string)
        jobsCache.set(key, got)
      }
    }
    jobs.push(...got)
  }
  return jobs
}

// Never rejects. Each target is polled when due: the branch the session is on (`ciBranch`) and the
// branches a push or merge in the session set off (`ciPush`), until their runs finish and linger.
async function pollCi($: EngineInterface) {
  if (ciBusy) return
  ciBusy = true
  try {
    const now = await $.clock.now()
    const p = await read($, prefs)
    if (!p.ciPush) ciWatches.clear()
    for (const [k, w] of ciWatches) if (w.endsAt <= now) ciWatches.delete(k)
    const here = p.ciBranch && ciHere ? ciHere : null
    const hereKey = here ? ciKey(here) : null
    const targets = new Map<string, Target>(ciWatches)
    if (here && hereKey) targets.set(hereKey, here)
    for (const k of [...ciRows.keys()]) if (!targets.has(k)) ciRows.delete(k)
    for (const [k, t] of targets) {
      if ((ciDue.get(k) ?? 0) > now) continue
      const w = ciWatches.get(k)
      const listed = await gh($, ['run', 'list', '-R', t.repo, '--branch', t.branch, '-L', '40', '--json', RUN_FIELDS])
      if (!Array.isArray(listed)) {
        ciDue.set(k, now + CI_IDLE_MS)
        continue
      }
      const runs = latestGroup(listed as Run[])
      const fresh = !!w && runs.some(r => Date.parse(r.createdAt) >= w.since - CI_SKEW_MS)
      if (!runs.length || (k !== hereKey && !fresh)) {
        ciRows.delete(k) // a push whose runs have not shown yet: nothing until they do
        ciDue.set(k, now + (w ? CI_BUSY_MS : CI_IDLE_MS))
        continue
      }
      const s = ciSummary(runs, await runJobs($, t.repo, runs), now)
      if (w && fresh) w.endsAt = s.busy ? now + CI_LINGER_MS : (w.finishedAt ??= now) + CI_LINGER_MS
      ciDue.set(k, now + (s.busy || (w && !fresh) ? CI_BUSY_MS : CI_IDLE_MS))
      const label = fit(`${t.repo.split('/').pop()} ${t.branch}`, 24)
      const row = toRow({ label, text: s.text, state: s.state, ttl: CI_LINGER_MS / 1000 }, now, k)
      if (row) ciRows.set(k, row)
    }
  } catch {
    // keep the last rows; they expire on their own if gh stays unreachable
  } finally {
    ciBusy = false
  }
}

// A Bash call that pushed or merged: follow the branches it set off. Never rejects.
async function followPush($: EngineInterface, command: string, output: string) {
  try {
    if (!(await read($, prefs)).ciPush) return
    const url = /github\.com\/([^/\s]+\/[^/\s]+)\/pull\/(\d+)/.exec(command)
    // The repo the push reported ("To github.com:o/r.git"), not the session's folder: a push may run elsewhere.
    const pushedTo = /^To (\S+)/m.exec(output)?.[1]
    const repo =
      url?.[1] ?? /(?:^|\s)(?:-R|--repo)[=\s]+(\S+)/.exec(command)?.[1] ?? (pushedTo && repoSlug(pushedTo)) ?? (await repoHere($))
    if (!repo) return
    const branches = /\bgit\b[^;&|]*\bpush\b/.test(command) ? pushedRefs(output) : []
    if (/\bgh\s+pr\s+merge\b/.test(command)) {
      const pr = url?.[2] ?? /\bgh\s+pr\s+merge\s+#?(\d+)/.exec(command)?.[1] ?? /#(\d+)/.exec(output)?.[1]
      const view = pr ? ((await gh($, ['pr', 'view', pr, '-R', repo, '--json', 'baseRefName'])) as { baseRefName?: string } | null) : null
      // lazy: an --auto merge lands after its checks, often past CI_WAIT_MS; then only ciBranch shows it.
      if (typeof view?.baseRefName === 'string') branches.push(view.baseRefName)
    }
    const now = await $.clock.now()
    for (const branch of new Set(branches)) {
      const k = ciKey({ repo, branch })
      ciWatches.set(k, { repo, branch, since: now, endsAt: now + CI_WAIT_MS })
      ciDue.delete(k)
    }
  } catch {
    // nothing followed
  }
}

export const register: Register = on => {
  // $.statuspane for other mods: progress({ id, label, percent?, text?, ttl? }) and clear(id).
  on('engine.create', async (_, e, next) => {
    const built = await next(e)
    const statuspane: Statuspane = {
      progress: async item => {
        const id = typeof item?.id === 'string' ? item.id : ''
        if (!ID.test(id)) return
        apiReports.delete(id) // re-insert last, so the oldest report is the one that goes at the cap
        if (apiReports.size >= MAX_API_REPORTS) apiReports.delete(apiReports.keys().next().value as string)
        apiReports.set(id, { raw: item, row: null })
      },
      clear: async id => {
        apiReports.delete(String(id))
      },
    }
    return { ...built, statuspane }
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'statuspane', description: 'Hide or show the status card' })
    await update($, compactAsk, () => null) // a press or a run the last module left behind (state outlives a reload)
    const stored = await $.store.get('prefs').catch(() => undefined)
    await update($, prefs, () => loadPrefs(stored))
    const model = await $.session.model()
    const usage = fromUsage(await $.session.usage())
    await update($, figures, f => ({ ...f, ...usage, model: model || null }))
    $.clock.every(30_000, () => void refresh($))
    $.clock.every(PROGRESS_POLL_MS, () => void readProgress($))
    $.clock.every(CI_TICK_MS, () => void pollCi($))
    void refresh($).then(() => pollCi($))
    void readProgress($)
    return next(e)
  })

  on('command.run', { command: 'statuspane' }, async $ => {
    const hidden = await update($, isHidden, h => !h)
    if (hidden) return { text: STRINGS.hidden }
    return { text: lastBand.columns < MIN_COLUMNS ? STRINGS.tooNarrow : STRINGS.shown }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId) void refresh($) // the branch may have moved; subagents' turns leave it be
    return result
  })

  // A push or merge Claude ran: its CI runs show until they finish (the `ciPush` switch).
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const result = await next(e)
    if (e.tool === 'Bash' && /\bgit\b[^;&|]*\bpush\b|\bgh\s+pr\s+merge\b/.test(e.command)) {
      const out = (result as { result?: { stdout?: unknown; stderr?: unknown } }).result
      void followPush($, e.command, `${out?.stdout ?? ''}\n${out?.stderr ?? ''}`).then(() => pollCi($))
    }
    return result
  })

  on('turn.step', async function* ($, e, next) {
    if (!e.agentId) {
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, figures, f => ({ ...f, model: e.model, effort }))
    }
    return yield* next(e)
  })

  on('session.measure', async ($, e, next) => {
    const usage = fromUsage(e)
    await update($, figures, f => ({ ...f, ...usage }))
    return next(e)
  })

  // A compaction empties the live window, and no measurement follows until the next response.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (!e.agentId && e.trigger !== 'precompute' && !result.skip)
      await update($, figures, f => ({ ...f, ctxPct: undefined, ctxTokens: undefined }))
    return result
  })

  // The band's rows hold the card at the right edge, just above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // The desktop app shows model, effort and context on its own, so the card is terminal-only there.
    if (e.surface === 'desktop') return next(e)
    lastBand = { columns: e.props.bodyColumns, hasSurvey: e.props.hasSurvey }
    if (e.props.hasSurvey || e.props.bodyColumns < MIN_COLUMNS) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    // What the plugins beneath drew here stays, above the card. Never pass the band itself: a band handed
    // back is not drawn again when the card's state changes.
    const below = await next(e).catch(() => null)
    const withBelow = (ours: RenderElement): RenderElement => (below ? <Box flexDirection="column">{below}{ours}</Box> : ours)
    const p = await read($, prefs)
    const setHidden = (hidden: boolean) => update($, isHidden, () => hidden)
    const setSettingsOpen = (open: boolean) => update($, isSettingsOpen, () => open)
    // update() applies `fn` to the latest value and retries on a race, so two quick presses both land.
    const change = async (fn: (q: Prefs) => Prefs) => $.store.set('prefs', await update($, prefs, fn))
    // Hidden: a one-row button stays at the right edge.
    if (await read($, isHidden))
      return withBelow(
        <Box justifyContent="flex-end" paddingRight={HIDDEN_RIGHT_PAD}>
          <Button key="show" label={STRINGS.show} dimColor onPress={() => setHidden(false)} />
        </Box>,
      )
    const frame = (width: number, children: RenderChildren[]) =>
      withBelow(
        <Box justifyContent="flex-end" paddingRight={1}>
          <Box width={width + 4} flexDirection="column" borderStyle="round" borderColor="claude" paddingX={1}>
            {children}
          </Box>
        </Box>,
      )

    if (await read($, isSettingsOpen))
      return frame(CARD_WIDTH, [
        <Text color="claude" bold>{STRINGS.settings}</Text>,
        SWITCHES.map(k => (
          <Button key={`pref-${k}`} label={`${p[k] ? '☑' : '☐'} ${STRINGS[k]}`} plain onPress={() => change(q => ({ ...q, [k]: !q[k] }))} />
        )),
        <Box>
          <Text>{STRINGS.bar} </Text>
          <Button key="bar-minus" label="-" onPress={() => change(q => ({ ...q, barWidth: Math.max(BAR_MIN, q.barWidth - 2) }))} />
          <Text> {String(p.barWidth).padStart(2)} </Text>
          <Button key="bar-plus" label="+" onPress={() => change(q => ({ ...q, barWidth: Math.min(BAR_MAX, q.barWidth + 2) }))} />
        </Box>,
        <Box justifyContent="flex-end">
          <Button key="settings-close" label={STRINGS.done} variant="primary" onPress={() => setSettingsOpen(false)} />
        </Box>,
      ])

    const lines = cardLines(await read($, figures), await $.clock.now(), p, await read($, compactAsk))
    const { width, buttonsOwnRow } = layout(lines)
    const runs = (parts: Part[]) => parts.map(q => <Text color={q.color} dimColor={q.dim} bold={q.bold}>{q.text}</Text>)
    const pad = (parts: Part[], room: number) => ' '.repeat(Math.max(0, room - lineWidth(parts)))
    // A line holding a button is a row of its own; the others one Text, cut at the card's edge.
    const row = (parts: Part[], room: number) =>
      parts.some(q => q.press) ? (
        <Box key="ctx-line">
          {parts.map(q =>
            q.press ? (
              <Button key={q.press} label={q.text} plain dimColor={q.dim} hover={{ color: 'claude' }} onPress={() => pressCompact($)} />
            ) : (
              <Text color={q.color} dimColor={q.dim} bold={q.bold}>{q.text}</Text>
            ),
          )}
          <Text>{pad(parts, room)}</Text>
        </Box>
      ) : (
        <Text wrap="truncate-end">
          {runs(parts)}
          {pad(parts, room)}
        </Text>
      )
    // Whether Claude is working, as the reference's main box says it, then the buttons.
    const working = e.props.isWorking
    const buttons = [
      <Text color={working ? 'claude' : undefined} dimColor={!working}>{(working ? HEAD_RIGHT : '○ idle').padStart(HEAD_RIGHT.length)}</Text>,
      <Text> </Text>,
      <Button key="settings" label=" ⚙ " plain dimColor hover={{ color: 'claude' }} onPress={() => setSettingsOpen(true)} />,
      <Text> </Text>,
      <Button key="hide" label={STRINGS.hide} plain dimColor hover={{ color: 'claude' }} onPress={() => setHidden(true)} />,
    ]
    const first = lines[0] ?? []
    const top = buttonsOwnRow ? (
      <Box key="head" justifyContent="flex-end">{buttons}</Box>
    ) : (
      <Box key="head">
        {row(first, width - BUTTONS_WIDTH)}
        {buttons}
      </Box>
    )
    const rest = buttonsOwnRow ? lines : lines.slice(1)

    return frame(width, [top, rest.map(parts => row(parts, width))])
  })
}

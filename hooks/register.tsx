import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderChildren, RenderElement, SessionUsage } from 'claude-code'

import type {
  Statuspane,
  StatuspaneFigures as Figures,
  StatuspaneLimit as Limit,
  StatuspanePrefs as Prefs,
  StatuspaneRow as Row,
} from '../types'

const EMPTY: Figures = { dir: null, branch: null, model: null, effort: null, progress: [] }
export const DEFAULT_PREFS: Prefs = {
  model: true, ctx: true, limits: true, eta: true, location: true, cost: true, progress: true, barWidth: 12,
}
const figures = atom({ plugin: 'statuspane', key: 'figures' } as const, EMPTY)
const isHidden = atom({ plugin: 'statuspane', key: 'isHidden' } as const, false)
const prefs = atom({ plugin: 'statuspane', key: 'prefs' } as const, DEFAULT_PREFS)
const isSettingsOpen = atom({ plugin: 'statuspane', key: 'isSettingsOpen' } as const, false)

const CARD_WIDTH = 34 // inside the border, at least; a wider line widens the card
const MAX_CARD_WIDTH = 50
const MIN_COLUMNS = 70 // narrower than this the card would cover too much; draw nothing
const BUTTONS_WIDTH = 16 // ' [ ⚙ ]' + '[ ▾ hide ]', drawn with chrome so the click targets are wide
const PENDING = '—'
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

export const STRINGS = {
  settings: 'Status settings', model: 'Model · effort', ctx: 'Context bar', limits: '5h / week limits',
  eta: 'Reset countdowns', location: 'Directory · branch', cost: 'Session cost', progress: 'Progress rows',
  bar: 'Bar width', done: '✓ Done', hide: '▾ hide', show: '◂ status',
  hidden: 'Status card hidden.', shown: 'Status card shown.',
  tooNarrow: 'Status card shown; it draws once the terminal is at least 70 columns wide.',
} as const

type Switch = Exclude<keyof Prefs, 'barWidth'>
// The settings page's switches, in the card's order.
export const SWITCHES: Switch[] = ['model', 'ctx', 'limits', 'eta', 'location', 'cost', 'progress']

export type Part = { text: string; color?: string; dim?: boolean }

// Same thresholds as a classic statusline script: low green, getting high yellow, nearly out red.
export const usedColor = (pct: number) => (pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green')
const ctxColor = (pct: number) => (pct >= 80 ? 'red' : pct >= 50 ? 'yellow' : 'green')

// Terminal columns a string takes: East Asian wide and fullwidth characters and emoji take two.
// lazy: range table, not full Unicode East Asian Width; upgrade to a generated table if a script draws wrong.
export const cols = (s: string) => {
  let n = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    const wide =
      (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1faff) || (c >= 0x20000 && c <= 0x3fffd)
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

// A progress report as a row, or null when it is not one; `seenAt` is when it was written.
export const toRow = (raw: unknown, seenAt: number, fallbackId?: string): Row | null => {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' && ID.test(o.id) ? o.id : fallbackId && ID.test(fallbackId) ? fallbackId : null
  if (!id) return null
  const label = clean(o.label, 24) || id.slice(0, 24)
  const percent = typeof o.percent === 'number' && Number.isFinite(o.percent) ? Math.min(100, Math.max(0, o.percent)) : undefined
  const text = clean(o.text, 60) || undefined
  if (percent === undefined && !text) return null
  const ttl = typeof o.ttl === 'number' && Number.isFinite(o.ttl) ? Math.min(86_400, Math.max(5, o.ttl)) : DEFAULT_TTL
  return { id, label, ...(percent !== undefined && { percent }), ...(text && { text }), expiresAt: seenAt + ttl * 1000 }
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

export const bar = (pct: number, width: number) => {
  const filled = Math.min(width, Math.max(0, Math.round((pct * width) / 100)))
  return '█'.repeat(filled) + '░'.repeat(width - filled)
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
  return [{ text: `${label} `, dim: true }, { text: `${Math.round(l.pct)}%`, color: usedColor(l.pct) }, ...(eta ? [{ text: ` ↻${eta}`, dim: true }] : [])]
}

const progressLine = (r: Row, width: number): Part[] => [
  { text: `${r.label} `, dim: true },
  ...(r.percent !== undefined ? [{ text: `${bar(r.percent, width)} ${Math.round(r.percent)}%`, color: 'green' }] : []),
  ...(r.text ? [{ text: r.percent !== undefined ? ` ${r.text}` : r.text }] : []),
]

// Pure: the card's lines, each a run of colored parts, as the prefs pick them.
export const cardLines = (f: Figures, now: number, p: Prefs = DEFAULT_PREFS): Part[][] => {
  const sep: Part = { text: ' · ', dim: true }
  const lines: Part[][] = []
  if (p.model)
    lines.push([{ text: f.model ? prettyModel(f.model) : PENDING, color: 'magenta' }, ...(f.effort ? [sep, { text: f.effort, color: 'yellow' }] : [])])
  if (p.ctx) {
    if (f.ctxPct !== undefined) {
      const k = (n: number) => (n >= 1_000_000 ? `${+(n / 1_000_000).toFixed(1)}M` : `${Math.round(n / 1000)}k`)
      const tokens = f.ctxTokens !== undefined && f.ctxWindow ? ` ${k(f.ctxTokens)}/${k(f.ctxWindow)}` : ''
      lines.push([{ text: 'ctx ', dim: true }, { text: `${bar(f.ctxPct, p.barWidth)} ${Math.round(f.ctxPct)}%`, color: ctxColor(f.ctxPct) }, { text: tokens, dim: true }])
    } else lines.push([{ text: 'ctx ', dim: true }, { text: `${bar(0, p.barWidth)} ${PENDING}`, dim: true }])
  }
  if (p.limits) lines.push([...limit('5h', f.fiveHour, now, p.eta), sep, ...limit('wk', f.week, now, p.eta)])
  const place: Part[][] = [
    ...(p.location ? [[{ text: f.dir ? shortDir(f.dir) : PENDING, color: 'cyan' }]] : []),
    ...(p.location && f.branch ? [[{ text: `⎇ ${fit(f.branch, 16)}`, color: 'magenta' }]] : []),
    ...(p.cost && f.costUsd !== undefined ? [[{ text: `$${f.costUsd.toFixed(2)}`, color: 'green' }]] : []),
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
    const progress = mergeRows(fileRows, apiRows, now)
    const before = (await read($, figures)).progress
    if (JSON.stringify(before) !== JSON.stringify(progress)) await update($, figures, f => ({ ...f, progress }))
  } catch {
    // lazy: swallowed silently; a debug line would help a user whose rows never show.
  }
}

// Never rejects; runs off the turn's path (callers do not await it).
async function refresh($: EngineInterface) {
  try {
    const home = (await $.env.get('HOME')) || (await $.env.get('USERPROFILE'))
    const cwd = await $.session.cwd()
    const dir = home && (cwd === home || cwd.startsWith(`${home}/`)) ? `~${cwd.slice(home.length)}` : cwd
    const repo = await $.session.repo()
    const b = repo ? await $.process.run(['git', 'branch', '--show-current'], { cwd, timeoutMs: 3000 }).catch(() => null) : null
    const branch = (b && b.exitCode === 0 && b.stdout.trim()) || null
    await update($, figures, f => ({ ...f, dir, branch }))
  } catch {
    // keep the last directory and branch
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
    const stored = await $.store.get('prefs').catch(() => undefined)
    await update($, prefs, () => loadPrefs(stored))
    const model = await $.session.model()
    const usage = fromUsage(await $.session.usage())
    await update($, figures, f => ({ ...f, ...usage, model: model || null }))
    $.clock.every(30_000, () => void refresh($))
    $.clock.every(PROGRESS_POLL_MS, () => void readProgress($))
    void refresh($)
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

  // The band's rows hold the card at the right edge, just above the prompt.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
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
          <Box width={width + 4} flexDirection="column" borderStyle="round" borderDimColor paddingX={1}>
            {children}
          </Box>
        </Box>,
      )

    if (await read($, isSettingsOpen))
      return frame(CARD_WIDTH, [
        <Text bold>{STRINGS.settings}</Text>,
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

    const lines = cardLines(await read($, figures), await $.clock.now(), p)
    const { width, buttonsOwnRow } = layout(lines)
    const runs = (parts: Part[]) => parts.map(q => <Text color={q.color} dimColor={q.dim}>{q.text}</Text>)
    const row = (parts: Part[], room: number) => (
      <Text wrap="truncate-end">
        {runs(parts)}
        {' '.repeat(Math.max(0, room - lineWidth(parts)))}
      </Text>
    )
    const buttons = [
      <Button key="settings" label="⚙" dimColor onPress={() => setSettingsOpen(true)} />,
      <Button key="hide" label={STRINGS.hide} dimColor onPress={() => setHidden(true)} />,
    ]
    const first = lines[0] ?? []
    const top = buttonsOwnRow ? (
      <Box justifyContent="flex-end">{buttons}</Box>
    ) : (
      <Box>
        {row(first, width - BUTTONS_WIDTH)}
        <Text> </Text>
        {buttons}
      </Box>
    )
    const rest = buttonsOwnRow ? lines : lines.slice(1)

    return frame(width, [top, rest.map(parts => row(parts, width))])
  })
}

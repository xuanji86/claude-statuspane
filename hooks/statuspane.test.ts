import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_PREFS, bar, cardLines, cardWidth, clean, cols, fit, layout, loadPrefs, mergeRows, pickFiles, prettyModel, resolveDir, shortDir, toRow } from './register'

const NOW = Date.parse('2026-10-02T00:00:00Z')
const text = (lines: { text: string }[][]) => lines.map(l => l.map(p => p.text).join(''))
const BASE = { dir: '~', branch: null, model: null, effort: null, progress: [] }
const FULL = {
  dir: '~/x', branch: 'develop', model: 'claude-opus-5-5[1m]', effort: 'high', progress: [],
  ctxPct: 62, ctxTokens: 620_000, ctxWindow: 1_000_000,
  fiveHour: { pct: 30, resetsAt: '2026-10-02T02:15:00Z' }, week: { pct: 91, resetsAt: '2026-10-04T05:00:00Z' }, costUsd: 1.5,
}

describe('card', () => {
  test('placeholders before the first response', async () => {
    expect(text(cardLines(BASE, NOW))).toEqual(['—', `ctx ${bar(0, 12)} —`, '5h — · wk —', '~'])
  })
  test('full card with colors from the classic statusline thresholds', async () => {
    const lines = cardLines(FULL, NOW)
    expect(text(lines)).toEqual([
      'Opus 5.5 (1M) · high',
      `ctx ${bar(62, 12)} 62% 620k/1M`,
      '5h 30% ↻2h15m · wk 91% ↻2d5h',
      '~/x · ⎇ develop · $1.50',
    ])
    expect(lines[1]?.[1]?.color).toBe('yellow')
    expect(lines[2]?.find(p => p.text === '91%')?.color).toBe('red')
  })
  test('model ids read as their display names', async () => {
    expect(prettyModel('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
    expect(prettyModel('claude-opus-4-20250514')).toBe('Opus 4')
    expect(prettyModel('claude-sonnet-4-20250514[1m]')).toBe('Sonnet 4 (1M)')
    expect(prettyModel('claude-opus-4-1-20250805')).toBe('Opus 4.1')
    expect(prettyModel('sonnet')).toBe('sonnet')
  })
})

describe('prefs', () => {
  test('switched-off lines and parts are left out', async () => {
    const p = { ...DEFAULT_PREFS, model: false, eta: false, location: false }
    expect(text(cardLines(FULL, NOW, p))).toEqual([`ctx ${bar(62, 12)} 62% 620k/1M`, '5h 30% · wk 91%', '$1.50'])
  })
  test('bar width follows the setting and widens the card', async () => {
    const lines = cardLines(FULL, NOW, { ...DEFAULT_PREFS, barWidth: 24 })
    expect(text(lines)[1]).toBe(`ctx ${bar(62, 24)} 62% 620k/1M`)
    expect(cardWidth(lines)).toBe(text(lines)[1]?.length)
  })
  test('the card is wide enough for the first line and its buttons', async () => {
    expect(cardWidth(cardLines(FULL, NOW))).toBeGreaterThanOrEqual('Opus 5.5 (1M) · high'.length + 16)
  })
  test('stored prefs are read over the defaults, bad values dropped', async () => {
    expect(loadPrefs(undefined)).toEqual(DEFAULT_PREFS)
    expect(loadPrefs({ cost: false, barWidth: 99, ctx: 'no', lang: 'zh', bogus: true, ainiee: false })).toEqual({ ...DEFAULT_PREFS, cost: false, barWidth: 24 })
  })
})

describe('progress rows', () => {
  test('a report becomes a sanitized, bounded row with an expiry', async () => {
    const row = toRow({ label: 'book\u001b[31m one', percent: 142, text: 'x'.repeat(100), ttl: 60 }, NOW, 'ainiee')
    expect(row).toEqual({ id: 'ainiee', label: 'book[31m one', percent: 100, text: 'x'.repeat(60), expiresAt: NOW + 60_000 })
  })
  test('reports that are not one are dropped', async () => {
    expect(toRow(null, NOW, 'a')).toBeNull()
    expect(toRow({ label: 'no figures' }, NOW, 'a')).toBeNull()
    expect(toRow({ percent: 5 }, NOW, '../etc')).toBeNull()
    expect(toRow({ id: 'ok', percent: 5 }, NOW)?.label).toBe('ok')
  })
  test('rows draw under the card, text-only rows too, and expired rows are gone', async () => {
    const progress = [
      { id: 'a', label: 'build', percent: 50, text: '3/6', expiresAt: NOW + 1 },
      { id: 'b', label: 'sync', text: 'waiting', expiresAt: NOW + 1 },
      { id: 'c', label: 'old', percent: 10, expiresAt: NOW - 1 },
    ]
    const lines = text(cardLines({ ...BASE, progress }, NOW, { ...DEFAULT_PREFS, model: false, ctx: false, limits: false, location: false }))
    expect(lines).toEqual([`build ${bar(50, 12)} 50% 3/6`, 'sync waiting'])
    expect(text(cardLines({ ...BASE, progress }, NOW, { ...DEFAULT_PREFS, progress: false }))).not.toContain('sync waiting')
  })
  test('wide characters count two columns and control characters are stripped', async () => {
    expect(cols('ab中文')).toBe(6)
    expect(clean('a‮b\nc', 10)).toBe('abc')
  })
})

describe('long names', () => {
  test('a long directory keeps its last segments within 20 columns', async () => {
    expect(shortDir('~/proj')).toBe('~/proj')
    expect(shortDir('~/Desktop/clients/acme/web/frontend')).toBe('…/acme/web/frontend')
    expect(shortDir('~/a/' + 'x'.repeat(40))).toBe('…' + 'x'.repeat(19))
    expect(cols(shortDir('~/项目/客户资料/二〇二六年/非常长的中文目录名称'))).toBeLessThanOrEqual(20)
  })
  test('a long branch is cut and the card stays narrow', async () => {
    expect(fit('feature/very-long-branch-name-for-testing', 16)).toBe('feature/very-lo…')
    const lines = cardLines({ ...FULL, dir: '/Users/someone/Desktop/a/b/c/d/e/f/g/h/i/j/project', branch: 'x'.repeat(80) }, NOW)
    expect(cardWidth(lines)).toBeLessThanOrEqual(50)
  })
})

describe('progress files', () => {
  const file = (name: string, mtimeMs: number, size = 100, kind = 'file') => ({ name, kind, size, mtimeMs, isLink: false })
  test('the newest files are read, so old stale ones never crowd out a new source', async () => {
    const old = Array.from({ length: 25 }, (_, i) => file(`a-job${String(i).padStart(2, '0')}.json`, 1_000 + i))
    const picked = pickFiles([...old, file('z-build.json', 9_999), file('notes.txt', 10_000), file('dir.json', 10_000, 100, 'dir'), file('big.json', 10_000, 70_000)])
    expect(picked.length).toBe(20)
    expect(picked[0]?.name).toBe('z-build.json')
    expect(picked.map(f => f.name)).not.toContain('notes.txt')
    expect(picked.map(f => f.name)).not.toContain('big.json')
  })
  test('rows merge by id, live only, a report from a mod over a file, at most five', async () => {
    const row = (id: string, expiresAt: number, label = id) => ({ id, label, percent: 1, expiresAt })
    const rows = mergeRows([row('a', 5), row('b', 0), row('c', 5, 'file')], [row('c', 5, 'mod'), row('d', 5), row('e', 5), row('f', 5), row('g', 5)], 1)
    expect(rows.map(r => r.id)).toEqual(['a', 'c', 'd', 'e', 'f'])
    expect(rows.find(r => r.id === 'c')?.label).toBe('mod')
  })
  test('the folder setting expands ~ and ignores relative paths', async () => {
    expect(resolveDir(undefined, '/home/u')).toBe('/home/u/.claude/statuspane/progress')
    expect(resolveDir('~/p', '/home/u')).toBe('/home/u/p')
    expect(resolveDir('/srv/p', '/home/u')).toBe('/srv/p')
    expect(resolveDir('C:\\p', undefined)).toBe('C:\\p')
    expect(resolveDir('rel/p', '/home/u')).toBe('/home/u/.claude/statuspane/progress')
    expect(resolveDir(undefined, undefined)).toBeNull()
  })
})

describe('layout', () => {
  test('buttons move to their own row when the first line is too wide to share it', async () => {
    const narrow = cardLines({ ...FULL }, NOW)
    expect(layout(narrow).buttonsOwnRow).toBe(false)
    const wide = cardLines(FULL, NOW, { ...DEFAULT_PREFS, model: false, barWidth: 24 })
    const { width, buttonsOwnRow } = layout(wide)
    expect(buttonsOwnRow).toBe(true)
    expect(width).toBeGreaterThanOrEqual(text(wide)[0]?.length ?? 0)
  })
})

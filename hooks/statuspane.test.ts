import { describe, expect, test } from 'claude-code/testing'

import { DEFAULT_PREFS, cardLines, compactNow, lineWidth, cardWidth, ciSummary, clean, cols, fit, fmtSpan, latestGroup, layout, loadPrefs, mergeRows, pickFiles, prettyModel, pushedRefs, repoSlug, resolveDir, shortDir, toRow } from './register'
import type { Job, Run } from './register'
import { gauge } from './register'

const NOW = Date.parse('2026-10-02T00:00:00Z')
const text = (lines: { text: string }[][]) => lines.map(l => l.map(p => p.text).join(''))
const bar = (pct: number, width: number) => gauge(pct, width).on + gauge(pct, width).off
const BASE = { dir: '~', branch: null, model: null, effort: null, progress: [] }
const FULL = {
  dir: '~/x', branch: 'develop', model: 'claude-opus-5-5[1m]', effort: 'high', progress: [],
  ctxPct: 62, ctxTokens: 620_000, ctxWindow: 1_000_000,
  fiveHour: { pct: 30, resetsAt: '2026-10-02T02:15:00Z' }, week: { pct: 91, resetsAt: '2026-10-04T05:00:00Z' }, costUsd: 1.5,
}

describe('card', () => {
  test('placeholders before the first response', async () => {
    expect(text(cardLines(BASE, NOW))).toEqual(['—', `ctx ${bar(0, 12)} —`, '5h —   7d —', '~'])
  })
  test('full card in Claude Code\'s colors, past the classic statusline thresholds', async () => {
    const lines = cardLines(FULL, NOW)
    expect(text(lines)).toEqual([
      'Opus 5.5 (1M)',
      'effort ▮▮▮▯▯ high',
      'ctx ▰▰▰▰▰▰▰▱▱▱▱▱ 62% 620k/1M  ⟲ compact',
      '5h ▰▰▱▱▱ 30% ↻2h15m   7d ▰▰▰▰▰ 91% ↻2d5h',
      '~/x · ⎇ develop · $1.50',
    ])
    expect(lines[0]?.[0]).toMatchObject({ color: 'claude', bold: true })
    expect(lines[2]?.[1]?.color).toBe('warning') // 62% of the context
    expect(lines[2]?.[2]?.color).toBe('subtle')
    expect(lines[3]?.[1]?.color).toBe('claude') // 30% of the 5h limit
    expect(lines[3]?.find(p => p.text === ' 91%')?.color).toBe('error')
  })
  test('the ⟲ compact button follows the context gauge: armed, then compacting', async () => {
    const ctxLine = (state: 'armed' | 'running' | null) => cardLines(FULL, NOW, DEFAULT_PREFS, state && { state, at: NOW })[2]!
    expect(text([ctxLine('armed')])[0]).toBe('ctx ▰▰▰▰▰▰▰▱▱▱▱▱ 62% 620k/1M  ⟲ confirm')
    expect(ctxLine('armed').filter(q => q.press).map(q => q.text)).toEqual(['confirm'])
    expect(text([ctxLine('running')])[0]).toBe('ctx ▰▰▰▰▰▰▰▱▱▱▱▱ 62% 620k/1M  ⟲ compacting…')
    expect(ctxLine('running').some(q => q.press)).toBe(false) // nothing to press while it runs
    expect(cardLines(BASE, NOW).flat().some(q => q.press)).toBe(false) // no context yet, nothing to compact
  })
  test('an effort the gauge does not know reads as its word alone', async () => {
    expect(text(cardLines({ ...FULL, effort: '3' }, NOW))[1]).toBe('effort 3')
    expect(text(cardLines({ ...FULL, effort: 'max' }, NOW))[1]).toBe('effort ▮▮▮▮▮ max')
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
    expect(text(cardLines(FULL, NOW, p))).toEqual([`ctx ${bar(62, 12)} 62% 620k/1M  ⟲ compact`, '5h ▰▰▱▱▱ 30%   7d ▰▰▰▰▰ 91%', '$1.50'])
  })
  test('bar width follows the setting and widens the card', async () => {
    const lines = cardLines(FULL, NOW, { ...DEFAULT_PREFS, barWidth: 24 })
    expect(text(lines)[2]).toBe(`ctx ${bar(62, 24)} 62%  ⟲ compact`) // past the widest card the tokens give way, not the button
    expect(cardWidth(lines)).toBe(text(lines)[2]?.length)
  })
  test('the card is wide enough for the first line and its buttons', async () => {
    expect(cardWidth(cardLines(FULL, NOW))).toBeGreaterThanOrEqual('Opus 5.5 (1M) ● working  ⚙  ▾ hide'.length)
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
  test('a state colors the bar and the text; an unknown state is dropped', async () => {
    expect(toRow({ label: 'ci', text: 'x', state: 'error' }, NOW, 'a')?.state).toBe('error')
    expect(toRow({ label: 'ci', text: 'x', state: 'purple' }, NOW, 'a')).not.toHaveProperty('state')
    const only = { ...DEFAULT_PREFS, model: false, ctx: false, limits: false, location: false }
    const draw = (state?: 'running' | 'ok' | 'error') =>
      cardLines({ ...BASE, progress: [{ id: 'a', label: 'ci', percent: 50, text: 'x', state, expiresAt: NOW + 1 }] }, NOW, only)[0]
    expect(draw('error')?.map(p => p.color)).toEqual([undefined, 'error', 'subtle', undefined, 'error'])
    expect(draw('ok')?.map(p => p.color)).toEqual([undefined, 'success', 'subtle', undefined, 'success'])
    expect(draw('running')?.map(p => p.color)).toEqual([undefined, 'claude', 'subtle', undefined, 'claude'])
    expect(draw()?.map(p => p.color)).toEqual([undefined, 'claude', 'subtle', undefined, undefined])
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

describe('CI', () => {
  const run = (o: Partial<Run>): Run => ({
    databaseId: 1, status: 'completed', conclusion: 'success', workflowName: 'CI', headSha: 'a', event: 'push',
    createdAt: '2026-10-01T23:58:40Z', updatedAt: '2026-10-01T23:57:00Z', ...o,
  })
  const job = (name: string, status: string, conclusion = ''): Job => ({ name, status, conclusion })

  test('remotes read as gh repo names', async () => {
    expect(repoSlug('https://github.com/xuanji86/osa-api.git\n')).toBe('xuanji86/osa-api')
    expect(repoSlug('git@github.com:o/r.git')).toBe('o/r')
    expect(repoSlug('ssh://git@github.com/o/r')).toBe('o/r')
    expect(repoSlug('https://ghe.example.com/o/r.git')).toBe('ghe.example.com/o/r')
    expect(repoSlug('/srv/git/r')).toBeNull()
  })
  test('a push report names the refs it updated, not the rejected ones', async () => {
    const out = [
      'To github.com:o/r.git',
      '   6386f32..e4f5a6b  main -> main',
      ' + 1234567...89abcde feat/x -> feat/x (forced update)',
      ' * [new branch]      fix -> fix',
      ' * [new tag]         v1.2.0 -> v1.2.0',
      ' ! [rejected]        dev -> dev (fetch first)',
    ].join('\n')
    expect(pushedRefs(out)).toEqual(['main', 'feat/x', 'fix', 'v1.2.0'])
    expect(pushedRefs('Everything up-to-date')).toEqual([])
  })
  test("the newest commit's runs, schedules left out", async () => {
    const runs = [run({ databaseId: 9, event: 'schedule', headSha: 'z' }), run({ databaseId: 2, headSha: 'b' }), run({ databaseId: 3, headSha: 'b', event: 'workflow_run' }), run({ databaseId: 1 })]
    expect(latestGroup(runs).map(r => r.databaseId)).toEqual([2, 3])
  })
  test('runs under way show their jobs, a deploy as deploying', async () => {
    const busy = [run({ status: 'in_progress', conclusion: '' })]
    expect(ciSummary(busy, [job('test', 'completed', 'success'), job('deploy', 'in_progress')], NOW)).toEqual({ text: '⟳ deploying · 1m20s', state: 'running', busy: true })
    expect(ciSummary(busy, [job('lint', 'in_progress'), job('test', 'in_progress')], NOW).text).toBe('⟳ lint, test · 1m20s')
    expect(ciSummary(busy, [], NOW).text).toBe('⟳ queued · 1m20s')
  })
  test('finished runs say deployed, passed, failed or cancelled', async () => {
    const done = [run({})]
    expect(ciSummary(done, [job('test', 'completed', 'success'), job('deploy', 'completed', 'success')], NOW)).toEqual({ text: '✓ deployed · 3m ago', state: 'ok', busy: false })
    expect(ciSummary(done, [job('test', 'completed', 'success'), job('deploy', 'completed', 'skipped')], NOW).text).toBe('✓ passed · 3m ago')
    expect(ciSummary([run({ conclusion: 'failure' })], [job('test', 'completed', 'failure')], NOW)).toEqual({ text: '✗ test failed · 3m ago', state: 'error', busy: false })
    expect(ciSummary([run({ conclusion: 'failure', workflowName: 'Release' })], [], NOW).text).toBe('✗ Release failed · 3m ago')
    expect(ciSummary([run({ conclusion: 'cancelled' })], [], NOW)).toEqual({ text: '⊘ cancelled · 3m ago', busy: false })
  })
  test('spans read short', async () => {
    expect([fmtSpan(5_000, true), fmtSpan(80_000, true), fmtSpan(3_725_000, true), fmtSpan(3_725_000, false), fmtSpan(3 * 86_400_000, false)]).toEqual(['5s', '1m20s', '1h02m', '1h', '3d'])
  })
})

describe('review fixes', () => {
  test('a push report of blank lines parses at once, and a real one still parses', async () => {
    const t = Date.now()
    expect(pushedRefs('\n'.repeat(30_000) + ' \n'.repeat(10_000))).toEqual([])
    expect(Date.now() - t).toBeLessThan(200)
    expect(pushedRefs('To github.com:o/r.git\n   6386f32..e4f5a6b  main -> main\n * [new branch]      x -> x\n')).toEqual(['main', 'x'])
  })
  test('the compact button lapses: armed after 5 s, running after 10 min, either with the clock set back', async () => {
    expect(compactNow({ state: 'armed', at: 1_000 }, 5_999)).toBe('armed')
    expect(compactNow({ state: 'armed', at: 1_000 }, 6_000)).toBeNull()
    expect(compactNow({ state: 'running', at: 0 }, 599_999)).toBe('running')
    expect(compactNow({ state: 'running', at: 0 }, 600_000)).toBeNull()
    expect(compactNow({ state: 'armed', at: 9_000 }, 1_000)).toBeNull()
  })
  test('a label is cut by columns, and a progress row keeps its percent on the card', async () => {
    expect(cols(toRow({ label: '中'.repeat(30), percent: 5 }, NOW, 'a')!.label)).toBeLessThanOrEqual(24)
    const row = { id: 'a', label: 'x'.repeat(24), percent: 100, expiresAt: NOW + 1 }
    const line = cardLines({ ...BASE, progress: [row] }, NOW, { ...DEFAULT_PREFS, model: false, ctx: false, limits: false, location: false, barWidth: 24 })[0]!
    expect(lineWidth(line)).toBeLessThanOrEqual(50)
    expect(text([line])[0]).toMatch(/ 100%$/)
  })
  test('emoji terminals draw wide count two columns', async () => {
    expect(['✅', '❌', '⚡', '⭐', '⌛'].map(cols)).toEqual([2, 2, 2, 2, 2])
    expect(cols('✓✗⟳')).toBe(3)
  })
})

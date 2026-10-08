import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'statuspane', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as never

// The world beneath a started session: prefs as stored, git and gh answered by `run`.
const startSession = async ($: { session: { start: (e: never) => Promise<unknown> } }, on: On, stored: object, run: (argv: string) => string | null, inRepo = false) => {
  const done = (stdout: string | null) => ({ value: { exitCode: stdout === null ? 1 : 0, stdout: stdout ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('store.get', () => ({ value: stored }) as never)
  on('command.register', () => ({ value: { command: 'statuspane' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }) as never)
  on('session.cwd', () => ({ value: '/w/r' }))
  on('session.repo', () => ({ value: inRepo ? { root: '/w/r' } : null }) as never)
  on('process.run', ($, e) => done(run(e.argv.join(' '))))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: '', stderr: '   6386f32..e4f5a6b  main -> main', interrupted: false } }) as never)
  mock.env(on, { HOME: '/home/u' })
  await $.session.start({ cwd: '/w/r', surface: null, isInteractive: true } as never)
}

// A plugin beneath statuspane that draws `text` in the band.
const drawsBelow = (on: On, text: string) =>
  on('ui.render', { component: 'AbovePrompt' }, $ => {
    const { Text } = ($ as { ui: { resolve: (e: unknown) => { Text: (p: object) => unknown } } }).ui.resolve({ surface: 'terminal', component: 'AbovePrompt' })
    return h(Text as never, {}, text) as never
  })

test('/statuspane hides the card and a second run brings it back', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await $.command.run({ command: 'statuspane', args: '' } as never)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await $.command.run({ command: 'statuspane', args: '' } as never)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
})

test('the ◂ status button brings a hidden card back', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount(BAND)
  await $.command.run({ command: 'statuspane', args: '' } as never)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.press({ key: 'show' })
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
})

test('the ▾ button hides the card and ◂ status brings it back', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'hide' })
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.press({ key: 'show' })
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
})

test('the ⚙ page switches a line off, keeps it after closing and stores it', async ($, on) => {
  mock.clock(on)
  const saved: unknown[] = []
  let stored: unknown
  on('store.get', () => ({ value: stored }) as never)
  on('store.set', ($, e) => (saved.push(e), (stored = e.value), { value: undefined } as never))
  const ui = await $.ui.mount(BAND)
  await ui.press({ key: 'settings' })
  expect(await ui.find({ type: 'Text', text: /Status settings/ })).toBeDefined()
  await ui.press({ key: 'pref-ctx' })
  await ui.press({ key: 'bar-plus' })
  await ui.press({ key: 'settings-close' })
  expect(await ui.find({ type: 'Text', text: /Status settings/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  expect(saved.at(-1)).toMatchObject({ key: 'prefs', value: { ctx: false, barWidth: 14 } })
  await ui.unmount()
})

test("another session's ⚙ change reaches this card, and a press here keeps it", async ($, on) => {
  const clock = mock.clock(on)
  const stored: Record<string, unknown> = {} // the one prefs every session's store reads
  on('store.set', ($, e) => (Object.assign(stored, e.value), { value: undefined } as never))
  await startSession($, on, stored, () => null)
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  stored.ctx = false // the other session switched the context bar off
  await ui.press({ key: 'settings' })
  await ui.press({ key: 'bar-plus' }) // before this session's poll took it up
  expect(stored).toMatchObject({ ctx: false, barWidth: 14 })
  stored.ctx = true
  await ui.press({ key: 'settings-close' })
  await clock.advance(2_000)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  stored.ctx = false
  await clock.advance(2_000)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.unmount()
})

test('/statuspane says when the terminal is too narrow for the card', async ($, on) => {
  mock.clock(on)
  drawsBelow(on, '')
  const ui = await $.ui.mount({ ...(BAND as object), props: { ...(BAND as { props: object }).props, bodyColumns: 60 } } as never)
  await $.command.run({ command: 'statuspane', args: '' } as never)
  const shown = await $.command.run({ command: 'statuspane', args: '' } as never)
  expect(JSON.stringify(shown)).toContain('70 columns')
  await ui.unmount()
})

test('what other plugins draw in the band stays, above the card', async ($, on) => {
  mock.clock(on)
  drawsBelow(on, 'from below')
  const ui = await $.ui.mount(BAND)
  expect(await ui.find({ type: 'Text', text: /from below/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
})

test('a compaction clears the context fill until the next measurement', async ($, on) => {
  mock.clock(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const summary = [{ role: 'user' as const, text: 'summary', toolUses: [] }]
  on('session.compact', () => ({ messages: summary }))
  const ui = await $.ui.mount(BAND)
  await $.session.measure({ context: { tokens: 620_000, window: 1_000_000, percent: 62 }, rateLimits: [], changed: ['context'] } as never)
  expect(await ui.find({ type: 'Text', text: /62%/ })).toBeDefined()
  await $.session.compact({ trigger: 'manual', messages: summary })
  expect(await ui.find({ type: 'Text', text: /62%/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /—/ })).toBeDefined()
  await ui.unmount()
})

test('a running CI row counts every second without asking GitHub again', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T00:00:00Z') })
  const created = new Date(clock.now()).toISOString()
  const calls: string[] = []
  await startSession($, on, { ciPush: true }, argv => {
    calls.push(argv)
    if (argv === 'git remote get-url origin') return 'git@github.com:o/r.git'
    if (argv.startsWith('gh run list -R o/r --branch main'))
      return JSON.stringify([{ databaseId: 7, status: 'in_progress', conclusion: '', workflowName: 'CI', headSha: 'b', event: 'push', createdAt: created, updatedAt: created }])
    if (argv.startsWith('gh run view 7 -R o/r')) return JSON.stringify({ jobs: [{ name: 'deploy', status: 'in_progress', conclusion: '' }] })
    return null
  })
  const ui = await $.ui.mount(BAND)
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  await clock.advance(1_000)
  expect(await ui.find({ type: 'Text', text: /deploying · 1s/ })).toBeDefined()
  const asked = calls.filter(c => c.startsWith('gh ')).length
  await clock.advance(3_000)
  expect(await ui.find({ type: 'Text', text: /deploying · 4s/ })).toBeDefined()
  expect(calls.filter(c => c.startsWith('gh ')).length).toBe(asked) // the next poll is 10 s after the last
  await ui.unmount()
})

test('a push Claude runs shows its CI run until it finishes, then the result', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T00:00:00Z') })
  let state = 'in_progress'
  const calls: string[] = []
  const at = () => new Date(clock.now()).toISOString()
  await startSession($, on, { ciPush: true }, argv => {
    calls.push(argv)
    if (argv === 'git remote get-url origin') return 'git@github.com:o/r.git'
    if (argv.startsWith('gh run list -R o/r --branch main'))
      return JSON.stringify([{ databaseId: 7, status: state, conclusion: state === 'completed' ? 'success' : '', workflowName: 'CI', headSha: 'b', event: 'push', createdAt: at(), updatedAt: at() }])
    if (argv.startsWith('gh run view 7 -R o/r'))
      return JSON.stringify({ jobs: [{ name: 'test', status: 'completed', conclusion: 'success' }, { name: 'deploy', status: state, conclusion: state === 'completed' ? 'success' : '' }] })
    return null
  })
  const ui = await $.ui.mount(BAND)
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  await clock.advance(1_000)
  expect(await ui.find({ type: 'Text', text: /⟳ deploying/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^r main/ })).toBeDefined()
  state = 'completed'
  await clock.advance(11_000)
  expect(await ui.find({ type: 'Text', text: /✓ deployed/ })).toBeDefined()
  await clock.advance(11 * 60_000)
  expect(await ui.find({ type: 'Text', text: /deployed/ })).toBeUndefined()
  await ui.unmount()
})

test('with the CI switches off, a push calls nothing', async ($, on) => {
  const clock = mock.clock(on)
  const calls: string[] = []
  await startSession($, on, {}, argv => (calls.push(argv), null))
  const ui = await $.ui.mount(BAND)
  await $.tool.call({ tool: 'Bash', command: 'git push' } as never)
  await clock.advance(70_000)
  expect(calls.filter(c => c.startsWith('gh'))).toEqual([])
  await ui.unmount()
})

test('the branch switch shows the latest run of the branch the session is on', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T00:00:00Z') })
  await startSession($, on, { ciBranch: true }, argv => {
    if (argv === 'git branch --show-current') return 'develop\n'
    if (argv === 'git remote get-url origin') return 'https://github.com/o/r.git\n'
    if (argv.startsWith('gh run list -R o/r --branch develop'))
      return JSON.stringify([{ databaseId: 8, status: 'completed', conclusion: 'failure', workflowName: 'CI', headSha: 'c', event: 'push', createdAt: '2026-10-01T23:00:00Z', updatedAt: '2026-10-01T23:10:00Z' }])
    if (argv.startsWith('gh run view 8')) return JSON.stringify({ jobs: [{ name: 'pytest', status: 'completed', conclusion: 'failure' }] })
    return null
  }, true)
  const ui = await $.ui.mount(BAND)
  await clock.advance(6_000)
  expect(await ui.find({ type: 'Text', text: /✗ pytest failed · 50m ago/ })).toBeDefined()
  await ui.unmount()
})

test('the card says whether Claude is working, in its accent while it is', async ($, on) => {
  mock.clock(on)
  const idle = await $.ui.mount(BAND)
  expect(await idle.find({ type: 'Text', text: /^ {3}○ idle$/ })).toBeDefined()
  await idle.unmount()
  const busy = await $.ui.mount({ ...(BAND as object), props: { ...(BAND as { props: object }).props, isWorking: true } } as never)
  const working = (await busy.find({ type: 'Text', text: /^● working$/ })) as unknown as { props: { color?: string } } | undefined
  expect(working?.props.color).toBe('claude')
  await busy.unmount()
})

test('⟲ compact asks once more, then runs /compact; unconfirmed, it disarms', async ($, on) => {
  const clock = mock.clock(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ran: unknown[] = []
  on('command.run', { command: 'compact' }, ($, e) => (ran.push(e), { text: 'Compacted' }))
  const ui = await $.ui.mount(BAND)
  await $.session.measure({ context: { tokens: 620_000, window: 1_000_000, percent: 62 }, rateLimits: [], changed: ['context'] } as never)
  await ui.press({ key: 'compact' })
  expect(ran).toEqual([])
  expect(await ui.find({ type: 'Button', text: /^confirm$/ })).toBeDefined()
  await clock.advance(6_000)
  expect(await ui.find({ type: 'Button', text: /⟲ compact/ })).toBeDefined() // not confirmed in time
  await ui.press({ key: 'compact' })
  await ui.press({ key: 'compact' })
  expect(ran).toMatchObject([{ command: 'compact' }])
  expect(await ui.find({ type: 'Button', text: /⟲ compact/ })).toBeDefined() // ready again once it ran
  await ui.unmount()
})

test('a /compact the engine refuses to run says why in a toast', async ($, on) => {
  mock.clock(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  // nothing answers command.run, so $.command.run rejects (a compaction that runs and fails prints in the transcript)
  const toasts: string[] = []
  on('ui.toast', ($, e) => (toasts.push((e as { text: string }).text), { value: undefined }) as never)
  const ui = await $.ui.mount(BAND)
  await $.session.measure({ context: { tokens: 20_000, window: 1_000_000, percent: 2 }, rateLimits: [], changed: ['context'] } as never)
  await ui.press({ key: 'compact' })
  await ui.press({ key: 'compact' })
  expect(toasts.at(-1)).toMatch(/^Could not compact: /)
  expect(await ui.find({ type: 'Button', text: /⟲ compact/ })).toBeDefined()
  await ui.unmount()
})

const MEASURE = { context: { tokens: 620_000, window: 1_000_000, percent: 62 }, rateLimits: [], changed: ['context'] } as never

test('two quick presses on confirm compact once', async ($, on) => {
  const clock = mock.clock(on)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ran: unknown[] = []
  on('command.run', { command: 'compact' }, async ($, e) => (ran.push(e), await clock.sleep(1_000), { text: 'Compacted' }))
  const ui = await $.ui.mount(BAND)
  await $.session.measure(MEASURE)
  await ui.press({ key: 'compact' })
  const a = ui.press({ key: 'compact' }).catch(() => undefined)
  const b = ui.press({ key: 'compact' }).catch(() => undefined)
  await clock.advance(2_000)
  await Promise.all([a, b])
  expect(ran.length).toBe(1)
  await ui.unmount()
})

test('an arming whose timer was lost (a reload) has lapsed: a lone press later arms, never compacts', async ($, on) => {
  let t = 0
  on('clock.now', () => ({ value: t }) as never)
  on('clock.after', () => ({ deny: 'cancelled, as a reload cancels it' }) as never)
  on('clock.every', () => ({ deny: 'no ticks' }) as never)
  on('session.measure', ($, e) => ({ changed: e.changed }))
  const ran: unknown[] = []
  on('command.run', { command: 'compact' }, ($, e) => (ran.push(e), { text: 'Compacted' }))
  const ui = await $.ui.mount(BAND)
  await $.session.measure(MEASURE)
  await ui.press({ key: 'compact' })
  t += 60 * 60_000
  await ui.press({ key: 'compact' })
  expect(ran).toEqual([])
  expect(await ui.find({ type: 'Button', text: /^confirm$/ })).toBeDefined() // armed afresh
  await ui.unmount()
})

test('a push follows the repo it reported, not the session folder', async ($, on) => {
  const clock = mock.clock(on, { now: Date.parse('2026-10-02T00:00:00Z') })
  const calls: string[] = []
  on('store.get', () => ({ value: { ciPush: true } }) as never)
  on('command.register', () => ({ value: { command: 'statuspane' } }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] } }) as never)
  on('session.cwd', () => ({ value: '/w/r' }))
  on('session.repo', () => ({ value: { root: '/w/r' } }) as never)
  on('process.run', ($, e) => {
    const argv = e.argv.join(' ')
    calls.push(argv)
    const out = argv === 'git remote get-url origin' ? 'git@github.com:o/r.git' : argv === 'git branch --show-current' ? 'main' : null
    return { value: { exitCode: out === null ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: { stdout: '', stderr: 'To github.com:o/other.git\n   6386f32..e4f5a6b  main -> main', interrupted: false } }) as never)
  mock.env(on, { HOME: '/home/u' })
  await $.session.start({ cwd: '/w/r', surface: null, isInteractive: true } as never)
  await $.tool.call({ tool: 'Bash', command: 'git -C ../other push' } as never)
  await clock.advance(1_000)
  expect(calls.some(c => c.startsWith('gh run list -R o/other --branch main'))).toBe(true)
  expect(calls.some(c => c.startsWith('gh run list -R o/r --branch main'))).toBe(false)
})

test('the desktop app draws no card, only what lies beneath', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e as never) as { Text: (p: object) => unknown }
    return h(Text as never, {}, 'from below') as never
  })
  const ui = await $.ui.mount({ ...(BAND as object), surface: 'desktop' } as never)
  expect(await ui.find({ type: 'Text', text: /from below/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeUndefined()
  await ui.unmount()
})

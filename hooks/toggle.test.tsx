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
  on('store.get', () => ({ value: undefined }) as never)
  on('store.set', ($, e) => (saved.push(e), { value: undefined } as never))
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

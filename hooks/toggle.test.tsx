import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const BAND = {
  plugin: 'statuspane', surface: 'terminal', component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} },
} as never

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

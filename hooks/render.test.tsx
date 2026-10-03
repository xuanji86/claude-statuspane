import { expect, mock, test } from 'claude-code/testing'

test('the card validates and draws on the terminal', async ($, on) => {
  mock.clock(on)
  const ui = await $.ui.mount({
    plugin: 'statuspane', surface: 'terminal', component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120, scroll: { offset: 0, bodyRows: 19 }, view: {} },
  } as never)
  expect(await ui.find({ type: 'Text', text: /ctx/ })).toBeDefined()
  await ui.unmount()
})

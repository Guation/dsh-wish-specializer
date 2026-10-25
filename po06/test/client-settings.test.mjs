import test from 'node:test'
import assert from 'node:assert/strict'
import { loadHoldClient } from './fixtures/client-hold-harness.mjs'

const plain = value => JSON.parse(JSON.stringify(value))
const nodes = node => !node || typeof node !== 'object' ? []
  : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.children)]

async function options(ui, bar) {
  const button = bar.find(node => node.props?.['data-po06'] === 'options-btn')
  assert.ok(button)
  button.props.onClick()
  await ui.flush()
  assert.ok(bar.find(node => node.props?.['data-po06'] === 'options-pop'))
}

test('options omit the removed tone selector while English and advisor retain their red/green controls', async t => {
  const ui = loadHoldClient({ deferStatus: true }); t.after(() => ui.close())
  const bar = ui.mount('a', '原始输入')
  ui.completeStatus(undefined, { settings: { permission: 'auto', advisor: true, englishMode: true, framing: 'hard',
    presetNoticeDismissed: true, bySession: { a: { tier: 'standard', framing: 'hard' } } },
    sessionEffective: { advisor: true, englishMode: true, framing: 'hard' }, english: { ready: true } })
  await ui.flush()
  await options(ui, bar)
  assert.equal(bar.find(node => node.props?.name === 'framing' || node.props?.['data-po06'] === 'framing'), null)
  assert.equal(bar.find(node => node.children?.some(child => typeof child === 'string' && /^(Tone|协作基调|硬邦邦|Hard|Plain)$/.test(child))), null)
  for (const [name, component] of [['advisor', ui.mod.__debug.AdvisorControls], ['english-mode', ui.mod.__debug.EnglishControls]]) {
    const control = bar.find(node => node.type === component)
    assert.ok(control, name + ' remains in the options panel')
    assert.equal(control.props.ready, true)
    const segmented = nodes(component(control.props)).find(node => node.props?.name === name)
    assert.ok(segmented)
    assert.deepEqual(plain(segmented.props.options), ['off', 'on'])
    assert.deepEqual(plain(segmented.props.tones), { off: '#e05a5a', on: '#3fbf7f' })
    assert.equal(segmented.props.value, 'on')
    assert.equal(segmented.props.disabled, false)
  }
  assert.equal(ui.pending('/settings').length, 0, 'Reading old status must not write user preferences')
})

test('changing a session tier drops legacy tone and stale expanded tier values but keeps independent settings', async t => {
  const ui = loadHoldClient({ deferStatus: true }); t.after(() => ui.close())
  const bar = ui.mount('a', '原始输入')
  const independent = { reasoningBoost: true, reasoningMode: 'parallel', reasoningCandidates: 3,
    reasoningRounds: 1, reasoningPace: 'fast', englishMode: true }
  const other = { tier: 'off', englishMode: false }
  ui.completeStatus(undefined, { settings: { permission: 'auto', advisor: false, framing: 'hard',
    presetNoticeDismissed: true, bySession: {
      a: { tier: 'light', assist: 'auto', detail: 'minimal', budget: 'minimal', framing: 'hard', ...independent },
      b: other,
    } }, sessionEffective: { advisor: false, ...independent }, sessionDescribed: { tier: 'light' }, english: { ready: true } })
  await ui.flush()
  await options(ui, bar)
  const tier = bar.find(node => node.props?.name === 'tier')
  assert.ok(tier)
  await tier.props.onPick('heavy')
  await ui.flush()
  const writes = ui.pending('/settings')
  assert.equal(writes.length, 1)
  assert.deepEqual(plain(writes[0].body), { bySession: { a: { ...independent, tier: 'heavy' }, b: other } })
  assert.equal(ui.pending('/interpret').length, 0)
  assert.equal(ui.submissions.length, 0)
  assert.equal(bar.draft, '原始输入')
})

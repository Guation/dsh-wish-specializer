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

test('options omit the removed tone selector while English and advisor remain explicit accessible switches', async t => {
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
    const compact = component(control.props)
    const toggle = compact.type(compact.props)
    assert.equal(toggle.props.role, 'switch')
    assert.equal(toggle.props['aria-checked'], true)
    assert.equal(toggle.props['data-po06'], name + '-toggle')
    assert.equal(toggle.props.disabled, false)
  }
  assert.equal(ui.pending('/settings').length, 0, 'Reading old status must not write user preferences')
})

test('changing a session tier drops legacy tone and stale expanded tier values but keeps independent settings', async t => {
  const ui = loadHoldClient({ deferStatus: true }); t.after(() => ui.close())
  const bar = ui.mount('a', '原始输入')
  const independent = { reasoningBoost: true, reasoningMode: 'parallel', reasoningCandidates: 3,
    reasoningRounds: 1, reasoningPace: 'fast', englishMode: true, modelState: 'extreme' }
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

test('control plane unavailable still sends the original text (real fail-open)', async t => {
  const ui = loadHoldClient(); t.after(() => ui.close())
  const bar = ui.mount('a', '原始输入，控制面挂了也要能发')
  await ui.flush()
  assert.equal(bar.enter().defaultPrevented, true)
  await ui.flush()
  ui.completeInterpret()
  await ui.flush()
  const commit = ui.pending('/packet').at(-1)
  assert.ok(commit, 'should attempt one commit')
  commit.respond({ ok: false, reason: 'unreachable' }, 503)
  await ui.flush()
  assert.equal(ui.submissions.length, 1, 'message must not be blocked by a dead backend')
  assert.equal(ui.submissions[0].text, '原始输入，控制面挂了也要能发', 'send the user original unchanged')
  assert.equal(ui.submissions[0].commit, undefined, 'no packet is claimed when the backend is down')
})

test('the options index expands one group at a time without writing settings', async t => {
  const ui=loadHoldClient();t.after(()=>ui.close());const bar=ui.mount('a')
  await ui.flush();await options(ui,bar)
  const group=id=>bar.find(n=>n.props?.['data-po06']==='group-'+id)
  for(const id of ['generation','context','tools'])assert.equal(group(id).props['aria-expanded'],false)
  assert.equal(bar.find(n=>n.props?.anchor==='model'),null)
  group('generation').props.onClick();await ui.flush()
  assert.equal(group('generation').props['aria-expanded'],true)
  assert.ok(bar.find(n=>n.props?.anchor==='model'))
  group('context').props.onClick();await ui.flush()
  assert.equal(group('generation').props['aria-expanded'],false)
  assert.equal(group('context').props['aria-expanded'],true)
  assert.equal(bar.find(n=>n.props?.anchor==='model'),null)
  group('context').props.onClick();await ui.flush()
  assert.equal(group('context').props['aria-expanded'],false)
  assert.equal(ui.pending('/settings').length,0)
  assert.equal(ui.submissions.length,0)
})

test('compact toggles retain global advisor and per-session English save scopes',async t=>{
  const ui=loadHoldClient({deferStatus:true});t.after(()=>ui.close());const bar=ui.mount('a')
  ui.completeStatus(undefined,{settings:{permission:'auto',advisor:true,presetNoticeDismissed:true,bySession:{a:{tier:'heavy',modelState:'extreme'}}},
    sessionEffective:{advisor:true,englishMode:false,modelState:'extreme'},sessionDescribed:{tier:'heavy'},english:{ready:true}})
  await ui.flush();await options(ui,bar)
  for(const [component,expected]of [[ui.mod.__debug.AdvisorControls,{advisor:false}],[ui.mod.__debug.EnglishControls,{bySession:{a:{tier:'heavy',modelState:'extreme',englishMode:true}}}]]){
    const node=bar.find(n=>n.type===component),compact=component(node.props),toggle=compact.type(compact.props)
    toggle.props.onClick();await ui.flush()
    assert.deepEqual(plain(ui.pending('/settings').at(-1).body),expected)
  }
  assert.equal(ui.submissions.length,0)
})


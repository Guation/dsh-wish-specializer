import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCollaboration, createCapability } from '../lib/capability.js'
import { parseOptimizerValue } from '../lib/optimizer-protocol.js'

test('cached optimizer summaries keep advice and provenance but cannot reintroduce retired metadata', () => {
  const parsed = parseOptimizerValue({intent:{text:'Keep this task',relation:'continue'},add:[{id:'a1',text:'Useful production direction.'}],scaffold:[{id:'s1',text:'A repeatable feedback capability.'}],ask:[{id:'q1',question:'Which outcome matters?'}]})
  assert.equal(parsed.ok,true)
  const legacy = {...parsed.optimizer, hardNote:'obsolete pep talk', hardOn:['a1'], framing:'hard', framingNote:'obsolete note', framingNoteRaw:{note:'obsolete cached note'}}
  const before = structuredClone(legacy)
  const clean = normalizeCollaboration({optimizer:legacy})
  for(const key of ['hardNote','hardOn','framing','framingNote','framingNoteRaw']) assert.equal(Object.hasOwn(clean.optimizer,key),false,key)
  assert.deepEqual(clean.optimizer.add,parsed.optimizer.add);assert.deepEqual(clean.optimizer.scaffold,parsed.optimizer.scaffold);assert.deepEqual(clean.optimizer.ask,parsed.optimizer.ask)
  assert.deepEqual(clean.optimizer.sourceIds,parsed.optimizer.sourceIds)
  assert.deepEqual(legacy,before,'Reading a historical value must not mutate it')
  const capability = createCapability()
  const token = capability.beginInput('s','m','Keep this task')
  assert.equal(capability.settle('s',token,{optimizer:legacy}).ok,true)
  assert.deepEqual(capability.status('s').current.optimizer,clean.optimizer)
  assert.equal(JSON.stringify(capability.status('s')).includes('obsolete pep talk'),false)
})

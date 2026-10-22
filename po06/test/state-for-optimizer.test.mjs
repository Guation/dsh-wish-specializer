// 2026-10-22 真机：用户只发“继续”，注入却把上一轮自己提的五项又讲了一遍——
// 因为它把自己上一轮的建议当成“未完成的用户需求”喂了回去。
// 本测试钉住分界：**建议是给工作模型的，不是给下一轮优化器的**。
import test from 'node:test'
import assert from 'node:assert/strict'
import { stateForOptimizer } from '../lib/pipeline.js'

const state = {
  revision: 3,
  turnId: 't1',
  items: [
    { id: 'req-1', kind: 'user_requirement', status: 'active', text: '做个陀螺' },
    { id: 'opt3-x-add-0', kind: 'proposal', status: 'active', text: '把两段拖拽做成有反馈的', optimizerSection: 'add' },
    { id: 'opt3-x-scaffold-1', kind: 'proposal', status: 'active', text: '手势回放', optimizerSection: 'scaffold' },
    { id: 'opt3-x-ask-1', kind: 'unknown', status: 'active', text: '存档要不要做', optimizerSection: 'ask' },
  ],
  counts: { items: 4, unsourced: 0 },
}

test('只把用户侧意图交给优化器，自己的建议一律不过去', () => {
  const out = stateForOptimizer(state)
  assert.deepEqual(out.items.map((i) => i.id), ['req-1'])
  assert.equal(out.counts.items, 1)
  assert.equal(out.revision, 3, '其余字段原样保留')
})

test('没有可过滤的内容时原样返回（不做无意义的拷贝）', () => {
  const plain = { revision: 1, items: [{ id: 'req-1', kind: 'user_requirement' }] }
  assert.equal(stateForOptimizer(plain), plain)
  assert.equal(stateForOptimizer(null), null)
})

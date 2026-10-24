// 2026-10-23 实测：开着硬邦邦，注入文仍是中性——因为 0.9 的注入文由 renderOptimizerPacket 生成，
// 根本不经过 compiler。这条守卫钉住“真实注入路径也要换装”。
import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOptimizerPacket } from '../lib/optimizer-protocol.js'
import { applyFramingToPacket } from '../lib/framing.js'

const optimizer = { intent: { text: '做个跑车', relation: 'new' }, add: ['先把比例立住'], scaffold: ['固定机位对照'], ask: ['要联机吗'] }
const packet = renderOptimizerPacket(optimizer, 'zh', { userText: '做个跑车' })

test('neutral：注入文原样不动', () => {
  assert.equal(applyFramingToPacket(packet, 'neutral', 'zh'), packet)
})

test('hard：前言与节标题换装，内容与顺序不变', () => {
  const out = applyFramingToPacket(packet, 'hard', 'zh')
  assert.ok(out.startsWith('【协作基调'), '基调块要在最前')
  assert.ok(out.includes('【要干的事】'), '标题要换')
  assert.equal(out.includes('【制作建议】'), false, '不能残留中性标题')
  assert.ok(out.includes('先把比例立住'), '建议内容不能丢')
  assert.ok(out.includes('固定机位对照'), '脚手架不能丢')
})

test('hard + en：英文换装，不夹中文', () => {
  // 英文包的条目本身要是英文：sanitizeMachineText 会丢掉混进来的中文行（那是设计），
  // 用中文条目去测英文标题，只会得到一个空包。
  const enOptimizer = { intent: { text: 'build a car', relation: 'new' }, add: ['fix the proportions'], scaffold: ['fixed camera'], ask: ['online?'] }
  const enPacket = renderOptimizerPacket(enOptimizer, 'en', { userText: 'build a car' })
  const out = applyFramingToPacket(enPacket, 'hard', 'en')
  assert.ok(out.includes('[What to build]'))
  assert.equal(/[\u4e00-\u9fff]/.test(out), false, '英文包不能夹中文')
})

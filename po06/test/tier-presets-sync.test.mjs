// 档位预设必须两边一致（2026-10-19 真机：选「标准」被反推成「轻度」、选「轻度」变「自定义」）。
//
// 宿主 settings.js 的 TIER_PRESETS 决定写进去的三项值；client.js 的 TIER_PRESETS_LOCAL
// 用同一组值反推当前档位。两者一旦错位，界面就会“点了跳回去”——这条把它钉死。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TIER_PRESETS, TIER_LEVELS } from '../lib/settings.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

function clientPresets() {
  const at = CLIENT_SRC.indexOf('const TIER_PRESETS_LOCAL = Object.freeze({')
  assert.ok(at > 0, 'client 里要有 TIER_PRESETS_LOCAL')
  const body = CLIENT_SRC.slice(at, CLIENT_SRC.indexOf('})', at))
  const out = {}
  const re = /(\w+): \{ assist: '([a-z]+)', detail: '([a-z]+)', budget: '([a-z]+)' \}/g
  let m
  while ((m = re.exec(body))) out[m[1]] = { assist: m[2], detail: m[3], budget: m[4] }
  return out
}

test('四档预设与宿主逐项一致（否则界面反推出的档位会错）', () => {
  const c = clientPresets()
  assert.deepEqual(Object.keys(c).sort(), [...TIER_LEVELS].sort())
  for (const k of TIER_LEVELS) assert.deepEqual(c[k], TIER_PRESETS[k], '档位 ' + k + ' 两侧不一致')
})

test('四档的三项组合两两不同（反推才不会撞车）', () => {
  const seen = new Set()
  for (const k of TIER_LEVELS) {
    const p = TIER_PRESETS[k]
    const key = [p.assist, p.detail, p.budget].join('|')
    assert.equal(seen.has(key), false, '两个档位组合相同：' + k)
    seen.add(key)
  }
})

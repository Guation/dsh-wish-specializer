// 分段控件的动效与档位特效（2026-10-19 用户要求）。
//
// 目标：点击档位/英文等分段控件时，选中指示器**滑过去**；档位另有主题特效：
//   关闭 = 无特效；轻度 = 绿 + 少量粒子；标准 = 蓝 + 粒子；重度 = 紫 + 强湍流 + 轻微颤抖。
// 不靠百分比硬算位置（padding/gap 会差 1~2px），而是量真实格子。
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLIENT_SRC = readFileSync(join(HERE, '..', 'lib', 'client.js'), 'utf8')

test('选中指示器是滑动药丸：量真实格子 + left/width 过渡', () => {
  assert.ok(CLIENT_SRC.includes("'data-po06': 'seg-ind'"), '要有指示器节点')
  assert.ok(/offsetLeft/.test(CLIENT_SRC) && /offsetWidth/.test(CLIENT_SRC), '位置要量真实格子')
  assert.ok(/transition: 'left \.26s cubic-bezier/.test(CLIENT_SRC), '滑动过渡')
  assert.ok(/itemRefs\.current\[k\] = el/.test(CLIENT_SRC), '每个格子要有 ref')
})

test('档位四档：关闭无特效，轻/标准/重度的颜色与粒子数递增', () => {
  const at = CLIENT_SRC.indexOf('const TIER_FX = {')
  const block = CLIENT_SRC.slice(at, at + 400)
  assert.ok(block.includes("light:    { color: '#3fbf7f', dots: 6"), '轻度=绿')
  assert.ok(block.includes("standard: { color: '#4a8bff', dots: 10"), '标准=蓝')
  assert.ok(block.includes("heavy:    { color: '#a06bff', dots: 16"), '重度=紫')
  assert.ok(!block.includes('off:'), '关闭档不要特效')
  assert.ok(CLIENT_SRC.includes("name === 'tier' && !disabled ? TIER_FX[value]"), '只有档位控件挂特效')
  assert.ok(/data-po06-fx/.test(CLIENT_SRC), '要有可核对的标记')
})

test('湍流与颤抖：重度才有 shake，粒子有 turb 动画', () => {
  assert.ok(CLIENT_SRC.includes('po06-turb'), '粒子湍流关键帧')
  assert.ok(CLIENT_SRC.includes('po06-shake'), '颤抖关键帧')
  const re = /value === 'heavy' \? \{ animation: 'po06-shake 1\.1s ease-in-out infinite' \}/
  assert.ok(re.test(CLIENT_SRC), '只有重度档加颤抖')
  assert.ok(/animation: 'po06-turb ' \+ fx\.speed/.test(CLIENT_SRC), '粒子按档位速度跑')
})

test('无障碍与降级：区域仍可键盘操作，减少动效时全部停掉', () => {
  assert.ok(/role: 'slider'/.test(CLIENT_SRC), '仍然是 slider 语义')
  assert.ok(/ArrowLeft/.test(CLIENT_SRC) && /Home/.test(CLIENT_SRC), '方向键/Home/End 仍在')
  assert.ok(/prefers-reduced-motion: reduce/.test(CLIENT_SRC), '尊重系统"减少动态效果"')
})

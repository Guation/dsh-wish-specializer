// 分段控件的动效与档位特效（2026-10-19 用户要求，同日二次调整）。
//
// 目标：
//   · 点击档位/英文等分段控件时，选中指示器**滑过去**；
//   · 档位特效：关闭无；轻度只有绿色底（**无粒子**）；标准蓝色 + 无序随机线性飘动；
//     重度紫色底 + **白色粒子从右向左像流星一样冲** + 轨道轻微颤抖。
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

test('四档：关闭无特效；轻度只有底色；标准飘动；重度白色流星', () => {
  const at = CLIENT_SRC.indexOf('const TIER_FX = {')
  const block = CLIENT_SRC.slice(at, at + 500)
  assert.ok(block.includes("light:    { color: '#3fbf7f', dots: 0"), '轻度不要粒子')
  assert.ok(block.includes("standard: { color: '#4a8bff', dots: 9,  motion: 'drift'"), '标准=飘动')
  assert.ok(block.includes("heavy:    { color: '#a06bff', dots: 14, motion: 'meteor', dotColor: '#fff'"), '重度=白色流星')
  assert.ok(CLIENT_SRC.includes("name === 'tier' && !disabled ? TIER_FX[value]"), '只有档位控件挂特效')
})

test('两种粒子运动各有自己的关键帧与参数', () => {
  assert.ok(CLIENT_SRC.includes('po06-drift'), '飘动关键帧')
  assert.ok(CLIENT_SRC.includes('po06-meteor'), '流星关键帧')
  assert.equal(CLIENT_SRC.includes('po06-turb'), false, '旧的湍流关键帧应已退出')
  assert.ok(/animation: 'po06-meteor ' \+ dur\.toFixed\(2\)/.test(CLIENT_SRC), '流星按各自时长跑')
  assert.ok(/animation: 'po06-drift ' \+ dur\.toFixed\(2\)/.test(CLIENT_SRC), '飘动按各自时长跑')
  assert.ok(CLIENT_SRC.includes("'--dx': dx + 'px'") && CLIENT_SRC.includes("'--dy': dy + 'px'"), '飘动方向由每个粒子自己决定')
  assert.ok(/gradient\(90deg, rgba\(255,255,255,0\)/.test(CLIENT_SRC), '流星是白色拖尾')
  assert.ok(CLIENT_SRC.includes("left: '100%'"), '流星从右侧轨道外进入')
  assert.ok(CLIENT_SRC.includes("'--dist'"), '行程由每个粒子自己的 --dist 决定')
  assert.ok(CLIENT_SRC.includes('Math.round(trackW * gap)'), '行程按轨道宽度算（不同粒子 0.88~1.16 倍）')
  assert.ok(/const len = 5 \+ \(i \* 7\) % 13/.test(CLIENT_SRC), '长度随机 5~17px')
  assert.ok(/const dur = 0\.9 \+ /.test(CLIENT_SRC), '速度随机 0.9~2.4s')
  assert.ok(/opacity:0\}8%\{opacity:\.95\}70%\{opacity:\.7\}100%/.test(CLIENT_SRC), '进入时淡入、到左边缘前淡出')
})

test('重度才有颤抖；帮助弹层用更轻的入场（避免大块文字重绘卡顿）', () => {
  assert.ok(/value === 'heavy' \? \{ animation: 'po06-shake 1\.1s ease-in-out infinite' \}/.test(CLIENT_SRC), '只有重度档加颤抖')
  assert.ok(CLIENT_SRC.includes('po06-help'), '帮助弹层单独一条轻动画')
  assert.ok(CLIENT_SRC.includes('animation:po06-help'), '帮助弹层不再用带缩放的 po06-pop')
  assert.ok(CLIENT_SRC.includes("contain: 'content'"), '帮助弹层做渲染隔离')
})

test('无障碍与降级：区域仍可键盘操作，减少动效时全部停掉', () => {
  assert.ok(/role: 'slider'/.test(CLIENT_SRC), '仍然是 slider 语义')
  assert.ok(/ArrowLeft/.test(CLIENT_SRC) && /Home/.test(CLIENT_SRC), '方向键/Home/End 仍在')
  assert.ok(/prefers-reduced-motion: reduce/.test(CLIENT_SRC), '尊重系统"减少动态效果"')
})

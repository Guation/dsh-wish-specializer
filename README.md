# 许愿特化器 · Wish Specializer

**v0.9.0-beta-1** · DSH Web 插件 · 包名 `@dsh-external/dsh-wish-specializer`

**中文** ｜ [English](README.en.md)

> 把一句话的愿望，特化成工作 AI 真正能照着做的要求。

---

## 它是什么

中间那些**决定成品好坏、但你没说出口**的东西——
审美基调、光影与材质、构图与层次、场景与氛围、交互与状态、以及"做到什么算过"——
由它在你按下发送**之前**补上，随原话一起交给工作 AI。

一句话：**你的话一个字不改，缺的那半句由它补。**

## 它不是什么

- **不改写你的原话**，也不删减、不缩小、不替你改口；
- **不替你拍板**：会改变交付形态的架构分叉，永远留给你；
- **不记"验收通过"**：顾问只给方向和复核，通过与否由你决定；
- **不发 npm**（`private: true`），只从 Release 附件分发；
- **不动宿主**：不改 DSH 的界面文件、不改会话事件格式。

## 效果对比

环境：Windows + DSH + PTC 预设，一次成图（OneShot），插件档位「重度」，模型 DeepSeek-V4.1-Flash。

![](./docs/image/contrast_small.png)

提示词（原样）：

> 不要预览文件夹内的其他文件，制作一个单html程序，要求是极其精细的现代主战坦克模型，可以预览，操控，真实，帅气，炫技写真。

## 它补哪些方向

| 方向 | 补的是什么 |
|---|---|
| 审美基调 | 这一版要冷硬还是温润、写实还是风格化 |
| 光影与材质 | 主光方向、对比度、反射与粗糙度、做旧还是崭新 |
| 构图与层次 | 主体占比、前景中景背景怎么分、视觉重心在哪 |
| 场景与氛围 | 环境光、大气、地面与背景，别让主体悬空 |
| 交互与状态 | 能怎么操作、悬停/点击/拖拽给什么反馈、边界在哪 |
| 验收口径 | 一句话说清"怎样算做到"，省得来回返工 |

补充是**方向性要求**，不是实现步骤、不写代码、不写数值参数——具体怎么做交给工作 AI。

## 按任务补齐临时工具箱（本地候选功能）

复杂任务需要反复修改、测量或比较时，优化器会判断是否值得复用、扩展或搭建任务内工具；简单修改可直接跳过，环境未知时先查明。工作 AI 负责选择实现、实际调用、读取反馈和继续修改。它不会因此替换你指定的技术栈，也不会把制作工具变成新的交付要求。

候选代码默认按需判断；设置 `toolboxMode: "off"` 可单独关闭，全局或 `bySession` 覆盖均可。关闭整体优化也会关闭此项，顾问开关与它独立。当前没有新增专用面板按钮，可通过既有设置 API 写入该键。关闭会清掉旧注入包，保留已生成工具和产物；再次开启后按新一轮任务处理。

已实际调用的任务工具会保留入口、使用对象和最近结果，支持继续任务及重启后复查。历史成功不等于当前可用，截图路径不等于模型看过；只有实际读取并用于后续修改，才构成反馈闭环。

[实施进度](docs/TASK-TOOLBOX-IMPLEMENTATION.md)与[受控 Three.js 试点](po06/experiments/task-toolbox/RESULTS.md)记录了已验证范围；自然任务收益与当前宿主加载仍以实际验证结果为准。

## 30 秒用起来

1. 装好插件（见下），面板上把**档位**拨到「标准」或「重度」（「关闭」不拦截、不注入）；
2. 照常输入，按 **回车**；
3. 拦截面板里看一眼补充内容：「确认」放行，「跳过并直接发送」按原文直接发；
4. 想更快：**双击 Enter** 直接跳过本轮优化（默认开，600ms 内两次回车）；
5. 发出去之后，消息下方有「本次注入」卡片，能看到这一轮到底往上下文里塞了什么。

## 四个档位

| 档位 | 补充程度 | 解释包预算 | 最多澄清几问 |
|---|---|---|---|
| 关闭 | 只记录、不补充 | — | — |
| 轻度 | 2–3 条最影响成品的方向 | 700 字 | 1 |
| 标准 | 4–6 条 + 一句验收口径 | 1200 字 | 2 |
| 重度 | 把决定成败的几条写透 + 阶段建议 | 2000 字 | 3 |

档位只放宽"补多少 / 问几个"，**不放大你的决策权**。

## 面板里还有什么

- **顾问**：另起一个只读模型独立复核，结论是「必须执行 / 待补」这类可执行方向；
- **权限**：审查（先给出处与依据，你确认）/ 自动（直接生效）；
- **协作基调**：普通 / 硬邦邦；
- **英文模式**：同一轮额外返回忠实英文任务；
- **模型与思考档位**：解释层用哪个模型、思考强度多大；
- **上下文**：读最近几回合，或读你手上保留的全部；
- **只读工具 / 内置 Bash**：允许它先看几个项目文件再写要求；
- **双击 Enter 跳过**：默认开；
- **详情**：控制与解释层提示词，看得见、改得动。

## 安装

安装来源只有一个：**本仓库的 Release 附件**（`.tgz`）。

```powershell
$v = '0.9.0-beta-1'; $d = "$env:USERPROFILE\Downloads"
Invoke-WebRequest "https://github.com/WestFox-AwA/dsh-wish-specializer/releases/download/v$v/dsh-external-dsh-wish-specializer-$v.tgz" -OutFile "$d\dsh-external-dsh-wish-specializer-$v.tgz"
Invoke-WebRequest "https://github.com/WestFox-AwA/dsh-wish-specializer/releases/download/v$v/SHA256SUMS-$v.txt" -OutFile "$d\SHA256SUMS-$v.txt"
Get-Content "$d\SHA256SUMS-$v.txt"     # 与下载到的 tgz 比对 sha256
dsh --profile po061 --from-default-profile web --dump-config
dsh plugin --profile po061 add "$d\dsh-external-dsh-wish-specializer-$v.tgz"
dsh --profile po061
```

- 不要从 npm 装：本项目 `private: true`，registry 上的同名/相似包都不是本项目；
- 不要装进 0.5.x 所在的 profile：同装配会被 `DOUBLE_INTERCEPT` 守卫拒绝（刻意的）；
- 装不上时的排查、四步自检、常见报错：见 [`po06/README.md`](po06/README.md)。

## 目录与文档

| 想看的 | 在哪 |
|---|---|
| 使用帮助（面板里的 `?` 同源） | [`po06/HELP-0.6.md`](po06/HELP-0.6.md) |
| 详细安装 / 自检 / 排障 | [`po06/README.md`](po06/README.md) |
| 更新日志 | [`CHANGELOG.md`](CHANGELOG.md) |
| 人工验收清单 | [`po06/HUMAN-TEST.md`](po06/HUMAN-TEST.md) |
| 发版规程 | [`docs/RELEASING.md`](docs/RELEASING.md) |
| 旧版本（0.1–0.6） | [`old/`](old/README.md) |

## 版本与证据

- 当前：**v0.9.0-beta-1**（开发中）；上一个稳定版：v0.8.4-stable
- 全部套件：`node po06/scripts/run-suites.mjs`；发版门：`node po06/scripts/check-release.mjs`
- 兼容：`dsh-0.1.7-rc.2`（实测运行）、`dsh-0.2.0-rc.2`（静态契约核对通过）
- 作者：啃轮胎的西狐 · 💬 QQ 群 **1121399051**（版本公告 / 安装帮助）

## 许可

[BSD-3-Clause](LICENSE) · 完全开源，欢迎以任何形式使用、修改、提建议。

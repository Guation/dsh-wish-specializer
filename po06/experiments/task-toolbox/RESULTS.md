# Three.js 工作工具箱：受控开发试点结果

对应[预登记](PREREGISTER.md)。这是工作模型在本会话直接建工具、执行、观察与修正的真实工程试点；不是独立自然任务 A/B，不证明默认开启后必然省 token，也不证明概念车达到写实成品水平。

## 已完成的实际链路

[制作工具](toolbox.mjs)复用本机 Three.js，提供 init / inspect / edit / capture / export；[命名车辆模型](vehicle.mjs)保留车身、座舱、轮组和尾翼等部件身份。工作模型按以下顺序真实调用并读取了图片：

| 版本 | 动作与可核对反馈 | 后续决定 |
|---|---|---|
| v000 | 首次 inspect：轮组内侧与最大车身范围的间距约 -0.36；尾翼单侧外伸约 0.75；读取实际 hero/top 图像，看见轮胎缩进、尾翼明显过宽 | 先只改轮距 |
| v001 | 用同一 edit 入口把 wheel.track 从 1.8 改为 2.6；inspect 间距约 0.04、尾翼仍 0.75；再读取实际俯视图 | 保留轮组修正，再处理尾翼 |
| v002 | 再用同一入口把 wing.span 从 3.7 改为 2.35；inspect 间距仍约 0.04、尾翼外伸约 0.075；读取最终 hero/top | 两个受控装配问题均有对应改动，停止扩展工具，导出成品 |

测量只描述当前几何范围。间距用最大车宽近似，没有轮拱开口，也不是精确碰撞检查；概念车仍是简化几何、开放轮组，不能把修正数值当成“超跑已写实”。

## 实际画面

同条件俯视，初始版本：

![初始俯视：轮组缩进，尾翼过宽](evidence/initial-top.png)

同条件俯视，完成两次修正：

![修正后俯视：轮组外移，尾翼宽度缩小](evidence/final-top.png)

最终浏览器画面：

![修正后的概念车辆](evidence/final-hero.png)

## 运行与失败记录

- 本机已有 Three.js 0.186.1、Node 和 Edge；没有下载模型、纹理或依赖，没有另起 DSH GUI 服务器。
- 首次隔离浏览器捕获超时在 Page.enable（约 29.1s）；调整启动参数后的第二次仍超时在 Runtime.enable（约 28.7s）。CDP 连接仍可回应 Browser.close，说明不是完全失去浏览器连接。
- 第三次在隔离浏览器增加 no-sandbox 后，WebGL 与固定机位截图恢复：初始约 6.9s、第一次修正约 6.3s、最终约 6.2s。此参数只用于本地受控生成页面的实验进程，不修改用户浏览器或产品设置，不将它写成通用截图要求。
- 三次成功 capture 都返回 1280×800、hero/side/top，页面 exceptions 为空、HTTP(S) 请求为空，渲染记录约 63 个 draw call、2870 个三角形。它证明当前固定画面可渲染，不代表性能基准或交互验收。
- 每次截图启动的浏览器已关闭；未接触用户日常浏览器进程。
- export 得到 6,075,874 字节的独立 HTML，Three.js 内联在文档中；与最终实际截图对应的 artifact.html 字节完全相同，SHA-256 为 e9ac3a6b412c5755ac4f2fe8b152c3f96db37c3445f4da50f954719c284977d8。捕获时已经阻断 HTTP(S)，仍可用 file URL 渲染，不依赖制作服务。

三版原始场景参数、工具结果、图像路径、时间和导出摘要保存在[实际输出记录](evidence/observed-results.json)。浏览器缓存和三份大型 HTML 留在本地试点目录，不将浏览器用户资料或完整依赖复制进源码仓库。

## P3 生产接线验证

[受控集成入口](check-integration.mjs)在新 Node 进程中使用真实 workshop inspect 的 stdout，通过生产 adapter 的事件处理函数写入独立工具索引。事件信封与解释器输出由测试入口构造，因此属于工程集成验证，不冒充当前 DSH 会话自然事件。

结果：一个工具入口进入优化器摘要和工作上下文；continue 后任务键保持；重新创建 store 后入口和实际历史调用仍在，currentAvailability 仍是 unknown，不把历史成功恢复成“进程仍可用”。原始结果也标出来源：任务/调用身份由宿主绑定，工具元数据与产物版本为工具自报；图像路径不会自动成为已观察证据。

另外已用单测覆盖 native/PTC、后台 job_output 回收、晚到旧任务、用户取消、拦截 ID 映射、跨工程/会话、失败报告、重复事件、重启，以及用户审查编辑不能被自动插回旧工具事实。

## 复现方式

使用本机 Node 执行，按环境提供已有 Three.js 和 Edge 路径；不要覆盖已有试点目录：

~~~text
node po06/experiments/task-toolbox/toolbox.mjs init <新目录> --three-root <已有 three 包目录>
node po06/experiments/task-toolbox/toolbox.mjs inspect <目录>
node po06/experiments/task-toolbox/toolbox.mjs capture <目录> initial --edge <Edge 路径>
node po06/experiments/task-toolbox/toolbox.mjs edit <目录> wheel.track 2.6
node po06/experiments/task-toolbox/toolbox.mjs capture <目录> wheels-corrected --edge <Edge 路径>
node po06/experiments/task-toolbox/toolbox.mjs edit <目录> wing.span 2.35
node po06/experiments/task-toolbox/toolbox.mjs capture <目录> final --edge <Edge 路径>
node po06/experiments/task-toolbox/toolbox.mjs export <目录> <输出 HTML 路径>
node po06/experiments/task-toolbox/check-integration.mjs <目录>
~~~

查看截图和测量后再决定改动；上列数值仅用于复现这份受控构造，不成为通用建模规则。最终 HTML 支持视角按钮和拖动，但本轮未把点击/拖动自动化测试纳入证据。

## 尚未完成的证据

- 自然优化器是否合适地提出 none/reuse/build/inspect，并促使工作模型自主建设、使用工具。
- 与冻结基线相比的质量、维护与完整 token/耗时收益；本会话独立 token 计量不可用，明确缺失。
- 当前运行中的 DSH GUI/模型是否实际加载并消费新索引。受控新进程验证不替代 P5 的现场加载。
- 非建模任务迁移与无收益任务的“不搭建”行为。

因此本轮可确认 P2 的真实开发闭环和 P3 的工程接线；P4 自然任务/消融对照及 P5 现场加载与回滚继续保持待完成。

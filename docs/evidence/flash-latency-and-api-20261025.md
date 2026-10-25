# Flash 优化耗时与接口版本错配复查

日期：2026-10-25。基线为产线重构提交 bc1d179。只测试优化，不制作坦克程序、不读取其他项目文件。原始统计见 [测量 JSON](../../po06/eval/LATENCY-20261025.json)。

## 现场错误

用户截图为「这一轮的包没能清掉：invalid-packet-response」。隔离会话的 cancel 探针收到 HTTP 200 和 `{ok:true,reason:null,chars:0,packet:""}`，没有 runId。状态接口同样没有 capability.pipelineRevision，而新客户端要求 runId 和字符串 packet。旧 interpret 成功响应也缺 runId/status，会先触发自动无包发送，再因旧清包响应缺身份而停在失败界面。新客户端没有错误放行；问题是新 UI 与旧宿主模块同时运行。

原生宿主配置的 HMR root 为空，仅客户端热更新在工作；安装别名 URL 还含 node_modules，被原生 HMR 依赖收集排除。不是所有宿主代码都无法热更新，而是这个已安装路径与当前监听配置没有更新宿主图。

修复使用宿主已有配置协调：先禁用旧安装别名，核实原路由已注销；再用真实源码 file URL 激活同一个插件，并只监听 po06/lib。保留本机配置备份 cordis.patch.yml.bak-before-wish-protocol-20261025，没有重启 DSH，也没有改宿主核心代码。现场随后返回 single-run-1 和真实源码 moduleUrl；cancel HTTP 200 回同一 runId 和空 packet。

客户端增加既有状态接口的版本握手，不对旧宿主发起长时间优化，不接受无身份的清包成功，也不把版本错误误报成落盘失败。HTTP 非成功状态不能被 JSON 的 ok:true 覆盖。

## 为什么曾从约 30 秒变成 90 秒

同一坦克请求在旧运行记录中有完整的额外调用证据：2026-10-25T03:38:38 的总耗时 58,221ms，最后一轮模型为 22,542ms，trace 包含 BAD_OPTIMIZER_SHAPE / retryEmpty / fallbackEmpty；03:45:09 的总耗时 145,137ms，主生成工具分支为 109,048ms，包含 tools-fallback 和再次解析重试。把单次模型速度与这些多次调用总耗时混在一起，会误以为 Flash 变慢了三倍。

当前源码已删除工具到无工具的重复生成、解析后再生成和发送后后台再优化。仍可能增加时间的已授权工作有：真实工具续轮、较长历史、高思考档位、英文翻译修复、冷启用闸门/路由。提示词也比早期更长；本次没有用统计实验单独归因它的耗时影响。未降低用户配置的 max 思考强度，也未关闭用户设置的工具或历史。

## 两次真实测量

固定：deepseek-official/deepseek-flash，max，重度，硬邦邦，中文；使用当前用户自定义核心提示。两次顺序执行，无工作模型/评审调用、无语义或网络重试。

| 条件 | 模型调用 | 首个思考增量 | 首个正文 | 生成及本地解析渲染 | 实际工具调用 | 初次解析 |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| 无工具 | 1 | 0.740s | 19.234s | 25.325s | 0 | string intent 未被当时解析器接受 |
| 提供只读工具，根目录为新建空目录 | 1 | 0.758s | 19.350s | 24.175s | 0 | 成功，7/5/3 条 |

每组只有一个样本，顺序与缓存未控制；1.15s 差异不能说明工具更快。没有真实工具调用，不能据此估计多轮工具耗时。测试不含现有会话历史、能力清单、冷闸门/路由与浏览器提交等待，因此不承诺所有真实会话都在 25 秒内。SDK 的 outputTokens 包含未拆分的生成 token，不能当成纯 JSON 正文 token。

## 第一份响应的零调用重放

第一份模型正常 stop，返回完整建议，但 intent 为字符串、relation 在顶层。追加到唯一规范化入口的类型归一化将其变为 intent:{text,relation} 并记录 warning；不制造内容，不再生成一次。原样数据已固化为 [回归样本](../../po06/test/fixtures/flash-tank-string-intent.json)，重放保留 9/7/4 条建议与尾注，最终包 1,686 字符。原始测量的解析失败保留，不改写成当时成功。

结果接口和台账现在同时记录 gateMs、routeMs、promptMs、modelMs、englishRepairMs、taskTranslationMs、optimizationMs、totalMs，下次可以按真正的阶段定位耗时，而不是只看最后一次模型时间。

## 验证范围

客户端使用真实 ControlBar 的 VM/React 夹具验证版本握手、旧响应、HTTP 状态、重挂与无包发送；宿主使用真实 apply 注册的 HTTP/context/event 夹具校验时序和同一 run 的响应。最终全量结果为 151 套件 / 1498 项检查全部通过，原始结果见 [本轮套件产物](../../po06/eval/release-suites.json)。现场已验证的是模块加载标记与隔离 cancel 协议；真实浏览器的新会话操作仍应按实际行为复测，不把探针当作已代用户点击全部按钮。

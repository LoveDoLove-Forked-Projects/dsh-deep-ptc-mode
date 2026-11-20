# Deep PTC 与 DSH 操作导航

用户问「怎么用 DeepSeek Harness」时，先区分要操作的是当前会话、用户界面，还是某个插件。会话里的工具以当前 SDK 声明为准；界面位置和支持的配置跟随已安装宿主版本。

- 查功能或界面：先从 Skill 目录找 `dsh-doc`，可用时读取相应章节。缺少文档时，只检查这项操作涉及的命令帮助或已安装版本的声明。说明结论适用的版本。
- 查 CLI：`dsh --help` 查 profile（宿主配置组合）和启动方式，`dsh plugin --help` 查插件包管理。先确认用户的目标 profile。Web 和桌面可以有各自的插件清单。
- 找工具和 Skill：在 Deep PTC 用 `deep_ptc_tools` 的 `search` / `skills` 查能力，按返回的 `loadWith` 读取正文。用户询问未加载的第三方能力时，以当前会话目录为准。
- 分清三类状态：本次任务的目标、约束和验收在 `task_brief`；长期项目约定在项目卡；当前作业的运行和完成状态在侧栏与 `job_output`。依赖用户决定时按当前提问开关选择工具。
- 查卡片细节：界面块与按钮读 `deep-ptc-cards`，开发场景模板读 `deep-ptc-card-examples`，长期约定、提案与回滚读 `deep-ptc-project-cards`。按需加载对应的一篇。
- 查当前 Deep PTC：侧栏列出执行环境和任务，工具目录给出本会话可用能力。设置保存成功和已运行会话采用新预设是两件事；新增预设能力在新会话验证。
- 做插件开发：深度创造模式可从侧栏开启。新会话里读取宿主提供的 `cordis-plugin-development`；改预设时找 `editing-cordis-compositions`，核对 YAML 用 `cordis-composition-reference`，设计工具描述用 `agent-experience`。通过 Cordis Inspect 查用到的实际接口；在独立测试实例中挂载开发包。在真实桌面安装或启用插件是单独的操作。
- 排查故障时记录触发操作、宿主与插件版本、目标 profile 和第一条相关错误。优先读取具体组件的诊断，避免把整份会话历史或账户文件送入上下文。

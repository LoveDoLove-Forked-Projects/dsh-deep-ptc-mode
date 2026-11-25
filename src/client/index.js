window.__ModuleLoader__.load({ id: 'dsh-deep-ptc-mode', factory: require => {
  const React = require('react');
  const h = React.createElement;
  let ReactDOM;
  try { ReactDOM = require('react-dom'); } catch { /* hosts without portals keep the inline panel */ }
  const NS = 'deep-ptc-settings';
  const inject = ['slots', 'locale', 'configForms'];
  const dictionaries = {
    zh: {
      title: '深度 PTC', summary: '选择执行环境，应用于之后新建的深度 PTC 会话。',
      presetName: '深度 PTC 模式',
      presetDescription: '任务运行时可插话，按任务规模制定计划，意图不清时先提问。支持 WSL、PowerShell、Zsh 和 Bash。',
      presetEnvironment: '当前环境：{env}', presetSafeMode: '当前为安全模式', presetOfficial: '官方默认',
      environment: '执行环境', auto: '自动（Windows：PowerShell；macOS：Zsh；Linux：Bash）',
      wsl: 'WSL Bash（Windows）', powershell: 'PowerShell（Windows）',
      zsh: 'Zsh（macOS / Linux）', bash: '原生 Bash（macOS / Linux）',
      windowsBash: '原生 Bash（Windows）', bashPath: 'bash.exe 的绝对路径',
      bashPathHint: '可填写 dsh-ops 随包的 Niubash。路径不可用时保留官方 Shell。受限模式请选 PowerShell。',
      distribution: 'WSL 发行版', distributionHint: '留空使用 Windows 的默认发行版，例如 Ubuntu。',
      shell: 'Shell 版本', shellAuto: '自动（沿用官方查找顺序）',
      shellSystem: '{name}（系统自带）', shellPreview: 'PowerShell 7 预览版',
      shellHint: '只列出本机已发现的常见版本。文件消失后自动回退。WSL 仍只选择发行版。',
      sessions: '保存后请新建一个“深度PTC模式”会话。已有会话与后台任务保留原环境。',
      wslHint: 'WSL 暂不支持 Windows 的受限沙箱；受限调用会明确失败，不会自动切换或绕过限制。',
      save: '保存', saving: '保存中…', saved: '已保存，新会话将使用所选环境。',
      failed: '未能保存，请检查环境是否适用于宿主、发行版名称及配置是否已被其他窗口修改。',
      readOnly: '当前设置为只读。', loading: '正在读取设置…',
    },
    en: {
      title: 'Deep PTC', summary: 'Choose the execution environment for new Deep PTC sessions.',
      presetName: 'Deep PTC Mode',
      presetDescription: 'Steer running tasks, plan according to task size, and clarify unclear requests. Supports WSL, PowerShell, Zsh, and Bash.',
      presetEnvironment: 'Current environment: {env}', presetSafeMode: 'Safe mode is active', presetOfficial: 'Official default',
      environment: 'Execution environment', auto: 'Automatic (Windows: PowerShell; macOS: Zsh; Linux: Bash)',
      wsl: 'WSL Bash (Windows)', powershell: 'PowerShell (Windows)',
      zsh: 'Zsh (macOS / Linux)', bash: 'Native Bash (macOS / Linux)',
      windowsBash: 'Native Bash (Windows)', bashPath: 'Absolute path to bash.exe',
      bashPathHint: 'You can use the Niubash bundled with dsh-ops. An unavailable path keeps the official shell. Choose PowerShell for confined work.',
      distribution: 'WSL distribution', distributionHint: 'Leave blank for the Windows default distribution, for example Ubuntu.',
      shell: 'Shell version', shellAuto: 'Automatic (official lookup)',
      shellSystem: '{name} (system)', shellPreview: 'PowerShell 7 Preview',
      shellHint: 'Lists common executables found on this machine. A missing file falls back to automatic. WSL still selects a distribution only.',
      sessions: 'After saving, create a new Deep PTC session. Existing sessions and background jobs keep their environment.',
      wslHint: 'WSL does not support the confined Windows sandbox. Confined calls fail without execution or fallback.',
      save: 'Save', saving: 'Saving…', saved: 'Saved. New sessions will use this environment.',
      failed: 'Could not save. Check host compatibility, distribution name, and concurrent configuration changes.',
      readOnly: 'Settings are read-only.', loading: 'Loading settings…',
    },
  };

  function Card({ view, form, t }) {
    const subscribe = React.useCallback(listener => form.subscribe(listener), [form]);
    const read = React.useCallback(() => form.getSnapshot(), [form]);
    const state = React.useSyncExternalStore(subscribe, read, read);
    const [environment, setEnvironment] = React.useState('auto');
    const [distribution, setDistribution] = React.useState('');
    const [shellExecutable, setShellExecutable] = React.useState('');
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState('');
    const [failed, setFailed] = React.useState(false);
    const draftRevision = React.useRef();
    const dirty = React.useRef(false);
    React.useEffect(() => {
      if (!state.value || dirty.current) return;
      setEnvironment(state.value.environment);
      setDistribution(state.value.wslDistribution ?? '');
      setShellExecutable(state.value.shellExecutable ?? '');
      draftRevision.current = state.revision;
    }, [state.value, state.revision]);
    if (view === 'summary') return t('summary');
    if (state.status !== 'ready') return h('p', null, t('loading'));
    const platform = state.value.hostPlatform;
    const allowed = allowedEnvironments(platform);
    const windowsBash = platform === 'win32' && environment === 'bash';
    const disabled = !state.writable || saving;
    const changed = () => {
      if (!dirty.current) draftRevision.current = state.revision;
      dirty.current = true;
      setMessage('');
    };
    async function save(event) {
      event.preventDefault();
      setSaving(true); setMessage(''); setFailed(false);
      try {
        const ok = await form.mutate([
          { op: 'set', path: ['environment'], value: environment },
          { op: 'set', path: ['wslDistribution'], value: distribution.trim() },
          { op: 'set', path: ['shellExecutable'], value: windowsBash ? shellExecutable.trim() : shellExecutable },
        ], draftRevision.current);
        if (!ok) throw new Error('Configuration was rejected');
        dirty.current = false;
        const latest = form.getSnapshot();
        draftRevision.current = latest.revision;
        setEnvironment(latest.value?.environment ?? environment);
        setDistribution(latest.value?.wslDistribution ?? distribution.trim());
        setShellExecutable(latest.value?.shellExecutable ?? shellExecutable);
        setMessage('saved');
      } catch {
        draftRevision.current = form.getSnapshot().revision;
        setFailed(true); setMessage('failed');
      } finally { setSaving(false); }
    }
    const effective = environment === 'auto'
      ? (state.value.hostPlatform === 'win32' ? 'powershell' : state.value.hostPlatform === 'darwin' ? 'zsh' : 'bash')
      : environment;
    const choices = (Array.isArray(state.value.shellChoices) ? state.value.shellChoices : [])
      .filter(item => item && item.family === effective && typeof item.id === 'string');
    const showShell = effective !== 'wsl' && choices.length > 0;
    const control = { width: '100%', padding: '8px 10px', borderRadius: '6px',
      color: 'inherit', background: 'var(--dsw-alias-bg-base)', border: '1px solid var(--dsw-alias-border-l1)' };
    return h('form', { onSubmit: save, style: { display: 'grid', gap: '12px', maxWidth: '600px' } },
      h('label', { htmlFor: 'deep-ptc-environment' }, t('environment')),
      h('select', { id: 'deep-ptc-environment', value: environment, disabled, style: control,
        onChange: event => {
          changed();
          const next = event.target.value;
          if (platform === 'win32' && (environment === 'bash' || next === 'bash')) setShellExecutable('');
          setEnvironment(next);
        } },
      ...['auto', 'wsl', 'powershell', 'zsh', 'bash'].map(value =>
        h('option', { key: value, value, disabled: !allowed.includes(value) }, t(platform === 'win32' && value === 'bash' ? 'windowsBash' : value)))),
      environment === 'wsl' ? h(React.Fragment, null,
        h('label', { htmlFor: 'deep-ptc-distribution' }, t('distribution')),
        h('input', { id: 'deep-ptc-distribution', value: distribution, disabled, style: control,
          onChange: event => { changed(); setDistribution(event.target.value); } }),
        h('p', null, t('distributionHint')), h('p', null, t('wslHint'))) : null,
      windowsBash ? h(React.Fragment, null,
        h('label', { htmlFor: 'deep-ptc-shell' }, t('bashPath')),
        h('input', { id: 'deep-ptc-shell', value: shellExecutable, disabled, style: control, required: true,
          onChange: event => { changed(); setShellExecutable(event.target.value); } }),
        h('p', null, t('bashPathHint'))) : showShell ? h(React.Fragment, null,
        h('label', { htmlFor: 'deep-ptc-shell' }, t('shell')),
        h('select', { id: 'deep-ptc-shell', value: shellExecutable, disabled, style: control,
          onChange: event => { changed(); setShellExecutable(event.target.value); } },
        h('option', { value: '' }, t('shellAuto')),
        ...choices.map(item => h('option', { key: item.id, value: item.id }, shellLabel(item.label, t)))),
        h('p', null, t('shellHint'))) : null,
      h('p', null, t('sessions')),
      !state.writable ? h('p', { role: 'status' }, t('readOnly')) : null,
      message ? h('p', { role: failed ? 'alert' : 'status' }, t(message)) : null,
      h('button', { type: 'submit', disabled: disabled || (windowsBash && !shellExecutable.trim()),
        style: { justifySelf: 'start', padding: '7px 16px' } }, t(saving ? 'saving' : 'save')),
    );
  }

  function ToolStateControls({ sessionId, useProjection, reset, t }) {
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState(null);
    const generation = React.useRef(0);
    React.useEffect(() => { generation.current++; setBusy(false); setMessage(null); return () => { generation.current++; }; }, [sessionId]);
    let preset, state;
    try {
      if (typeof useProjection !== 'function') return null;
      preset = useProjection('agentPreset');
      state = useProjection('deepPtcTools');
    } catch { return null; }
    if (preset !== 'deep-ptc') return null;
    // The failure list needs the tool-state projection; the reset command does not.
    const failed = state && typeof state === 'object' ? state.report?.tools ?? [] : [];
    async function reload() {
      const current = generation.current;
      setBusy(true); setMessage(null);
      try {
        const outcome = await reset();
        if (current !== generation.current) return;
        if (outcome?.ok === false) throw new Error(outcome.error?.message);
        const reply = outcome?.ok === true ? outcome.value : outcome;
        if (reply === undefined) {
          setMessage({ key: 'toolResetFailed', reason: 'toolResetUnavailable' });
          return;
        }
        const result = reply?.result ?? reply;
        if (result?.kind !== 'success') throw new Error(result?.text);
        setMessage({ key: 'toolResetDone' });
      } catch (error) {
        if (current === generation.current) {
          const detail = String(error?.message ?? error ?? '').slice(0, 220);
          setMessage({ key: 'toolResetFailed', detail });
        }
      }
      finally { if (current === generation.current) setBusy(false); }
    }
    return h('section', { className: 'dpt-side-section dpt-side-tools', 'aria-label': t('toolsSection'), 'data-compact': failed.length || message ? undefined : '' },
      h('div', { className: 'dpt-side-label' }, h('span', null, t('toolsSection')),
        h('span', { className: 'dpt-side-tail' },
          h('span', { className: 'dpt-side-hint', 'data-tone': failed.length ? 'warn' : 'ok' }, failed.length ? `${t('toolFailures')} ${failed.length}` : t('toolsOk')),
          h('button', { type: 'button', className: 'dpt-link', onClick: reload, disabled: busy, title: t('toolResetHint'), 'aria-label': t('toolReset'), 'aria-busy': busy },
            busy ? t('toolResetBusy') : t('toolResetShort')))),
      failed.length ? h('div', { className: 'dpt-tool-failures', role: 'status' },
        h('p', null, t('toolFailureHint')),
        h('ul', null, ...failed.map(row => h('li', { key: row.name }, h('code', null, row.name), ` — ${row.provider}`)))) : null,
      message ? h('p', { className: 'dpt-side-note', role: 'status', 'data-tone': message.key === 'toolResetDone' ? 'ok' : 'error' },
        [t(message.key), message.reason ? t(message.reason) : commandText(message.detail, t)].filter(Boolean).join(' ')) : null);
  }
  Object.assign(dictionaries.zh, {
    visualEffects: '界面特效', visualEffectsHint: '使用外部主题或 UI 插件时，建议关闭此开关。',
    sleepSection: '深度睡眠', sleepOn: '打开', sleepOff: '关闭', sleepBusy: '切换中…',
    sleepPhase_off: '已关闭', sleepPhase_asking: '一次性提问中', sleepPhase_ready: '等待确认卡', sleepPhase_confirming: '等待确认', sleepPhase_running: '无人值守运行中', sleepPhase_done: '已结束',
    sleepCards: '已答 {done}/{total} 张卡', sleepObjective: '目标', sleepRound: '第 {round} 轮',
    sleepHintOff: '打开后模型把还缺的问题一次性问完，你确认设定后它才独立运行，直到目标完成。运行中你随时可以再发消息打断。',
    sleepHintOn: '无人值守：停下即由宿主自动开下一轮。你发消息会暂停运行，模型就新信息再问你并重新确认。',
    sleepFailed: '切换失败', questionBatch: '第 {index}/{total} 张',
    sleepSwitch: '深度睡眠模式', sleepSwitchHint: '侧边栏开关与 deep_sleep 工具；关闭后开关不出现，模型也没有这个工具。',
    jobsTitle: '后台任务', jobsEmpty: '本会话暂无后台任务。', jobsMore: '另有 {count} 个在运行', jobsRunningCount: '{count} 运行中', jobsDoneCount: '{count} 已结束', jobsFailedCount: '{count} 失败', jobsShowRecent: '查看最近结束的任务', jobsHideRecent: '收起最近结束的任务',
    jobRunning: '运行中', jobStopping: '正在停止', jobCompleted: '已完成', jobEnded: '已结束', jobKilled: '已取消', jobFailed: '已失败',
    toolReset: '重载所有工具状态', toolResetShort: '重载', toolsOk: '正常', sideNone: '无', sshNone: '未配置', toolResetBusy: '正在重载…', toolResetDone: '本对话工具状态已重载。',
    toolResetFailed: '未能重载工具状态。', toolResetUnavailable: '当前会话无法调用工具重载命令。',
    commandNoSession: '当前没有活动对话。', commandWrongMode: '该功能仅在深度 PTC 会话中可用。', commandInvalidSkill: '无效的 Skill 卡片操作。',
    toolResetHint: '清除本对话的故障标记和按需加载选择；正在运行的任务继续执行。',
    toolFailures: '工具适配提醒', toolFailureHint: '以下外部工具调用失败，可能存在适配问题，已在本对话中禁用。任务会优先使用其他可用工具；未进一步排查故障原因。',
  });
  Object.assign(dictionaries.en, {
    visualEffects: 'Visual effects', visualEffectsHint: 'Keep this off when using an external theme or UI plugin.',
    jobsTitle: 'Background jobs', jobsEmpty: 'No background jobs in this conversation.', jobsMore: '{count} more running', jobsRunningCount: '{count} running', jobsDoneCount: '{count} finished', jobsFailedCount: '{count} failed', jobsShowRecent: 'Show recently finished jobs', jobsHideRecent: 'Hide recently finished jobs',
    jobRunning: 'Running', jobStopping: 'Stopping', jobCompleted: 'Completed', jobEnded: 'Ended', jobKilled: 'Canceled', jobFailed: 'Failed',
    toolReset: 'Reload all tool states', toolResetShort: 'Reload', toolsOk: 'OK', sideNone: 'None', sshNone: 'None configured', toolResetBusy: 'Reloading…', toolResetDone: 'Tool states reloaded for this conversation.',
    toolResetFailed: 'Could not reload tool states.', toolResetUnavailable: 'The reload command is unavailable in this conversation.',
    commandNoSession: 'No active conversation.', commandWrongMode: 'This command is available in Deep PTC sessions only.', commandInvalidSkill: 'Invalid skill card command.',
    toolResetHint: 'Clear quarantine and on-demand selections in this conversation. Running jobs continue.',
    toolFailures: 'Tool compatibility notice', toolFailureHint: 'These external tools failed and may have compatibility issues. They are disabled in this conversation. Continue with working alternatives; no root-cause investigation was performed.',
  });
  Object.assign(dictionaries.zh, {
    skillTitle: '当前上下文中的 Skill', skillLoaded: '{count} 个已加载', skillClosing: '{count} 个将在下一条消息后移除',
    skillHint: '关闭的 Skill 会在你发送下一条消息时移出上下文，历史记录不受影响。',
    skillKeepAll: '全部保留', skillCloseAll: '全部关闭', skillNoDescription: '无描述', skillThisTurn: '本轮',
    // Summaries of Deep PTC's own skills for the skill card, in the display language.
    'skillDesc:deep-ptc-cards': '用对话卡片展示结果、图表和进度，或请你做决定；说明各种块、排版和按钮。',
    'skillDesc:deep-ptc-card-examples': '开发场景的卡片样板：任务、测试、CI、评审、部署、提醒和多卡片排版。',
    'skillDesc:deep-ptc-project-cards': '维护 PROJECT-CARDS.md：提案与审批、润色、需求与功能记录。',
    'skillDesc:deep-ptc-dsh-operations': 'DSH 与深度 PTC 操作导航：选工具、Skill、卡片和任务状态，哪些卡片要等你回答，审批与失效工具。',
    'skillDesc:deep-ptc-local-web-testing': '在真实浏览器里验证本地网页交互：定位控件、触发操作、核对可见结果和请求次数。',
    'skillDesc:deep-ptc-frontend-design': '实现前端页面和可靠的交互状态：排版、响应式、表单和过期请求，附可运行示例。',
    'skillDesc:deep-ptc-ui-visual-design': '界面视觉设计：沿用已有设计系统，定颜色、字体、间距与明暗变量，理清层级，避免布局跳动和模板味，附可运行的变量与组件示例。',
    'skillDesc:deep-ptc-primary-source-research': '用原始资料核验主张、数据、版本和出处，附网页段落定位器。',
    'skillDesc:deep-ptc-office-delivery': '交付可编辑的办公文件并跨文件对账，附 CSV 转 Excel 和 Word 月报生成器。',
    'skillDesc:deep-ptc-scientific-figures': '把实验数据做成科学图、统计表和结果卡片，处理单位、误差和缺失值。',
    'skillDesc:deep-ptc-windows-wsl': 'Windows 与 WSL 双环境：路径映射与中文路径、互操作、PowerShell 5.1 的坑、编码与换行、两侧 localhost、文件占用。',
    'skillDesc:deep-ptc-dsh-plugin-dev': 'DSH 插件开发：提示词段与快照的缓存代价、SDK schema 子集、会话投影、插槽渲染时机、历史替换、测试开发版本。',
    'skillDesc:deep-ptc-virtual-dsh-testing': '在虚拟 DSH 里测试插件、预设、Skill 或配置的改动：带测试包启动、确认加载、在浏览器或请你实际操作验证、迭代、汇报并清理。',
    'skillDesc:deep-ptc-tool-evaluation': '评测模型能否选对工具、填对参数并完成任务：固定用例、可机器核对的结果、新旧版本对照。',
    skillShowAll: '显示全部 {count} 个', skillShowLess: '收起',
    cardLabel: '对话卡片', cardStopDefault: '停止', cardDismiss: '关闭',
    virtualTitle: '虚拟 DSH 环境', virtualStart: '启动虚拟 DSH', virtualOpen: '在侧栏打开', virtualStop: '停止',
    virtualHint: '一个全新的 DSH：宿主版本、插件、Skill 和设置与当前一致，不含会话、工作区和记忆。在右侧栏里操作，停止后自动清理。',
    virtualState_stopped: '未运行', virtualState_preparing: '正在复制环境…', virtualState_installing: '正在安装插件…', 'virtualState_adding package': '正在安装测试包…',
    virtualState_starting: '正在启动…', virtualState_running: '运行中', virtualState_stopping: '正在停止…', virtualState_failed: '启动失败', virtualState_unknown: '读取状态…',
    virtualTesting: '含测试包：{name}', virtualAdded: '额外插件：{names}', virtualState_restarting: '正在重启…',
    virtualStep_preparing: '复制环境', virtualStep_installing: '安装插件', 'virtualStep_adding package': '安装测试包', virtualStep_starting: '启动', virtualStep_running: '运行中',
    creativeSwitch: '深度创造模式', creativeHint: '新建深度 PTC 会话时生效，可在独立 DSH 中测试插件。',
    cardLiveLabel: '等待你操作的卡片', cardLiveNote: '模型在等你回答，同时继续做不依赖答案的部分；回答会立刻送到它手上。',
    cardStopping: '正在处理…', cardStopped: '已执行', cardFailed: '执行失败', cardDismissed: '已关闭',
    delegatedAssignment: '主代理下发的任务', delegatedDirect: '你在和子代理直接对话。你的话立即生效，并会整理后同步给主代理。',
    noticeSound: '卡片提示音', noticeSoundHint: '有卡片等你回答、选择或确认时响一声。',
    noticeDone: '任务结束提示音', noticeDoneHint: '深度 PTC 的一轮任务结束时响一声；你自己停止的不响。',
    soundSection: '提示音',
    soundVolume: '音量', soundVolumeHint: '拖动时立即以新音量试听当前卡片提示音，松手后保存。',
    soundCardSource: '卡片提示音', soundDoneSource: '任务结束提示音', soundDefault: '默认（内置）', soundPreview: '试听',
    soundLibrary: '已保存的提示音', soundEmpty: '还没有自定义提示音。', soundUnavailable: '当前宿主不支持音频存储与试听。',
    soundUpload: '上传音频', soundUploadHint: '支持 mp3 / wav / m4a，单个文件不超过 {max} MB。',
    soundUploading: '上传中：{name} · {progress}%',
    soundTrim: '选择片段', soundTrimHint: '拖动两个滑块选择起止，最长 {max} 秒。',
    soundStart: '起点', soundEnd: '终点', soundLength: '本段 {length} 秒', soundName: '名称',
    soundPlaySelection: '试听本段', soundSave: '保存为候选提示音', soundCancel: '取消',
    soundDelete: '删除', soundConfirmDelete: '确认删除', soundSaved: '已保存。',
    soundFormat: '不支持的音频格式（mp3 / wav / m4a）。', soundTooBig: '文件超过大小上限。', soundFailed: '操作失败，请重试。',
    noticePopup: '屏幕右下角弹窗', noticePopupHint: '卡片同时出现在屏幕右下角，可以直接在里面回答，也可以回到 DSH 处理。',
    noticePopup_always: '总是', noticePopup_away: 'DSH 在后台时', noticePopup_off: '不弹出',
    mobileSwitch: '在 DSH Go 里显示卡片', mobileSwitchHint: '等你处理的卡片同时作为 DSH Go 的原生提问出现，展示卡片作为原生工具卡出现。在哪边回答都可以。',
    briefTitle: '本次任务', briefGoal: '目标', briefConstraint: '约束', briefAcceptance: '验收', briefContext: '背景', briefQuestion: '待确认',
    briefBasisUser: '原话', briefBasisInferred: '推断', briefBasisConfirmed: '已确认', briefDone: '已完成',
    briefConfirmOne: '确认', briefEdit: '改', briefRemove: '删', briefMarkDone: '完成', briefReopen: '重开', briefSave: '保存',
   
    briefAdd: '+ 添加一条', briefAddPlaceholder: '一条目标、约束或验收标准', briefSection: '分区', briefFrom: '出自消息 {ref}',
    briefMessage: '第 {turn} 轮的消息', briefCovered: '已整理 {covered}/{total} 段', briefUnfiled: '未归档原文',
    briefCondensed: '已移出上下文', briefCondensedHint: '模型上下文里这条消息已换成任务卡替身；原话仍在聊天和会话记录中，模型需要时可以读回。',
    briefCondensing: '下一步移出上下文', briefRestoring: '下一步恢复原文', briefRestore: '恢复原文',
    briefCount: '{count} 条', briefInferredCount: '{count} 条推断待确认', briefUnfiledCount: '{count} 段未归档', briefCondensedCount: '{count} 条消息已精简',
    briefRethink: '理解有偏差', briefFeedback: '哪里需要重新理解？可直接补充，也可请模型列出选项。', briefAskOptions: '请模型澄清', briefReturned: '已退回澄清', briefContentQuestion: '将「{text}」列入本次任务吗？', projectContentQuestion: '项目的「{title}」要怎样设置？', versionPreview: '查看「{label}」的内容', reviewSet: '可以，按此设置', reviewSkip: '不设置这张卡片', reviewOther: '其他：填写我的想法', questionOtherHint: '写下你的答案，模型会当成你的决定', cardOtherHint: '写下你的答案', reviewRewriteHint: '写下你的想法，模型会重新整理并再次询问。', briefSetQuestion: '是否设置下面这项任务？', projectSetQuestion: '是否设置下面这张特点卡片？', briefClarify: '本次任务 · 澄清需求', projectClarify: '特点卡片 · 澄清设定', reviewOwnAnswer: '我有其他理解', reviewUseOptions: '返回选项', projectMsgRethink: '请按以下意见重新整理「{title}」，再单独询问我是否设置。{feedback}', amendProposal: '修改提案', projectApproveEdits: '批准修改后的提案', briefManage: '管理当前任务', briefPending: '待确认', briefArchived: '已归档', briefConfirmAll: '全部确认', briefCondense: '确认并精简上下文',
    briefCondenseNote: '已确认。模型下一次请求前，这些原话会换成任务卡替身，聊天里的原话不变。',
    briefCondenseHint: '核对无误后可精简上下文：原话移出模型上下文但不删除，未归档的原文会逐字保留。',
    briefFootHint: '模型按这张卡工作，并在结束前逐条核对验收。',
    briefMore: '更多操作', briefInProgress: '进行中', briefPendingCount: '待确认 {count} 条', briefAcceptanceProgress: '验收 {done}/{total}',
    briefSourcesSummary: '原话来源 · {count} 条消息', briefReadyToArchive: '验收已全部完成，核对无误就可以归档了。', briefDrop: '放弃任务', briefDropConfirm: '确认放弃',
    briefComplete: '完成并归档', briefDecidedConfirmed: '已确认', briefDecidedDeclined: '不设置', briefDecidedReturned: '已退回', briefRedraftingChip: '重拟中',
    briefYourNote: '你的意见：{text}', briefRedraftedFrom: '按你的意见重拟：{text}', briefSetThis: '按此设置', briefSkipThis: '不设置',
    briefRemaining: '确定后还剩 {count} 条', briefLastItem: '这是最后一条', briefConfirmRest: '其余全部按此设置',
    briefRoundTitle: '核对我整理的 {count} 条', briefRoundSub: '从你的消息里整理，逐条确认；确定后下一条会出现在这里。', briefRoundSummary: '已确认 {confirmed} · 不设置 {declined}',
    briefReviewProgress: '待确认 {at}/{total}', briefExpand: '展开', briefCollapse: '收起', briefRedrafting: '模型正在按你的意见重写 {id}，写好后会出现在这里再问你一次。',
    briefStateDone: '已完成', briefStateDropped: '已放弃', briefReceiptStub: '本次任务 · {title} · {state}', briefRecordedAs: '已记入特点卡片 · 已完成任务 {id} · {date}',
    briefRecordedDropped: '已记入特点卡片 · {id}（放弃）· {date}', briefArchivedHere: '已归档 · {date}', briefArchivedItems: '归档时的 {count} 条条目',
    briefClearedNote: '任务卡已清空，下一个任务从这里开始。', briefOpenProject: '在特点卡片中查看', briefSnapshotStub: '本次任务 v{rev} · {count} 条 · 已折叠',
    briefThisConversation: '这个对话', briefNoTask: '这个对话暂无进行中的任务。',
    projectPastTasks: '过往任务', projectWholeWorkspace: '整个工作区', projectNoPastTasks: '这个工作区还没有归档过任务。任务完成或放弃后会记在这里。',
    projectKindTasks: '记录 · 自动归档', projectCompletedTasks: '已完成任务', projectTaskCount: '{count} 个任务', projectSettledStub: '特点卡片 · {title} · {outcome}',
    briefSources: '来源消息',
    briefSwitch: '任务卡', briefSwitchHint: '模型把你消息里的目标、约束和验收标准整理成「本次任务」卡，附上原话出处并标出推断的部分。核对后可把原话移出模型上下文，原话不会删除。',
    cardLast: '上次：{action}', cardNeeds: '先填写：{names}', cardReplyFailed: '未能把选择发送给模型，请直接在对话里告诉它。',
    cardsSection: "卡片",
    cardsSwitch: "对话卡片",
    cardsSwitchHint: "模型可以在对话末尾放置指标、图表、选项和按钮卡片。关闭后模型不再看到卡片工具，已有卡片隐藏。",
    projectSwitch: "特点卡片",
    projectSwitchHint: "工作区里的 PROJECT-CARDS.md 会进入该工作区所有对话的上下文，并在深度 PTC 会话中出现「特点卡片」页。关闭后不再注入，也不显示该页。",
    projectTab: "特点卡片",
    projectIntro: "项目的长期设定与记录，保存在工作区的 PROJECT-CARDS.md。每次请求只带最新版本，旧版本自动失效；该工作区的其他对话也会读到。",
    projectNoFile: "尚未创建 PROJECT-CARDS.md",
    projectRefresh: "刷新",
    projectNewCard: "新建设定卡片",
    projectWarnings: "有 {count} 行未解析为卡片，原文会保留。",
    projectDraftConflict: "文件已更新，草稿已保留。请先查看新版本，再合并草稿。",
    projectLatestVersion: "当前已保存版本", projectDraftRebase: "合并到最新版本", projectDraftMakeNew: "保留为新卡片草稿",
    projectProposals: "待你批准的修改",
    projectProposalChange: "修改「{title}」",
    projectProposalNew: "新建「{title}」",
    projectApprove: "批准",
    projectReject: "拒绝",
    projectProposalApproved: "已批准",
    projectProposalRejected: "已驳回",
    projectEmptyTitle: "还没有特点卡片",
    projectEmptyHint: "可以让模型先问你几个问题（技术栈、规范、约束、协作方式），再整理成卡片交给你批准；也可以自己新建。",
    projectBootstrap: "让模型引导建立",
    projectEndGuide: "结束本次建卡", projectDefer: "暂缓建卡", projectSetup_deferred: "项目已暂缓建卡，可随时重新开始", projectSetup_pending: "项目已有待审批草稿", projectSetup_guiding: "项目已开始引导", projectChatSource: "对话", projectProposalStale: "原卡已更新，请合并后重新审阅；若原卡或条目已删除，请重新提案。", projectReviewMerge: "合并并查看差异",
    projectGuide: "建卡助手", projectYou: "你", projectAnswer: "回复建卡助手", projectGuideWorking: "助手正在处理…", projectGuideStart: "请在这个面板用中文引导我建立项目设定。",
    projectKindSetting: "项目设定",
    projectKindFeatures: "已实现功能 · 模型维护",
    projectKindRequirements: "用户要求 · 模型维护",
    projectStatusActive: "生效",
    projectStatusDone: "已满足",
    projectStatusSuperseded: "被 {by} 替代",
    projectNoItems: "暂无条目。",
    projectQuestion: "质疑",
    projectQuestionPlaceholder: "哪里不对？",
    projectSend: "发送",
    projectCancel: "取消",
    projectTitlePlaceholder: "卡片标题，例如：代码规范",
    projectNew: "新",
    projectItemPlaceholder: "一条规则或要求",
    projectRemoveItem: "删除这条",
    projectAddItem: "+ 添加一条",
    projectPolish: "提交前让模型润色",
    projectDelete: "删除卡片",
    projectSendPolish: "发给模型润色",
    projectSubmit: "提交",
    projectHistory: "历史",
    projectEdit: "编辑",
    projectNoHistory: "没有历史版本。",
    projectClose: "收起",
    projectRollback: "回滚到 v{rev}",
    projectUnavailable: "当前 DSH 版本没有为这个页面提供会话数据。",
    projectMsgSubmit: "我更新了特点卡片「{title}」（{change}）。请按最新版本继续，旧版本已失效。",
    projectMsgCreate: "我新建了特点卡片「{title}」（{change}）。请从现在起遵守。",
    projectMsgDelete: "我删除了特点卡片「{title}」，其中的设定不再适用。",
    projectMsgRollback: "我把特点卡片「{title}」回滚到了 v{rev}（现为 {change}）。请按这个版本继续。",
    projectMsgApprove: "我批准了提案 {id}，特点卡片「{title}」已更新（{change}）。",
    projectMsgReject: "我拒绝了提案 {id}（特点卡片「{title}」），这份提案不采用；卡片以特点卡片页里的当前版本为准。",
    projectMsgQuestion: "我对特点卡片「{title}」中的 {id}「{text}」有疑问：{question}。请核实，必要时用 project_cards 修改。",
    projectMsgPolish: "请润色我对特点卡片「{title}」（{id}）的修改：保持原意，把每条写成准确、可执行的规范，不要增加我没提的要求；然后用 project_cards propose 提交给我批准：card 填 \"{id}\"（修改这张已有卡片，不要新建）。只提交改动：改写的条目带原 id（如 R1），新条目不写 id，要删除的 id 放进 remove；没提到的条目保持不变。草稿： 分类为 {category}。调用提案工具时原样传入 baseVersion={version}。\n{items}{removed}",
    projectMsgPolishNew: "请润色我要新建的特点卡片「{title}」：保持原意，把每条写成准确、可执行的规范，不要增加我没提的要求；然后用 project_cards propose 提交给我批准。草稿： 分类为 {category}。调用提案工具时原样传入 baseVersion={version}。\n{items}",
    projectMsgBootstrap: "请帮我为这个项目建立特点卡片：先用交互卡片问我几个关键问题（技术栈、代码规范、约束、协作方式），也可以参考 AGENTS.md 和 README；整理好后用 project_cards propose 提交给我批准。",
    projectCategory: "分类",
    projectRecords: "模型维护的记录",
    projectRemoved: "\n删除：{ids}",
    projectCat_stack: "技术与环境",
    projectCat_conventions: "代码规范",
    projectCat_constraints: "约束与禁止",
    projectCat_workflow: "协作流程",
    projectCat_product: "产品与需求",
    projectCat_other: "其他",
    panelMove: "移动「{name}」",
    panelMoveHint: "拖动调整顺序，或聚焦后按 ↑ ↓",
    cardArchived: "已存档",
    cardSuperseded: "已更新",
    cardClosedStub: "已关闭 · {title}",
    cardChose: "已选：{action}",
    questionKicker: "需要你决定",
    questionWaiting: "等你回答",
    questionAnswered: "已回答并发给模型", questionRecorded: "已记录",
    questionUnanswered: "未回答",
    questionOptional: "可选",
    questionSubmit: "提交回答",
    questionRemaining: "还有 {count} 题未答",
    questionReady: "提交后模型会立刻收到，正在工作也一样。",
    questionSkipped: "（未回答）",
    questionReplyHead: "【回答 · {title}】",
    projectPolishNow: "润色",
    polishBy: "由谁润色",
    polishBySubagent: "子代理",
    polishByChat: "当前对话",
    polishBySubagentHint: "单独润色，不打断当前对话",
    polishByChatHint: "交给当前对话的模型，它了解刚才聊的内容",
    polishWorkingSubagent: "子代理正在润色…",
    polishWorkingChat: "已交给当前对话润色，模型下一步就会处理…",
    polishFailed: "润色没有完成。",
    polishReview: "润色建议",
    polishChanges: "{count} 处改动",
    polishNoChange: "没有需要改的地方",
    polishTake: "采用",
    polishTakeDelete: "删除",
    polishKeep: "保留原文",
    polishTakeAll: "全部采用",
    polishApply: "应用到草稿",
    polishDiscard: "放弃建议",
    projectPanelNone: "这个工作区还没有特点卡片。",
    projectPanelCount: "{count} 张设定卡片 · {records} 张模型记录",
    projectPanelPending: "{count} 个待批准",
    projectPanelEdit: "编辑特点卡片",
    projectPanelEditHint: "打开特点卡片页，不打扰模型",
    projectPanelGuideFirst: "让模型引导设置",
    projectPanelGuideMore: "让模型帮我完善",
    projectPanelGuideHint: "在主对话里由模型提问，引导你建立或完善特点卡片；模型正在工作时也会立刻收到",
    projectPanelGuideSent: "已发到主对话，模型会在那里引导你。",
    projectPanelNoTab: "找不到特点卡片页，请先打开这个对话。",
    projectMsgGuideFirst: "请在这个对话里引导我为项目建立特点卡片：先用 project_cards read 和工作区里的 AGENTS.md / README 了解现状，再按当前提问设置一次问我几个关键问题（技术栈、代码规范、约束、协作方式）。根据回答用 project_cards propose 提交卡片，我在特点卡片页批准。",
    projectMsgGuideMore: "请在这个对话里引导我完善现有的特点卡片：先用 project_cards read 看看哪些地方缺失、含糊或过时，再按当前提问设置问我需要补充的内容。根据回答用 project_cards propose 提交修改，我在特点卡片页批准。",
    panelLocation: "面板位置",
    locationBeside: "对话区侧边",
    locationSidebar: "侧边栏",
    locationHint: "「侧边栏」把整个深度 PTC 面板放进右侧栏的页签，点胶囊即打开；「对话区侧边」保持面板贴在对话旁边。",
    locationBetter: "已检测到 dsh-better-sidebar：面板作为它的页面打开，也可以放进它的底部工作台。",
    cardTotal: '合计', cardStep_done: '已完成', cardStep_active: '进行中', cardStep_todo: '待办', cardStep_failed: '失败',
    agentsTitle: '子代理', agentsCount: '共 {count} 个',
    agentRunning: '运行中', agentCompleted: '已完成', agentIdle: '空闲', agentExternal: '外部',
    agentOpen: '在右侧栏打开这个子代理的对话',
    sideTitle: '深度 PTC', toolsSection: '工具状态', envAuto: '自动', envForNew: '新会话生效', envThisSession: '本会话保持创建时的环境。',
    envAutoNow: '当前按自动选择：{env}。本会话保持创建时的环境。', envSaved: '已保存，之后新建的会话使用 {env}。',
    envFailed: '未能保存，请检查发行版名称或设置是否已在别处修改。', envDefaultDistribution: '默认发行版',
    durationSeconds: '{s} 秒', durationMinutes: '{m} 分 {s} 秒', durationHours: '{h} 小时 {m} 分',
    sideGuide: '执行环境、子代理、后台任务、输出文件与 SSH', sideOtherMode: '当前对话不是深度 PTC 模式。这里的执行环境用于之后新建的深度 PTC 会话。',
    capsuleOpen: '展开或收起侧边面板', panelClose: '收起侧边面板',
    panelMoved: '深度 PTC 面板已回到对话区侧边，请使用输入框下方的胶囊展开。',
    panelMovedToolbar: '深度 PTC 面板在对话区侧边，请使用输入框工具栏里的胶囊展开。',
    panelMovedHidden: '胶囊已隐藏。可以用下面的按钮打开深度 PTC 面板，或在「设置 → 深度 PTC → 外观」里重新显示胶囊。',
    panelOpen: '打开深度 PTC 面板', panelResize: '拖动调整侧边面板宽度，双击恢复默认',
    capsulePlacement: '胶囊位置', placementAuto: '自动', placementDock: '输入框下方', placementToolbar: '工具栏', placementHidden: '隐藏',
    placementHint: '「自动」在检测到 dsh-claude-style 等紧凑输入框时放进工具栏，否则放在输入框下方。隐藏后可从右侧栏「深度 PTC」页签打开面板。',
    placementAutoNow: '「自动」当前放在：{place}。',
    outputsTitle: '输出文件', outputsEmpty: '本会话暂无输出文件。', outputsMore: '另有 {count} 个文件',
    outputPresented: '已交付', outputTurn: '第 {turn} 轮',
    outputOpenFailed: '无法打开文件，请检查文件是否仍存在，以及宿主文件预览是否可用。',
    sshTitle: 'SSH 连接', sshHint: '非交互连接', sshNoClient: '未找到 OpenSSH 客户端', sshConfigured: '已配置',
    sshUsed: '第 {turn} 轮 · {count} 次', sshFailed: '第 {turn} 轮失败', sshEmpty: '~/.ssh/config 中没有主机别名，本会话也未连接过远程主机。',
    sshCopy: '复制 SSH 检查命令', sshGoCopy: '复制 DSH Go 连接资料', sshCopied: '已复制', sshCopyFailed: '复制失败，请检查剪贴板权限。',
    sshGoDetails: 'DSH Go SSH 连接\n主机：{host}\n端口：{port}\n用户：{user}\nSSH 别名（本机）：{alias}\n\n在 DSH Go 中选择 SSH 并配置认证。远端为 Linux/macOS 时可选托管启动 dsh web；远端为 Windows 时选择仅连接已有服务，端口取自实际启动结果。服务监听 127.0.0.1，授权信息在客户端填写。手机需要能访问这里的主机地址。',
    sshUserNeeded: '在客户端填写远程用户名',
    appearance: '外观', visualEffectsAuto: '检测到外观插件 {name}，特效默认关闭。手动打开后会保留你的选择。',
    diagTitle: '诊断信息', diagHint: '复制后可附在 issue 中，便于排查界面问题。', diagCopy: '复制诊断信息', diagCopied: '已复制',
    shellStore: 'PowerShell 7（应用商店）', presetSafeReason: '当前为安全模式：{reason}',
  });
  Object.assign(dictionaries.en, {
    skillTitle: 'Skills in context', skillLoaded: '{count} loaded', skillClosing: '{count} leave after your next message',
    skillHint: 'A closed skill leaves the model context when you send your next message. The history stays complete.',
    skillKeepAll: 'Keep all', skillCloseAll: 'Close all', skillNoDescription: 'No description', skillThisTurn: 'this turn',
    // Summaries of Deep PTC's own skills for the skill card, in the display language.
    'skillDesc:deep-ptc-cards': 'Show results, charts and progress with conversation cards, or ask you to decide; blocks, layout and buttons.',
    'skillDesc:deep-ptc-card-examples': 'Card templates for development: jobs, tests, CI, review, deployment, reminders and multi-card layouts.',
    'skillDesc:deep-ptc-project-cards': 'Maintain PROJECT-CARDS.md: proposals and approval, polishing, requirement and feature records.',
    'skillDesc:deep-ptc-dsh-operations': 'Navigate DSH and Deep PTC: tools, skills, cards and task state; which cards wait for you; approvals and quarantined tools.',
    'skillDesc:deep-ptc-local-web-testing': 'Verify a local web interaction in a real browser: find controls, act, check what you see and how many requests ran.',
    'skillDesc:deep-ptc-frontend-design': 'Build frontend pages with reliable interaction states: layout, responsive design, forms and stale requests, with a runnable example.',
    'skillDesc:deep-ptc-ui-visual-design': 'Interface visual design: reuse the existing system, define colour, type, spacing and light/dark variables, set hierarchy, keep layouts steady and avoid template looks, with a runnable example.',
    'skillDesc:deep-ptc-primary-source-research': 'Check claims, numbers, versions and citations against primary sources, with a web passage locator.',
    'skillDesc:deep-ptc-office-delivery': 'Deliver editable Office files with cross-file reconciliation, with a CSV to Excel and Word report generator.',
    'skillDesc:deep-ptc-scientific-figures': 'Turn experimental data into scientific figures, statistics tables and result cards, with units, error bars and missing values.',
    'skillDesc:deep-ptc-windows-wsl': 'Windows and WSL: path mapping and non-ASCII paths, interop, PowerShell 5.1 pitfalls, encodings and line endings, localhost, file locks.',
    'skillDesc:deep-ptc-dsh-plugin-dev': 'DSH plugin development: prompt section vs snapshot cache cost, SDK schema subset, projections, slot timing, history replacement, testing a build.',
    'skillDesc:deep-ptc-virtual-dsh-testing': 'Test plugin, preset, skill or configuration changes in a virtual DSH: start with a package, check it loaded, verify in the browser or with you, iterate, report and clean up.',
    'skillDesc:deep-ptc-tool-evaluation': 'Evaluate whether a model picks the right tool, fills its arguments and finishes the task: fixed cases, checkable results, version comparison.',
    skillShowAll: 'Show all {count}', skillShowLess: 'Show less',
    cardLabel: 'Conversation cards', cardStopDefault: 'Stop', cardDismiss: 'Dismiss',
    virtualTitle: 'Virtual DSH', virtualStart: 'Start virtual DSH', virtualOpen: 'Open in sidebar', virtualStop: 'Stop',
    virtualHint: 'A fresh DSH with the same host version, plugins, skills and settings as this one, without sessions, workspaces or memory. Use it in the right sidebar; it is cleaned up when stopped.',
    virtualState_stopped: 'Not running', virtualState_preparing: 'Copying the environment…', virtualState_installing: 'Installing plugins…', 'virtualState_adding package': 'Installing the test package…',
    virtualState_starting: 'Starting…', virtualState_running: 'Running', virtualState_stopping: 'Stopping…', virtualState_failed: 'Failed to start', virtualState_unknown: 'Reading status…',
    virtualTesting: 'With test package: {name}', virtualAdded: 'Extra plugins: {names}', virtualState_restarting: 'Restarting…',
    virtualStep_preparing: 'Copy environment', virtualStep_installing: 'Install plugins', 'virtualStep_adding package': 'Install test package', virtualStep_starting: 'Start', virtualStep_running: 'Running',
    creativeSwitch: 'Deep creative mode', creativeHint: 'Applies to new Deep PTC chats. Test plugins in a separate DSH instance.',
    cardLiveLabel: 'Cards waiting for you', cardLiveNote: 'The model is waiting for your answer and keeps working on what does not depend on it; your answer reaches it at once.',
    cardStopping: 'Working…', cardStopped: 'Done', cardFailed: 'Failed', cardDismissed: 'Dismissed',
    delegatedAssignment: 'Assignment from the parent agent', delegatedDirect: 'You are talking to the subagent directly. Your words take effect at once and are passed on to the parent agent.',
    noticeSound: 'Card sound', noticeSoundHint: 'Rings once when a card waits for your answer, choice or confirmation.',
    noticeDone: 'Task end sound', noticeDoneHint: 'Rings once when a Deep PTC turn ends, not when you stop it yourself.',
    sleepSection: 'Deep sleep', sleepOn: 'Turn on', sleepOff: 'Turn off', sleepBusy: 'Switching…',
    sleepPhase_off: 'Off', sleepPhase_asking: 'Gathering questions', sleepPhase_ready: 'Ready to confirm', sleepPhase_confirming: 'Waiting for confirmation', sleepPhase_running: 'Running unattended', sleepPhase_done: 'Finished',
    sleepCards: '{done}/{total} cards answered', sleepObjective: 'Objective', sleepRound: 'Round {round}',
    sleepHintOff: 'Turn it on and the model asks every open question at once; after you confirm the settings it works on its own until the objective is complete. Write at any time to interrupt.',
    sleepHintOn: 'Unattended: finishing a turn starts the next goal round by itself. A message from you pauses the run so the model can ask about the new information and confirm again.',
    sleepFailed: 'Could not switch', questionBatch: 'Card {index}/{total}',
    sleepSwitch: 'Deep sleep mode', sleepSwitchHint: 'The side-panel switch and the deep_sleep tool; when off, neither exists.',
    soundSection: 'Sounds',
    soundVolume: 'Volume', soundVolumeHint: 'Moving it plays the current card sound at the new volume; the value is saved when you stop.',
    soundCardSource: 'Card sound', soundDoneSource: 'Task end sound', soundDefault: 'Default (built in)', soundPreview: 'Preview',
    soundLibrary: 'Saved sounds', soundEmpty: 'No custom sound yet.', soundUnavailable: 'This host cannot store or preview sounds.',
    soundUpload: 'Upload audio', soundUploadHint: 'mp3 / wav / m4a, one file up to {max} MB.',
    soundUploading: 'Uploading: {name} · {progress}%',
    soundTrim: 'Choose a clip', soundTrimHint: 'Drag the two handles to set start and end; at most {max} seconds.',
    soundStart: 'Start', soundEnd: 'End', soundLength: 'This clip is {length} seconds', soundName: 'Name',
    soundPlaySelection: 'Preview clip', soundSave: 'Save as a sound', soundCancel: 'Cancel',
    soundDelete: 'Delete', soundConfirmDelete: 'Confirm delete', soundSaved: 'Saved.',
    soundFormat: 'Unsupported audio format (mp3 / wav / m4a).', soundTooBig: 'The file is over the size limit.', soundFailed: 'That did not work. Try again.',
    noticePopup: 'Notice at the bottom right', noticePopupHint: 'The card also appears at the bottom right of the screen: answer it there, or go back to DSH.',
    noticePopup_always: 'Always', noticePopup_away: 'DSH in background', noticePopup_off: 'Never',
    mobileSwitch: 'Show cards in DSH Go', mobileSwitchHint: 'Cards that wait for you also appear as DSH Go native questions, and display cards as native tool cards. Answer on either side.',
    briefTitle: 'Task brief', briefGoal: 'Goals', briefConstraint: 'Constraints', briefAcceptance: 'Acceptance', briefContext: 'Context', briefQuestion: 'Open questions',
    briefBasisUser: 'Your words', briefBasisInferred: 'Inferred', briefBasisConfirmed: 'Confirmed', briefDone: 'Done',
    briefConfirmOne: 'Confirm', briefEdit: 'Edit', briefRemove: 'Remove', briefMarkDone: 'Done', briefReopen: 'Reopen', briefSave: 'Save',
    briefAdd: '+ Add an item', briefAddPlaceholder: 'A goal, constraint or acceptance criterion', briefSection: 'Section', briefFrom: 'From message {ref}',
    briefMessage: 'Message in turn {turn}', briefCovered: '{covered}/{total} clauses filed', briefUnfiled: 'Unfiled text',
    briefCondensed: 'Out of context', briefCondensedHint: "In the model's context this message is replaced by a stub pointing to the brief; the original stays in the chat and the log, and the model can read it back.",
    briefCondensing: 'Leaves context next step', briefRestoring: 'Restored next step', briefRestore: 'Restore original',
    briefCount: '{count} items', briefInferredCount: '{count} inferred to check', briefUnfiledCount: '{count} unfiled', briefCondensedCount: '{count} messages condensed',
    briefRethink: 'Revisit interpretation', briefFeedback: 'Add a correction or ask for alternative interpretations.', briefAskOptions: 'Request clarification', briefReturned: 'Returned for clarification', briefContentQuestion: 'Include “{text}” in this task?', projectContentQuestion: 'How should “{title}” be set for this project?', versionPreview: 'Preview {label}', reviewSet: 'Yes, use this', reviewSkip: 'Do not set this card', reviewOther: 'Other: write my suggestion', questionOtherHint: 'Write your answer; the model treats it as your decision', cardOtherHint: 'Write your answer', reviewRewriteHint: 'Describe the change. The model will redraft and ask again.', briefSetQuestion: 'Set this task item?', projectSetQuestion: 'Set this project card?', briefClarify: 'Task brief · Clarification', projectClarify: 'Project card · Clarification', reviewOwnAnswer: 'Describe another interpretation', reviewUseOptions: 'Back to options', projectMsgRethink: 'Revise {title} using my feedback and ask me to approve the new draft. {feedback}', amendProposal: 'Edit proposal', projectApproveEdits: 'Approve edited proposal', briefManage: 'Manage current brief', briefPending: 'Awaiting review', briefArchived: 'Archived', briefConfirmAll: 'Confirm all', briefCondense: 'Confirm and condense',
    briefCondenseNote: "Confirmed. Before the model's next request these messages are replaced by stubs; the chat keeps your words.",
    briefCondenseHint: "Once it is right, condense: your messages leave the model's context without being deleted, and unfiled text is kept verbatim.",
    briefFootHint: 'The model works from this card and checks each acceptance item before it finishes.',
    briefMore: 'More actions', briefInProgress: 'In progress', briefPendingCount: '{count} to review', briefAcceptanceProgress: 'Acceptance {done}/{total}',
    briefSourcesSummary: 'Sources · {count} messages', briefReadyToArchive: 'Every acceptance item is done. Archive the task once you have checked it.', briefDrop: 'Give up task', briefDropConfirm: 'Confirm give up',
    briefComplete: 'Complete and archive', briefDecidedConfirmed: 'Confirmed', briefDecidedDeclined: 'Left out', briefDecidedReturned: 'Returned', briefRedraftingChip: 'Redrafting',
    briefYourNote: 'Your note: {text}', briefRedraftedFrom: 'Redrafted from your note: {text}', briefSetThis: 'Set as written', briefSkipThis: 'Leave it out',
    briefRemaining: '{count} more after this', briefLastItem: 'This is the last item', briefConfirmRest: 'Set all the rest as written',
    briefRoundTitle: 'Check the {count} items I filed', briefRoundSub: 'Filed from your message. Decide each one; the next appears here.', briefRoundSummary: '{confirmed} confirmed · {declined} left out',
    briefReviewProgress: 'Reviewing {at}/{total}', briefExpand: 'Expand', briefCollapse: 'Collapse', briefRedrafting: 'The model is rewriting {id} from your note; it will be asked here again.',
    briefStateDone: 'Done', briefStateDropped: 'Given up', briefReceiptStub: 'Task · {title} · {state}', briefRecordedAs: 'Recorded in Project cards · Completed tasks {id} · {date}',
    briefRecordedDropped: 'Recorded in Project cards · {id} (given up) · {date}', briefArchivedHere: 'Archived · {date}', briefArchivedItems: 'The {count} items at archive time',
    briefClearedNote: 'The brief is empty; the next task starts here.', briefOpenProject: 'Open in Project cards', briefSnapshotStub: 'Task brief v{rev} · {count} items · folded',
    briefThisConversation: 'this conversation', briefNoTask: 'No task in progress in this conversation.',
    projectPastTasks: 'Past tasks', projectWholeWorkspace: 'whole workspace', projectNoPastTasks: 'No task has been archived in this workspace yet. Finished or abandoned tasks are recorded here.',
    projectKindTasks: 'Record · archived automatically', projectCompletedTasks: 'Completed tasks', projectTaskCount: '{count} tasks', projectSettledStub: 'Project cards · {title} · {outcome}',
    briefSources: 'Source messages',
    briefSwitch: 'Task brief', briefSwitchHint: "The model files the goals, constraints and acceptance criteria in your messages into a Task brief card, quoting your words and marking what it inferred. Once checked, your messages can leave the model's context; they are never deleted.",
    cardLast: 'Last: {action}', cardNeeds: 'Fill in first: {names}', cardReplyFailed: 'Could not send the choice to the model; tell it in the conversation instead.',
    cardsSection: "Cards",
    cardsSwitch: "Conversation cards",
    cardsSwitchHint: "The model can leave cards with figures, charts, options and buttons at the end of the conversation. When off, the model no longer sees the card tool and existing cards are hidden.",
    projectSwitch: "Project cards",
    projectSwitchHint: "PROJECT-CARDS.md in the workspace joins the context of every conversation there, and Deep PTC sessions get a Project cards view. When off, nothing is added and the view is hidden.",
    projectTab: "Project cards",
    projectIntro: "The project's standing rules and records, kept in PROJECT-CARDS.md in the workspace. Each request carries only the latest version; older versions are withdrawn. Other conversations in this workspace read them too.",
    projectNoFile: "No PROJECT-CARDS.md yet",
    projectRefresh: "Refresh",
    projectNewCard: "New setting card",
    projectWarnings: "{count} lines are outside the card format and will be preserved.",
    projectDraftConflict: "The file changed. Review the latest version before merging your draft.",
    projectLatestVersion: "Current saved version", projectDraftRebase: "Merge draft into latest", projectDraftMakeNew: "Keep as a new-card draft",
    projectProposals: "Changes waiting for your approval",
    projectProposalChange: "Change “{title}”",
    projectProposalNew: "New “{title}”",
    projectApprove: "Approve",
    projectReject: "Reject",
    projectProposalApproved: "Approved",
    projectProposalRejected: "Rejected",
    projectEmptyTitle: "No project cards yet",
    projectEmptyHint: "Let the model ask you a few questions (stack, conventions, constraints, how you work) and turn the answers into cards for you to approve, or create one yourself.",
    projectBootstrap: "Set up with the model",
    projectEndGuide: "End setup", projectDefer: "Defer setup", projectSetup_deferred: "Project setup deferred; restart when ready", projectSetup_pending: "Drafts await review", projectSetup_guiding: "Project setup started", projectChatSource: "Chat", projectProposalStale: "The card changed. Review a merged proposal, or request a new one if the original was deleted.", projectReviewMerge: "Merge and review",
    projectGuide: "Project card assistant", projectYou: "You", projectAnswer: "Reply to the assistant", projectGuideWorking: "Assistant working…", projectGuideStart: "Help me set up this project's settings here in the panel.",
    projectKindSetting: "Project setting",
    projectKindFeatures: "Implemented features · kept by the model",
    projectKindRequirements: "User requirements · kept by the model",
    projectStatusActive: "Active",
    projectStatusDone: "Done",
    projectStatusSuperseded: "Superseded by {by}",
    projectNoItems: "No entries yet.",
    projectQuestion: "Question",
    projectQuestionPlaceholder: "What is wrong?",
    projectSend: "Send",
    projectCancel: "Cancel",
    projectTitlePlaceholder: "Card title, e.g. Code style",
    projectNew: "new",
    projectItemPlaceholder: "One rule or requirement",
    projectRemoveItem: "Remove",
    projectAddItem: "+ Add an entry",
    projectPolish: "Let the model polish it first",
    projectDelete: "Delete card",
    projectSendPolish: "Send for polishing",
    projectSubmit: "Submit",
    projectHistory: "History",
    projectEdit: "Edit",
    projectNoHistory: "No earlier versions.",
    projectClose: "Close",
    projectRollback: "Roll back to v{rev}",
    projectUnavailable: "This DSH version does not provide session data to this view.",
    projectMsgSubmit: "I updated the project card “{title}” ({change}). Continue with the latest version; the old one no longer applies.",
    projectMsgCreate: "I created the project card “{title}” ({change}). Follow it from now on.",
    projectMsgDelete: "I deleted the project card “{title}”; its settings no longer apply.",
    projectMsgRollback: "I rolled the project card “{title}” back to v{rev} (now {change}). Continue with that version.",
    projectMsgApprove: "I approved proposal {id}; the project card “{title}” is updated ({change}).",
    projectMsgReject: "I rejected proposal {id} (project card “{title}”); that proposal is not adopted. The card stays as its current version in the Project cards view.",
    projectMsgQuestion: "I question {id} in the project card “{title}” (“{text}”): {question}. Please check it and update it with project_cards if needed.",
    projectMsgPolish: "Please polish my edit of the project card “{title}” ({id}): keep the meaning, make each entry a precise, actionable rule, and add nothing I did not ask for; then propose it to me with project_cards propose, with card set to \"{id}\" (change this card, do not create a new one). Send only the changes: reworded entries keep their id (such as R1), new entries have none, ids to delete go in remove; entries you leave out stay as they are. Draft: Keep category {category} and pass baseVersion={version} exactly.\n{items}{removed}",
    projectMsgPolishNew: "Please polish the new project card “{title}”: keep the meaning, make each entry a precise, actionable rule, and add nothing I did not ask for; then propose it to me with project_cards propose. Draft: Keep category {category} and pass baseVersion={version} exactly.\n{items}",
    projectMsgBootstrap: "Please set up project cards for this project: first ask me a few key questions with interactive cards (stack, code conventions, constraints, how I like to work), and use AGENTS.md and README if present; then propose the cards to me with project_cards propose.",
    projectCategory: "Category",
    projectRecords: "Records kept by the model",
    projectRemoved: "\nDelete: {ids}",
    projectCat_stack: "Stack and environment",
    projectCat_conventions: "Code conventions",
    projectCat_constraints: "Constraints",
    projectCat_workflow: "Workflow",
    projectCat_product: "Product",
    projectCat_other: "Other",
    panelMove: "Move “{name}”",
    panelMoveHint: "Drag to reorder, or focus and press ↑ ↓",
    cardArchived: "Archived",
    cardSuperseded: "Updated",
    cardClosedStub: "Closed · {title}",
    cardChose: "Chose: {action}",
    questionKicker: "Your decision",
    questionWaiting: "Waiting for you",
    questionAnswered: "Answered · sent to the model", questionRecorded: "Recorded",
    questionUnanswered: "Not answered",
    questionOptional: "optional",
    questionSubmit: "Submit answers",
    questionRemaining: "{count} left to answer",
    questionReady: "The model receives your answers at once, even mid-task.",
    questionSkipped: "(no answer)",
    questionReplyHead: "[Answers · {title}]",
    projectPolishNow: "Polish",
    polishBy: "Polished by",
    polishBySubagent: "Subagent",
    polishByChat: "This chat",
    polishBySubagentHint: "Polish on its own, without interrupting the conversation",
    polishByChatHint: "Ask the model in this conversation, which knows what was discussed",
    polishWorkingSubagent: "A subagent is polishing…",
    polishWorkingChat: "Sent to this conversation; the model picks it up at its next step…",
    polishFailed: "Polishing did not finish.",
    polishReview: "Suggested wording",
    polishChanges: "{count} changes",
    polishNoChange: "Nothing to change",
    polishTake: "Take",
    polishTakeDelete: "Delete",
    polishKeep: "Keep mine",
    polishTakeAll: "Take all",
    polishApply: "Apply to draft",
    polishDiscard: "Discard",
    projectPanelNone: "No project cards in this workspace yet.",
    projectPanelCount: "{count} setting cards · {records} model records",
    projectPanelPending: "{count} waiting for approval",
    projectPanelEdit: "Edit project cards",
    projectPanelEditHint: "Open the Project cards view without involving the model",
    projectPanelGuideFirst: "Set up with the model",
    projectPanelGuideMore: "Refine with the model",
    projectPanelGuideHint: "The model asks you questions in the main conversation to set up or refine the cards; it receives this at once, even mid-task",
    projectPanelGuideSent: "Sent to the main conversation; the model guides you there.",
    projectPanelNoTab: "The Project cards view is not available; open this conversation first.",
    projectMsgGuideFirst: "Please guide me through setting up project cards here: read the current state with project_cards read and the workspace AGENTS.md / README, then follow the current asking settings to ask me a few key questions together (stack, conventions, constraints, how I work). Propose the cards with project_cards propose; I approve them in the Project cards view.",
    projectMsgGuideMore: "Please guide me through refining the existing project cards here: check with project_cards read what is missing, vague or outdated, then follow the current asking settings to ask me what to add. Propose the changes with project_cards propose; I approve them in the Project cards view.",
    panelLocation: "Panel location",
    locationBeside: "Beside conversation",
    locationSidebar: "Sidebar",
    locationHint: "Sidebar puts the whole Deep PTC panel in a right-sidebar tab that the capsule opens; Beside conversation keeps it next to the chat.",
    locationBetter: " dsh-better-sidebar is loaded: the panel opens as one of its pages and can also go in its bottom workbench.",
    cardTotal: 'Total', cardStep_done: 'Done', cardStep_active: 'In progress', cardStep_todo: 'To do', cardStep_failed: 'Failed',
    agentsTitle: 'Subagents', agentsCount: '{count} total',
    agentRunning: 'Running', agentCompleted: 'Done', agentIdle: 'Idle', agentExternal: 'External',
    agentOpen: 'Open this subagent in the right sidebar',
    sideTitle: 'Deep PTC', toolsSection: 'Tool state', envAuto: 'Auto', envForNew: 'for new sessions', envThisSession: 'This session keeps the environment it was created with.',
    envAutoNow: 'Automatic picks {env}. This session keeps the environment it was created with.', envSaved: 'Saved. New sessions use {env}.',
    envFailed: 'Could not save. Check the distribution name, or whether settings changed elsewhere.', envDefaultDistribution: 'Default distribution',
    durationSeconds: '{s}s', durationMinutes: '{m}m {s}s', durationHours: '{h}h {m}m',
    sideGuide: 'Environment, subagents, background jobs, output files and SSH', sideOtherMode: 'This conversation is not in Deep PTC mode. The environment here applies to new Deep PTC sessions.',
    capsuleOpen: 'Expand or collapse the side panel', panelClose: 'Collapse the side panel',
    panelMoved: 'The Deep PTC panel is beside the conversation. Use the capsule below the composer to expand it.',
    panelMovedToolbar: 'The Deep PTC panel is beside the conversation. Use the capsule in the composer toolbar to expand it.',
    panelMovedHidden: 'The capsule is hidden. Open the Deep PTC panel with the button below, or show the capsule again in Settings → Deep PTC → Appearance.',
    panelOpen: 'Open the Deep PTC panel', panelResize: 'Drag to resize the side panel; double-click to reset',
    capsulePlacement: 'Capsule position', placementAuto: 'Auto', placementDock: 'Below composer', placementToolbar: 'Toolbar', placementHidden: 'Hidden',
    placementHint: 'Auto puts the capsule in the toolbar when a compact composer such as dsh-claude-style is present, and below the composer otherwise. When hidden, open the panel from the Deep PTC tab in the right sidebar.',
    placementAutoNow: 'Auto currently uses: {place}.',
    outputsTitle: 'Output files', outputsEmpty: 'No output files in this conversation.', outputsMore: '{count} more files',
    outputPresented: 'Delivered', outputTurn: 'Turn {turn}',
    outputOpenFailed: 'Could not open the file. Check that it still exists and the host file preview is available.',
    sshTitle: 'SSH connections', sshHint: 'non-interactive', sshNoClient: 'OpenSSH client not found', sshConfigured: 'Configured',
    sshUsed: 'Turn {turn} · {count}×', sshFailed: 'Failed in turn {turn}', sshEmpty: 'No host aliases in ~/.ssh/config and no remote host reached in this conversation.',
    sshCopy: 'Copy SSH check command', sshGoCopy: 'Copy DSH Go connection details', sshCopied: 'Copied', sshCopyFailed: 'Could not copy. Check clipboard permissions.',
    sshGoDetails: 'DSH Go SSH connection\nHost: {host}\nPort: {port}\nUser: {user}\nLocal SSH alias: {alias}\n\nChoose SSH and configure authentication in DSH Go. Use managed dsh web on a Linux/macOS remote host, or attach-only with an existing service on a Windows host. Read the actual service port from its launch result. Bind the service to 127.0.0.1 and enter authorization in the client. The phone must be able to reach this host address.',
    sshUserNeeded: 'Enter the remote user in the client',
    appearance: 'Appearance', visualEffectsAuto: '{name} is installed, so effects start off. Turning them on keeps your choice.',
    diagTitle: 'Diagnostics', diagHint: 'Copy and attach to an issue to help investigate interface problems.', diagCopy: 'Copy diagnostics', diagCopied: 'Copied',
    shellStore: 'PowerShell 7 (Microsoft Store)', presetSafeReason: 'Safe mode: {reason}',
  });

  // Placeholders are filled here, so the text is right whether or not the host locale interpolates.
  const fill = (text, values) => String(text).replace(/\{(\w+)\}/gu, (whole, key) => values[key] === undefined ? whole : String(values[key]));
  const tf = (t, key, values) => fill(t(key, values), values);
  const commandMessageKeys = new Map([
    ['No active conversation. / 当前没有活动对话。', 'commandNoSession'],
    ['This command is available in Deep PTC sessions only. / 该功能仅在深度 PTC 会话中可用。', 'commandWrongMode'],
    ['Invalid skill card command. / 无效的 Skill 卡片操作。', 'commandInvalidSkill'],
  ]);
  // Command texts may start with a stable code, `[dpt:<code>] human text` (lib/model-view.mjs). The
  // client acts on the code, never on the wording.
  const COMMAND_CODE = /^\[dpt:([a-z][a-z0-9-]*(?::[a-z0-9-]+)*)\] ?/u;
  const commandCodeKeys = new Map([['no-session', 'commandNoSession'], ['wrong-mode', 'commandWrongMode']]);
  function commandCode(text) { return COMMAND_CODE.exec(typeof text === 'string' ? text : '')?.[1]; }
  function stripCode(text) { return typeof text === 'string' ? text.replace(COMMAND_CODE, '') : ''; }
  function commandText(text, t) {
    const key = commandCodeKeys.get(commandCode(text)) ?? commandMessageKeys.get(stripCode(text));
    return key ? t(key) : stripCode(text);
  }
  let hostCtx;

  // ---------------------------------------------------------------------------------------------
  // Stylesheet. The cards render only in Deep PTC sessions. The visual effects (the refined look and
  // its motion) apply only while the conversation on screen is a Deep PTC session and effects are on:
  // every effect rule is scoped by body[data-dpt-ui]. Effect rules target the host's own stable
  // attributes (data-composer-card, data-message-bubble); the send button is the one element tagged.
  // Looping animations change opacity or transform only, so the compositor runs them without repaints.
  // ---------------------------------------------------------------------------------------------
  const PLUGIN = 'dsh-deep-ptc-mode';
  const ON = 'body[data-dpt-ui]';
  const DARK = 'body[data-ds-dark-theme]:not([data-ds-dark-theme="false"])';
  const ON_DARK = 'body[data-dpt-ui][data-ds-dark-theme]:not([data-ds-dark-theme="false"])';
  const COMPOSER = '[data-composer-card]';
  const BUBBLE = ':is([data-chat-flow-kind="user"],[data-chat-flow-kind="steering"]) [data-message-bubble]';
  // @client styles

  function injectCss() {
    if (typeof document === 'undefined') return () => {};
    const id = `${PLUGIN}/style.css`;
    document.querySelector(`style[data-plugin-css=${JSON.stringify(id)}]`)?.remove();
    const tag = document.createElement('style');
    tag.dataset.plugin = PLUGIN;
    tag.dataset.pluginCss = id;
    tag.textContent = CARD_CSS + THEME_CSS;
    document.head.appendChild(tag);
    return () => tag.remove();
  }

  // ---------------------------------------------------------------------------------------------
  // Which session is on screen. Each conversation header mounts a hidden bridge; the visible one
  // in the main conversation decides whether the effects are on and whether the agent works. An
  // IntersectionObserver on each bridge's container reports when a conversation is shown or hidden
  // without remounting (split views, a fullscreen sidebar).
  // ---------------------------------------------------------------------------------------------
  const SESSIONS = {
    map: new Map(), subs: new Set(),
    // Sessions whose subagents are running, reported by the capsule (Deep PTC sessions only).
    working: new Map(),
    visibility: undefined,
    watch(element) {
      if (!element || typeof IntersectionObserver !== 'function') return () => {};
      this.visibility ??= new IntersectionObserver(() => this.emit());
      this.visibility.observe(element);
      return () => this.visibility?.unobserve(element);
    },
    setWorking(id, value) { if (this.working.get(id) === value) return; if (value) this.working.set(id, true); else this.working.delete(id); this.emit(); },
    set(id, value) { this.map.set(id, value); this.emit(); },
    del(id) { this.map.delete(id); this.emit(); },
    emit() { for (const listener of this.subs) { try { listener(); } catch (error) { console.warn(`[${PLUGIN}]`, error); } } },
    current() {
      let pick, fallback;
      for (const value of this.map.values()) {
        const shown = value.el?.parentElement?.getClientRects?.().length > 0;
        if (!shown) { fallback ??= value; continue; }
        const main = value.el.closest?.('[data-slot="main.conversation"]');
        if (main || pick === undefined) pick = value;
      }
      return pick ?? fallback;
    },
  };

  // ---------------------------------------------------------------------------------------------
  // The visual effects switch. Without an explicit choice the effects are on, unless an appearance
  // plugin restyles the same composer and bubbles. The host's module loader tags every plugin's
  // <style> with data-plugin, so detection reads only that host-guaranteed marker.
  // ---------------------------------------------------------------------------------------------
  const EFFECTS_KEY = `${PLUGIN}:visual-effects`;
  const APPEARANCE_PLUGINS = ['dsh-claude-style', 'dsh-refined-ui'];
  function appearancePlugin() {
    if (typeof document === 'undefined') return undefined;
    return APPEARANCE_PLUGINS.find(name => document.querySelector(`style[data-plugin="${name}"]`) !== null);
  }
  function storedEffects() {
    try {
      const value = localStorage.getItem(EFFECTS_KEY);
      return value === '1' ? true : value === '0' ? false : undefined;
    } catch { return undefined; }
  }
  let effectsChoice = storedEffects();
  const effectListeners = new Set();
  const getEffects = () => effectsChoice ?? appearancePlugin() === undefined;
  const getEffectsChoice = () => effectsChoice;
  function subscribeEffects(listener) {
    effectListeners.add(listener);
    return () => effectListeners.delete(listener);
  }
  function setEffectsChoice(choice) {
    if (effectsChoice === choice) return;
    effectsChoice = choice;
    for (const listener of effectListeners) listener();
  }
  function toggleEffects() {
    const enabled = !getEffects();
    try { localStorage.setItem(EFFECTS_KEY, enabled ? '1' : '0'); } catch { /* use the in-memory preference */ }
    setEffectsChoice(enabled);
  }
  // The standalone dsh-refined-ui draws the same look; never stack both, whatever the switch says.
  const refinedPresent = () => typeof document !== 'undefined' && document.querySelector('style[data-plugin="dsh-refined-ui"]') !== null;
  const uiOn = () => typeof document !== 'undefined' && document.body?.hasAttribute('data-dpt-ui');

  const BUSY = { on: false, was: false, timer: 0 };
  // How long the effects stay on after the last Deep PTC conversation leaves the screen.
  const OFF_GRACE_MS = 150;
  function applyBusy() {
    if (typeof document === 'undefined') return;
    const busy = uiOn() && BUSY.on;
    document.body.toggleAttribute('data-dpt-busy', busy);
    if (BUSY.was && !busy && uiOn()) {
      const card = document.querySelector(COMPOSER);
      if (card) {
        card.setAttribute('data-dpt-done', '');
        clearTimeout(BUSY.timer);
        BUSY.timer = setTimeout(() => card.removeAttribute('data-dpt-done'), 1000);
      }
    }
    BUSY.was = busy;
  }

  function watchActiveSession() {
    if (typeof document === 'undefined') return () => {};
    let stopVisuals;
    function disableVisuals() {
      if (!stopVisuals) return;
      clearTimeout(BUSY.timer);
      document.querySelectorAll('[data-dpt-done]').forEach(node => node.removeAttribute('data-dpt-done'));
      stopVisuals();
      stopVisuals = undefined;
    }
    const wanted = () => {
      const current = SESSIONS.current();
      return { current, on: getEffects() && current?.preset === 'deep-ptc' && !refinedPresent() };
    };
    const render = ({ current, on }) => {
      document.body.toggleAttribute('data-dpt-ui', on);
      // Like dsh-refined-ui, a running subagent keeps the conversation working.
      BUSY.on = on && (current?.busy === true || SESSIONS.working.get(current?.id) === true);
      applyBusy();
      if (on && !stopVisuals) {
        const cleanups = [watchSurfaces(), watchFx()];
        stopVisuals = () => cleanups.reverse().forEach(cleanup => cleanup());
      } else if (!on) disableVisuals();
    };
    // The switch in settings applies at once.
    let offTimer = 0;
    const update = () => { clearTimeout(offTimer); render(wanted()); };
    // A conversation switch unmounts one header bridge and mounts the next. Session changes settle at
    // the end of the current task, and switching off waits a moment longer, so moving between Deep PTC
    // conversations never removes and re-adds the effects (#17).
    let queued = false;
    const settle = () => {
      queued = false;
      clearTimeout(offTimer);
      const next = wanted();
      if (!next.on && uiOn()) offTimer = setTimeout(update, OFF_GRACE_MS);
      else render(next);
    };
    const schedule = () => {
      if (queued) return;
      queued = true;
      void Promise.resolve().then(settle);
    };
    SESSIONS.subs.add(schedule);
    const unsubscribe = subscribeEffects(update);
    const sync = event => { if (event.key === EFFECTS_KEY || event.key === null) setEffectsChoice(storedEffects()); };
    window.addEventListener('storage', sync);
    update();
    return () => {
      clearTimeout(offTimer);
      SESSIONS.subs.delete(schedule);
      unsubscribe();
      window.removeEventListener('storage', sync);
      document.body.removeAttribute('data-dpt-ui');
      document.body.removeAttribute('data-dpt-busy');
      BUSY.on = false;
      BUSY.was = false;
      disableVisuals();
    };
  }

  // The send button carries no stable host attribute: it is the right-most button in the composer
  // card. Pointer effects (spotlight, magnetic send button, click ripple) read layout at most once
  // per animation frame, whatever the pointer rate.
  function watchSurfaces() {
    if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return () => {};
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const tagged = new Set();
    const highlighted = new Set();
    let tagFrame = 0, pointerFrame = 0, pointer = null, magnet = null;
    function tagSend() {
      tagFrame = 0;
      for (const card of document.querySelectorAll(COMPOSER)) {
        if (card.querySelector('[data-dpt-send]')) continue;
        let best = null, bestRight = -1;
        for (const button of card.querySelectorAll('button,[role="button"]')) {
          const rect = button.getBoundingClientRect();
          if (rect.width > 0 && rect.right >= bestRight) { best = button; bestRight = rect.right; }
        }
        if (best) { best.setAttribute('data-dpt-send', ''); tagged.add(best); }
      }
    }
    function track() {
      pointerFrame = 0;
      const event = pointer;
      pointer = null;
      if (!event || !uiOn()) return;
      const host = event.target?.closest?.(`[data-row-key^="session:"],${COMPOSER}`);
      if (host) {
        const rect = host.getBoundingClientRect();
        host.style.setProperty('--dpt-mx', `${event.x - rect.left}px`);
        host.style.setProperty('--dpt-my', `${event.y - rect.top}px`);
        highlighted.add(host);
      }
      if (reduce) return;
      const button = document.querySelector('[data-dpt-send]');
      if (magnet && magnet !== button) { magnet.style.translate = ''; magnet = null; }
      if (!button) return;
      const rect = button.getBoundingClientRect();
      const dx = event.x - (rect.left + rect.width / 2), dy = event.y - (rect.top + rect.height / 2);
      if (Math.hypot(dx, dy) < 70) { button.style.translate = `${(dx * 0.18).toFixed(1)}px ${(dy * 0.18).toFixed(1)}px`; magnet = button; }
      else if (magnet) { button.style.translate = ''; magnet = null; }
    }
    function onMove(event) {
      pointer = { x: event.clientX, y: event.clientY, target: event.target };
      if (!pointerFrame) pointerFrame = requestAnimationFrame(track);
    }
    function onDown(event) {
      if (event.button !== 0 || reduce || !uiOn()) return;
      if (!event.target?.closest?.('button,a,[role=button],[role=treeitem],[role=tab],[role=menuitem],[role=option],summary')) return;
      const ripple = document.createElement('div');
      ripple.className = 'dpt-ripple';
      ripple.style.left = `${event.clientX}px`;
      ripple.style.top = `${event.clientY}px`;
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 700);
    }
    // Streaming text mutates the document constantly; each burst costs one cheap query per frame.
    const observer = new MutationObserver(() => { if (!tagFrame) tagFrame = requestAnimationFrame(tagSend); });
    observer.observe(document.body, { childList: true, subtree: true });
    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    tagSend();
    return () => {
      observer.disconnect();
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerdown', onDown, true);
      if (tagFrame) cancelAnimationFrame(tagFrame);
      if (pointerFrame) cancelAnimationFrame(pointerFrame);
      if (magnet) magnet.style.translate = '';
      for (const node of tagged) node.removeAttribute('data-dpt-send');
      tagged.clear();
      for (const node of highlighted) {
        node.style.removeProperty('--dpt-mx');
        node.style.removeProperty('--dpt-my');
      }
      for (const node of document.querySelectorAll('.dpt-ripple')) node.remove();
    };
  }

  // Send burst, completion sparkle and embers while the agent works. The canvas covers only the
  // composer and the space above it where the sparks rise, at no more than 1.5 device pixels per
  // CSS pixel, and the frame loop stops whenever nothing moves or the window is hidden.
  function watchFx() {
    if (typeof document === 'undefined' || typeof requestAnimationFrame === 'undefined' || typeof MutationObserver === 'undefined'
      || window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true) return () => {};
    const canvas = document.createElement('canvas');
    canvas.className = 'dpt-fx';
    canvas.setAttribute('aria-hidden', 'true');
    const paint = canvas.getContext('2d');
    if (!paint) return () => {};
    document.body.appendChild(canvas);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const PAD_X = 48, PAD_TOP = 240, PAD_BOTTOM = 24, MAX_PARTS = 160;
    const hues = ['#3370ff', '#5b8cff', '#7fd0ff', '#9dbcff', '#b48cff', '#ffffff'];
    let box, parts = [], raf = 0, lastEmber = 0;
    const busy = () => document.body.hasAttribute('data-dpt-busy');
    let wasBusy = busy();
    function place() {
      const composer = document.querySelector(COMPOSER)?.getBoundingClientRect();
      if (!composer || composer.width === 0) { box = undefined; canvas.style.display = 'none'; return; }
      const left = Math.max(0, Math.floor(composer.left - PAD_X)), top = Math.max(0, Math.floor(composer.top - PAD_TOP));
      const width = Math.max(1, Math.ceil(Math.min(window.innerWidth, composer.right + PAD_X) - left));
      const height = Math.max(1, Math.ceil(Math.min(window.innerHeight, composer.bottom + PAD_BOTTOM) - top));
      if (box?.width !== width || box?.height !== height) {
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr);
        canvas.style.width = `${width}px`; canvas.style.height = `${height}px`;
        paint.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      if (box?.left !== left || box?.top !== top) canvas.style.transform = `translate(${left}px,${top}px)`;
      canvas.style.display = '';
      box = { left, top, width, height, composer };
    }
    const kick = () => { if (!raf && !document.hidden) { place(); raf = requestAnimationFrame(frame); } };
    function burst(x, y, count, power) {
      if (!uiOn()) return;
      for (let index = 0; index < count && parts.length < MAX_PARTS; index++) {
        const angle = Math.random() * Math.PI * 2, speed = (0.4 + Math.random()) * power;
        parts.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - power * 0.35, life: 1,
          decay: 0.014 + Math.random() * 0.016, r: 1.4 + Math.random() * 2.4, color: hues[(Math.random() * hues.length) | 0] });
      }
      kick();
    }
    function frame(now) {
      raf = 0;
      if (!box) { parts = []; return; }
      paint.clearRect(0, 0, box.width, box.height);
      // Embers rise from the composer while the agent works.
      if (busy() && now - lastEmber > 35 && parts.length < MAX_PARTS) {
        lastEmber = now;
        const rect = box.composer;
        parts.push({ x: rect.left + 12 + Math.random() * (rect.width - 24), y: rect.top + 2, vx: (Math.random() - 0.5) * 0.5,
          vy: -(0.5 + Math.random() * 1.1), gravity: -0.004, life: 1, decay: 0.009 + Math.random() * 0.01,
          r: 1.8 + Math.random() * 2.4, color: hues[(Math.random() * 4) | 0] });
      }
      paint.globalCompositeOperation = 'lighter';
      let live = 0;
      for (const part of parts) {
        part.x += part.vx; part.y += part.vy; part.vy += part.gravity ?? 0.09; part.vx *= 0.985; part.life -= part.decay;
        if (part.life <= 0) continue;
        parts[live++] = part;
        paint.globalAlpha = part.life;
        paint.fillStyle = part.color;
        paint.beginPath();
        paint.arc(part.x - box.left, part.y - box.top, part.r * (0.4 + part.life * 0.6), 0, 6.3);
        paint.fill();
      }
      parts.length = live;
      paint.globalAlpha = 1;
      paint.globalCompositeOperation = 'source-over';
      if (parts.length || busy()) raf = document.hidden ? 0 : requestAnimationFrame(frame);
      else paint.clearRect(0, 0, box.width, box.height);
    }
    const center = node => { const rect = node.getBoundingClientRect(); return [rect.left + rect.width / 2, rect.top + rect.height / 2]; };
    function onDown(event) {
      const button = event.target?.closest?.('[data-dpt-send]');
      if (button && event.button === 0) burst(...center(button), 34, 4.2);
    }
    // Sending with Enter bursts like a click; the key event is only observed, never consumed.
    function onSend(event) {
      if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
      if (!event.target?.closest?.('[data-composer-input]')) return;
      const button = document.querySelector('[data-dpt-send]');
      if (button) burst(...center(button), 34, 4.2);
    }
    const observer = new MutationObserver(() => {
      const now = busy();
      if (wasBusy && !now) {
        place();
        const rect = box?.composer;
        if (rect) {
          burst(rect.left + rect.width / 2, rect.top, 22, 3.2);
          burst(rect.left + rect.width * 0.25, rect.top, 10, 2.4);
          burst(rect.left + rect.width * 0.75, rect.top, 10, 2.4);
        }
      }
      if (now) kick();
      wasBusy = now;
    });
    const onResize = () => { if (raf) place(); };
    const onVisibility = () => { if (!document.hidden && (parts.length || busy())) kick(); };
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisibility);
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-dpt-busy'] });
    document.addEventListener('pointerdown', onDown, { capture: true, passive: true });
    document.addEventListener('keydown', onSend, { capture: true, passive: true });
    if (wasBusy) kick();
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVisibility);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onSend, true);
      observer.disconnect();
      if (raf) cancelAnimationFrame(raf);
      canvas.remove();
    };
  }

  // A read-only outline of what the effects rely on, copied from the settings page for bug reports.
  function diagnostics() {
    const count = selector => typeof document === 'undefined' ? 0 : document.querySelectorAll(selector).length;
    const current = SESSIONS.current();
    return [
      `${PLUGIN} client | effects=${getEffects()} choice=${String(effectsChoice)} appearance=${appearancePlugin() ?? '-'} ui=${uiOn()}`,
      `session=${current?.id ?? '-'} preset=${current?.preset ?? '-'} busy=${current?.busy === true} working=${SESSIONS.working.size}`,
      `host: composer=${count(COMPOSER)} input=${count('[data-composer-input]')} bubble=${count('[data-message-bubble]')} send=${count('[data-dpt-send]')}`,
      `ui: capsule=${count('.dpt-capsule')} panel=${count('.dpt-panel')} skills=${count('.dpt-skills')}`,
      `ua=${typeof navigator === 'undefined' ? '-' : navigator.userAgent}`,
    ].join('\n');
  }
  // ---------------------------------------------------------------------------------------------
  // Skill card, at the end of the latest turn in the conversation.
  // ---------------------------------------------------------------------------------------------
  const SKILL_ROWS = 4;
  const SkillIcon = () => h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M3.5 2.75h6.25L12.5 5.5v7.75H3.5z', stroke: 'currentColor', strokeWidth: 1.3, strokeLinejoin: 'round' }),
    h('path', { d: 'M9.5 2.75V5.75h3M5.75 8.5h4.5M5.75 10.75h3', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }));

  function SkillSwitch({ on, disabled, label, onChange }) {
    return h('button', { type: 'button', role: 'switch', className: 'dpt-switch', 'aria-checked': on, 'aria-label': label, title: label, disabled,
      onClick: () => { if (!disabled) onChange(!on); } }, h('span', { className: 'dpt-switch-thumb', 'aria-hidden': 'true' }));
  }

  function VisualEffectsSection({ t }) {
    const enabled = React.useSyncExternalStore(subscribeEffects, getEffects, getEffects);
    const choice = React.useSyncExternalStore(subscribeEffects, getEffectsChoice, getEffectsChoice);
    const appearance = choice === undefined ? appearancePlugin() : undefined;
    const label = t('visualEffects');
    return h('section', { className: 'dpt-side-section dpt-side-effects', 'aria-label': label },
      h('div', { className: 'dpt-side-label' }, h('span', null, label),
        h(SkillSwitch, { on: enabled, label, onChange: toggleEffects })),
      h('p', { className: 'dpt-side-note' }, appearance ? tf(t, 'visualEffectsAuto', { name: appearance }) : t('visualEffectsHint')));
  }

  // Deep PTC's own skills carry a summary in the display language; other skills show the catalog text.
  function skillSummary(row, t) {
    const key = 'skillDesc:' + row.name;
    const localized = t(key);
    return typeof localized === 'string' && localized !== '' && localized !== key ? localized : row.description;
  }

  function DirectNote({ useProjection, t }) {
    const cards = projectionValue(useProjection, 'deepPtcCards');
    return cards?.delegated ? h('p', { className: 'dpt-direct', role: 'note' }, t('delegatedDirect')) : null;
  }

  function AssignmentCard({ node, t }) {
    return h('section', { className: 'dpt-cc', 'aria-label': t('delegatedAssignment') },
      h('header', { className: 'dpt-cc-head' }, h('div', { className: 'dpt-cc-titles' },
        h('span', { className: 'dpt-cc-sub' }, t('delegatedAssignment')), h('span', { className: 'dpt-cc-title' }, node.data.title))),
      h('ul', { className: 'dpt-tb-items dpt-cc-body' }, ...node.data.items.map((item, index) => h('li', { key: index, className: 'dpt-cc-text' }, item))));
  }

  function ProjectSync({ sessionId, useProjection, form, refresh }) {
    const deep = projectionValue(useProjection, 'agentPreset') === 'deep-ptc';
    const enabled = useFormValue(form, 'projectCards') !== false;
    React.useEffect(() => { if (deep && enabled) void refresh().catch(() => {}); }, [sessionId, deep, enabled]);
    return null;
  }

  function SkillCard({ anchor, turn, useProjection, useChat, setSkill, setAll, t }) {
    const [busy, setBusy] = React.useState(false);
    const [expanded, setExpanded] = React.useState(false);
    // Projection failures are not caught: a silent null would make a broken card look like "no skills".
    const state = useProjection('deepPtcSkills');
    const lastTurn = typeof useChat === 'function' ? useChat(snapshot => snapshot?.timeline?.turnOrder?.at?.(-1)) : undefined;
    const turnNumber = typeof turn === 'number' ? turn : turn?.turn;
    const latest = turnNumber === undefined || (lastTurn !== undefined ? lastTurn === turnNumber : state?.turn === turnNumber);
    if (!state || String(state.anchor) !== anchor || !Array.isArray(state.skills) || state.skills.length === 0 || !latest) return null;
    async function run(action) {
      setBusy(true);
      try { await action(); } catch { /* the projection is authoritative */ } finally { setBusy(false); }
    }
    const closing = state.skills.filter(row => !row.enabled).length;
    const rows = expanded ? state.skills : state.skills.slice(0, SKILL_ROWS);
    return h('details', { className: 'dpt-card dpt-skills', 'aria-label': t('skillTitle') },
      h('summary', { className: 'dpt-card-head' }, h(SkillIcon), t('skillTitle'), ' · ', state.skills.length),
      h('header', { className: 'dpt-card-head' },
        h('div', { className: 'dpt-card-titles' },
          h('span', { className: 'dpt-card-title' }, t('skillTitle')),
          h('span', { className: 'dpt-card-sub' }, tf(t, 'skillLoaded', { count: state.skills.length }),
            closing ? h(React.Fragment, null, ' · ', h('span', { 'data-tone': 'warn' }, tf(t, 'skillClosing', { count: closing }))) : null)),
        h('div', { className: 'dpt-card-actions' },
          h('button', { type: 'button', className: 'dpt-btn', disabled: busy || closing === 0, 'aria-busy': busy,
            onClick: () => { void run(() => setAll(true)); } }, t('skillKeepAll')),
          h('button', { type: 'button', className: 'dpt-btn', disabled: busy || closing === state.skills.length, 'aria-busy': busy,
            onClick: () => { void run(() => setAll(false)); } }, t('skillCloseAll')))),
      h('ul', { className: 'dpt-skill-list' }, ...rows.map(row => h('li', { key: row.name, className: 'dpt-skill', 'data-off': row.enabled ? undefined : '' },
        h('div', { className: 'dpt-skill-text' },
          h('span', { className: 'dpt-skill-name' }, h('span', null, row.name),
            row.loadedTurn === state.turn ? h('span', { className: 'dpt-tag' }, t('skillThisTurn')) : null),
          h('span', { className: 'dpt-skill-desc', title: skillSummary(row, t) || t('skillNoDescription') }, skillSummary(row, t) || t('skillNoDescription'))),
        h(SkillSwitch, { on: row.enabled, disabled: busy, label: row.name, onChange: value => { void run(() => setSkill(row.name, value)); } })))),
      h('footer', { className: 'dpt-card-foot' }, h('span', null, t('skillHint')),
        state.skills.length > SKILL_ROWS ? h('button', { type: 'button', className: 'dpt-link', onClick: () => setExpanded(!expanded) },
          expanded ? t('skillShowLess') : tf(t, 'skillShowAll', { count: state.skills.length })) : null));
  }

  function SkillTail(props) {
    // Registered for every session; only Deep PTC sessions read the skill projection.
    let preset;
    try { preset = props.useProjection('agentPreset'); } catch { return null; }
    const delegated = projectionValue(props.useProjection, 'deepPtcCards')?.delegated;
    if (preset !== 'deep-ptc' || delegated) return null;
    return h(SkillCard, props);
  }

  // ---------------------------------------------------------------------------------------------
  // Conversation cards. They are plugin state, not host cards: the model leaves one through the
  // plugin's own tool, the projection stores it in the session log, and the button runs a host
  // command. They render at the end of the latest turn, in the page flow.
  // ---------------------------------------------------------------------------------------------
  const CARD_COMMAND_NAME = 'deep-ptc-card-act';

  function CardCommandRow({ node, t }) {
    const outcome = node?.outcome;
    if (outcome?.kind === 'error') return h('div', { className: 'dpt-command-error', role: 'status' }, commandText(outcome.text, t));
    return h('span', { hidden: true, 'data-dpt-hidden-command': CARD_COMMAND_NAME });
  }

  // The host's session API, injected on its own so a host without it still renders every card.
  const REMOTE_SESSION = { current: undefined };
  async function sendReply(_child, sessionId, text) {
    try {
      const prompt = REMOTE_SESSION.current?.remote?.session?.prompt;
      if (typeof prompt !== 'function') return false;
      const requestId = globalThis.crypto?.randomUUID?.() ?? `dpt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const result = await prompt({ requestId, sessionId, mode: 'steer', content: [{ type: 'text', text }] });
      return result?.ok !== false;
    } catch (error) {
      console.warn(`[${PLUGIN}] could not send a message to the model`, error);
      return false;
    }
  }

  function runVirtualCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return Promise.resolve({ ok: false, error: { message: 'unavailable' } });
    return execute(sessionId, '/deep-ptc-virtual-dsh ' + JSON.stringify(payload), []);
  }

  function runCardCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return Promise.resolve({ ok: false, error: { message: 'unavailable' } });
    return execute(sessionId, `/${CARD_COMMAND_NAME} ` + JSON.stringify({ ...payload, codedReceipt: true }), []);
  }

  // @client notices

  // @client sound-settings

  // @client conversation-cards

  // ---------------------------------------------------------------------------------------------
  // Settings switches for the two card features, and the 特点卡片 (project cards) view.
  // ---------------------------------------------------------------------------------------------
  function formValue(form, key) {
    try { return form?.getSnapshot?.()?.value?.[key]; } catch { return undefined; }
  }
  function useFormValue(form, key) {
    const subscribe = React.useCallback(listener => form?.subscribe?.(listener) ?? noSubscribe(), [form]);
    const read = React.useCallback(() => formValue(form, key), [form, key]);
    return React.useSyncExternalStore(subscribe, read, read);
  }

  function CardsSettingsSection({ form, t }) {
    const conversation = useFormValue(form, 'conversationCards') !== false;
    const project = useFormValue(form, 'projectCards') !== false;
    const brief = useFormValue(form, 'taskBrief') !== false;
    const sleep = useFormValue(form, 'deepSleep') !== false;
    const mobile = useFormValue(form, 'mobileCards') !== false;
    const sound = useFormValue(form, 'notifySound') !== false;
    const done = useFormValue(form, 'notifyDone') !== false;
    const popup = useFormValue(form, 'notifyPopup') ?? 'always';
    const native = useFormValue(form, 'notifyHost') === 'native';
    const [failed, setFailed] = React.useState(false);
    const writable = form?.getSnapshot?.()?.writable !== false && form !== undefined;
    async function set(key, value) {
      setFailed(false);
      try {
        const ok = await form.mutate([{ op: 'set', path: [key], value }], form.getSnapshot().revision);
        if (!ok) setFailed(true);
      } catch { setFailed(true); }
    }
    const row = (key, on, label, hint) => h('div', { className: 'dpt-side-section' },
      h('div', { className: 'dpt-side-label' }, h('span', null, label),
        h(SkillSwitch, { on, label, disabled: !writable, onChange: value => { void set(key, value); } })),
      h('p', { className: 'dpt-side-note' }, hint));
    return h(React.Fragment, null,
      row('conversationCards', conversation, t('cardsSwitch'), t('cardsSwitchHint')),
      row('projectCards', project, t('projectSwitch'), t('projectSwitchHint')),
      row('taskBrief', brief, t('briefSwitch'), t('briefSwitchHint')),
      row('deepSleep', sleep, t('sleepSwitch'), t('sleepSwitchHint')),
      row('mobileCards', mobile, t('mobileSwitch'), t('mobileSwitchHint')),
      row('notifySound', sound, t('noticeSound'), t('noticeSoundHint')),
      row('notifyDone', done, t('noticeDone'), t('noticeDoneHint')),
      native ? h('div', { className: 'dpt-side-section' },
        h('div', { className: 'dpt-side-label' }, h('span', null, t('noticePopup'))),
        h('div', { className: 'dpt-seg', role: 'radiogroup', 'aria-label': t('noticePopup') }, ...['always', 'away', 'off'].map(value =>
          h('button', { key: value, type: 'button', role: 'radio', className: 'dpt-seg-btn', 'aria-checked': popup === value, disabled: !writable,
            onClick: () => { void set('notifyPopup', value); } }, t('noticePopup_' + value)))),
        h('p', { className: 'dpt-side-note' }, t('noticePopupHint'))) : null,
      failed ? h('p', { className: 'dpt-side-note', role: 'alert' }, t('failed')) : null);
  }

  // @client project-cards

  // @client task-brief

  // ---------------------------------------------------------------------------------------------
  // The Deep PTC panel. Subagent rows follow the official subagent catalog and timing projections;
  // a row opens the official subagent chat in the right sidebar.
  // ---------------------------------------------------------------------------------------------
  const AGENT_ROWS = 24;

  function subagentRows(sessions, rootId, now) {
    const catalogOf = id => {
      const value = sessions?.projectionsBySession?.[id]?.values?.subagentCatalog ?? sessions?.byId?.[id]?.projectionValues?.subagentCatalog;
      return Array.isArray(value) ? value : [];
    };
    const rows = [];
    const seen = new Set([rootId]);
    const visit = (parentId, depth) => {
      if (depth > 2) return;
      for (const entry of catalogOf(parentId)) {
        if (rows.length >= AGENT_ROWS) return;
        if (typeof entry?.id !== 'string' || seen.has(entry.id)) continue;
        seen.add(entry.id);
        const summary = sessions?.byId?.[entry.id];
        const timing = summary?.projectionValues?.subagentTiming;
        const external = entry.mode === 'external';
        // The parent's catalog refreshes only when the official dropdown opens; the session list carries
        // each session's live running flag.
        const running = !external && (entry.activity === 'running' || summary?.running === true);
        const completed = !external && entry.activity === 'inactive' && timing?.lastTurnCompleted === true;
        const duration = timing === undefined || external ? undefined : timing.active === undefined ? timing.settledMs
          : timing.settledMs + Math.max(0, (running ? now : timing.active.through) - timing.active.since);
        rows.push({ id: entry.id, parentId, mode: entry.mode, depth,
          label: entry.label ?? summary?.title ?? summary?.displayTitle ?? entry.id,
          state: external ? 'external' : running ? 'running' : completed ? 'completed' : 'idle',
          duration: Number.isFinite(duration) ? duration : undefined });
        visit(entry.id, depth + 1);
      }
    };
    visit(rootId, 0);
    return rows;
  }

  function formatDuration(ms, t) {
    const total = Math.floor(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
    if (h > 0) return tf(t, 'durationHours', { h, m });
    if (total >= 60) return tf(t, 'durationMinutes', { m: Math.floor(total / 60), s });
    return tf(t, 'durationSeconds', { s });
  }
  function openSubagent(row) {
    const sidebar = hostCtx?.get?.('sidebarRight');
    if (typeof sidebar?.openResource === 'function') {
      const query = new URLSearchParams({ parent: row.parentId, mode: row.mode ?? 'unknown' });
      sidebar.openResource(`dsh-resource://subagentchat/session/${encodeURIComponent(row.id)}?${query}`, { kind: 'subagentchat', preferNewPane: true });
      return;
    }
    const workspace = hostCtx?.get?.('uiWorkspace');
    if (typeof workspace?.openSession === 'function') {
      workspace.openSession({ parentSessionId: row.parentId, childSessionId: row.id, mode: row.mode });
    }
  }

  // The execution environment for Deep PTC sessions created from now on. It writes the same host
  // settings form as the plugin settings page; a session keeps the environment it was created with.
  const ENV_SHORT = { auto: 'envAuto', wsl: 'WSL', powershell: 'PowerShell', zsh: 'Zsh', bash: 'Bash' };
  const NO_FORM = { status: 'unavailable' };
  const noSubscribe = () => () => {};
  const noSnapshot = () => NO_FORM;
  const allowedEnvironments = platform => platform === 'win32' ? ['auto', 'wsl', 'powershell', 'bash'] : ['auto', 'zsh', 'bash'];
  const effectiveEnvironment = (environment, platform) => environment !== 'auto' ? environment
    : platform === 'win32' ? 'powershell' : platform === 'darwin' ? 'zsh' : 'bash';
  const envLabel = (value, t) => value === 'auto' ? t('envAuto') : ENV_SHORT[value] ?? value;
  function shellLabel(label, t) {
    if (label === 'PowerShell 7 Preview') return t('shellPreview');
    if (label === 'PowerShell 7 (Microsoft Store)') return t('shellStore');
    const system = /^(bash|zsh) \(system\)$/u.exec(label);
    return system ? tf(t, 'shellSystem', { name: system[1] }) : label;
  }

  // Only slots that show one entry are localized here. The settings page lists every entry of
  // settings.section, so Deep PTC has its own page instead of a second Agent presets entry.
  const PRESET_LABEL_SLOTS = [
    ['conversation.hero.agentPreset', undefined, 'useAgentPresetSeat', 'options'],
    ['conversation.session.header.actions', 'agent-preset', 'useAgentPresets', 'options'],
  ];

  // The host publishes `Deep PTC · <status>` (presetDescription in lib/model.mjs), readable as is in
  // any language. This reads the status back so the picker can show it in the active language.
  const STATUS_PREFIX = 'Deep PTC · ';
  const SAFE_LABEL = '安全模式 Safe mode';
  const OFFICIAL_LABEL = '官方 Shell Official shell';
  function presetStatus(description) {
    if (typeof description !== 'string' || !description.startsWith(STATUS_PREFIX)) return undefined;
    const text = description.slice(STATUS_PREFIX.length);
    if (text.startsWith(SAFE_LABEL)) return { kind: 'safe', reason: text.slice(SAFE_LABEL.length).replace(/^:\s*/u, '') };
    if (text === OFFICIAL_LABEL) return { kind: 'official' };
    const environment = /^(WSL|PowerShell|Zsh|Bash)(?: \((.+)\))?$/u.exec(text);
    return environment ? { kind: 'environment', label: environment[1], distribution: environment[2] } : undefined;
  }

  function translatedPreset(row, t) {
    if (row?.id !== 'deep-ptc') return row;
    const status = presetStatus(row.description);
    let line;
    if (status?.kind === 'safe') line = status.reason ? tf(t, 'presetSafeReason', { reason: status.reason }) : t('presetSafeMode');
    else if (status?.kind === 'official') line = tf(t, 'presetEnvironment', { env: t('presetOfficial') });
    else if (status?.kind === 'environment') line = tf(t, 'presetEnvironment', { env: status.distribution ? `${status.label} (${status.distribution})` : status.label });
    return { ...row, name: t('presetName'), description: [t('presetDescription'), line].filter(Boolean).join(' ') };
  }

  function presetSnapshotTranslator(rowsKey, t) {
    const cache = new WeakMap();
    return snapshot => {
      if (!snapshot || typeof snapshot !== 'object') return snapshot;
      if (cache.has(snapshot)) return cache.get(snapshot);
      const rows = snapshot[rowsKey];
      const error = snapshot.error;
      const hasPreset = Array.isArray(rows) && rows.some(row => row.id === 'deep-ptc');
      const hasPresetError = error?.preset?.id === 'deep-ptc';
      const localized = hasPreset || hasPresetError ? {
        ...snapshot,
        ...(hasPreset ? { [rowsKey]: rows.map(row => translatedPreset(row, t)) } : {}),
        ...(hasPresetError ? { error: { ...error, preset: translatedPreset(error.preset, t) } } : {}),
      } : snapshot;
      cache.set(snapshot, localized);
      return localized;
    };
  }

  // Keep the native picker and its actions. A higher-priority slot entry supplies localized
  // display snapshots only for our row, while the host owns the actual selection and preset.
  function installPresetLabels(slots, t, useLocaleRevision) {
    if (typeof slots.entriesOfSlot !== 'function' || typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return;
    for (const [name, id, hook, rows] of PRESET_LABEL_SLOTS) {
      slots.inject(name, () => {
        let original;
        let dispose;
        const sync = () => {
          const entry = slots.entries(name).find(item => item.options?.id === id && (item.options?.priority ?? 0) === 0
            && item.locale === 'settings.agentPreset' && !item.children && !item.store && typeof item.component === 'function');
          if (entry === original) return;
          original = entry;
          dispose?.();
          dispose = undefined;
          if (!entry) return;
          function LocalizedPresetSlot(props) {
            const revision = useLocaleRevision();
            const translate = React.useMemo(() => presetSnapshotTranslator(rows, t), [revision]);
            const useRoster = props[hook];
            const useLocalizedRoster = React.useCallback((select, equal) => useRoster(
              snapshot => select(translate(snapshot)), equal), [useRoster, translate]);
            return h(entry.component, typeof useRoster === 'function' ? { ...props, [hook]: useLocalizedRoster } : props);
          }
          try {
            dispose = slots.register({ ...entry.options, name, priority: -1, locale: entry.locale, inject: entry.inject }, LocalizedPresetSlot);
          } catch { /* Another plugin may already own the presentation slot. */ }
        };
        const unsubscribe = slots.subscribe(name, sync);
        sync();
        return () => { unsubscribe(); dispose?.(); };
      });
    }
  }

  function useSettingsForm(form) {
    const subscribe = React.useCallback(listener => form ? form.subscribe(listener) : () => {}, [form]);
    const read = React.useCallback(() => form ? form.getSnapshot() : NO_FORM, [form]);
    return React.useSyncExternalStore(form ? subscribe : noSubscribe, form ? read : noSnapshot, form ? read : noSnapshot);
  }

  function EnvironmentSection({ form, t }) {
    const state = useSettingsForm(form);
    const [saving, setSaving] = React.useState(false);
    const [message, setMessage] = React.useState(null);
    const [distribution, setDistribution] = React.useState(undefined);
    const [bashPath, setBashPath] = React.useState(undefined);
    if (!form || state.status === 'unavailable') return null;
    if (state.status !== 'ready' || !state.value) return h('section', { className: 'dpt-side-section' }, h('p', { className: 'dpt-side-note' }, t('loading')));
    const value = state.value;
    const platform = value.hostPlatform;
    const environment = value.environment ?? 'auto';
    const editingBash = platform === 'win32' && (environment === 'bash' || bashPath !== undefined);
    const bashDraft = bashPath ?? value.shellExecutable ?? '';
    const effective = effectiveEnvironment(environment, platform);
    const choices = (Array.isArray(value.shellChoices) ? value.shellChoices : []).filter(item => item && typeof item.id === 'string');
    const disabled = !state.writable || saving;
    const savedDistribution = value.wslDistribution ?? '';
    const draft = distribution ?? savedDistribution;
    async function save(ops, label) {
      setSaving(true); setMessage(null);
      try {
        const ok = await form.mutate(ops, form.getSnapshot().revision);
        if (!ok) throw new Error('rejected');
        setMessage({ tone: 'ok', label });
        return true;
      } catch {
        setMessage({ tone: 'error' });
        return false;
      } finally { setSaving(false); }
    }
    function choose(next) {
      if (platform === 'win32' && next === 'bash') {
        if (environment !== 'bash') setBashPath('');
        setMessage(null);
        return;
      }
      setBashPath(undefined);
      if (next === environment) return;
      const family = effectiveEnvironment(next, platform);
      const current = choices.find(item => item.id === value.shellExecutable);
      const ops = [{ op: 'set', path: ['environment'], value: next }];
      // A shell picked for another family would not apply; fall back to the official lookup.
      if (value.shellExecutable && current?.family !== family) ops.push({ op: 'set', path: ['shellExecutable'], value: '' });
      void save(ops, next === 'auto' ? { key: 'envAuto' } : envLabel(next, t));
    }
    async function saveDistribution(event) {
      event?.preventDefault?.();
      const next = draft.trim();
      if (next === savedDistribution) { setDistribution(undefined); return; }
      if (await save([{ op: 'set', path: ['wslDistribution'], value: next }], next ? `WSL (${next})` : 'WSL')) setDistribution(undefined);
    }
    async function saveBash(event) {
      event.preventDefault();
      const next = bashDraft.trim();
      if (!next || (environment === 'bash' && next === value.shellExecutable)) return;
      if (await save([{ op: 'set', path: ['environment'], value: 'bash' },
        { op: 'set', path: ['shellExecutable'], value: next }], 'Bash')) setBashPath(undefined);
    }
    const familyChoices = choices.filter(item => item.family === effective);
    let note;
    if (message?.tone === 'error') note = t('envFailed');
    else if (message) {
      const label = message.label;
      const env = typeof label === 'string' ? label : label.key ? t(label.key) : shellLabel(label.shell, t);
      note = tf(t, 'envSaved', { env });
    } else if (!state.writable) note = t('readOnly');
    else if (environment === 'auto') note = tf(t, 'envAutoNow', { env: envLabel(effective, t) });
    return h('section', { className: 'dpt-side-section', 'aria-label': t('environment') },
      h('div', { className: 'dpt-side-label' }, h('span', null, t('environment')), h('span', { className: 'dpt-side-hint', title: t('envThisSession') }, t('envForNew'))),
      h('div', { className: 'dpt-seg', role: 'radiogroup', 'aria-label': t('environment') },
        ...allowedEnvironments(platform).map(option => h('button', { key: option, type: 'button', role: 'radio', className: 'dpt-seg-btn',
          'aria-checked': option === (editingBash ? 'bash' : environment), disabled,
          title: t(platform === 'win32' && option === 'bash' ? 'windowsBash' : option),
          onClick: () => choose(option) }, envLabel(option, t)))),
      editingBash ? h(React.Fragment, null,
        h('form', { className: 'dpt-field', onSubmit: saveBash },
          h('input', { className: 'dpt-input', value: bashDraft, disabled, placeholder: t('bashPath'), 'aria-label': t('bashPath'),
            onChange: event => { setBashPath(event.target.value); setMessage(null); } }),
          (environment !== 'bash' || bashDraft.trim() !== value.shellExecutable)
            ? h('button', { type: 'submit', className: 'dpt-btn', disabled: disabled || !bashDraft.trim() }, t('save')) : null),
        h('p', { className: 'dpt-side-note' }, t('bashPathHint'))) : null,
      !editingBash && effective === 'wsl' ? h('form', { className: 'dpt-field', onSubmit: saveDistribution },
        h('input', { className: 'dpt-input', value: draft, disabled, placeholder: t('envDefaultDistribution'), 'aria-label': t('distribution'),
          title: t('distributionHint'), onChange: event => { setDistribution(event.target.value); setMessage(null); } }),
        draft.trim() !== savedDistribution ? h('button', { type: 'submit', className: 'dpt-btn', disabled }, t('save')) : null) : null,
      !editingBash && effective !== 'wsl' && familyChoices.length > 0 ? h('div', { className: 'dpt-field' },
        h('select', { className: 'dpt-select', value: value.shellExecutable ?? '', disabled, 'aria-label': t('shell'), title: t('shellHint'),
          onChange: event => { const item = familyChoices.find(choice => choice.id === event.target.value);
            void save([{ op: 'set', path: ['shellExecutable'], value: event.target.value }], item ? { shell: item.label } : { key: 'shellAuto' }); } },
        h('option', { value: '' }, t('shellAuto')), ...familyChoices.map(item => h('option', { key: item.id, value: item.id }, shellLabel(item.label, t))))) : null,
      note ? h('p', { className: 'dpt-side-note', role: 'status', 'data-tone': message?.tone }, note) : null);
  }

  // Most jobs are commands that settle in well under a second (half of them in a real session took
  // under 0.5 s). Listing each one made the panel jump on every command, so the list holds only jobs
  // that run long enough to matter, keeps a finished row briefly in place, and leaves the counts to
  // the section header, which never changes height.
  const JOB_SHOW_AFTER = 1500;
  const JOB_LINGER = 4000;
  const JOB_ROWS = 4;
  const JOB_MEMORY = 40;
  const LIVE_JOB = new Set(['running', 'stopping']);
  const JOB_STATUS = new Map([
    ['running', 'jobRunning'], ['stopping', 'jobStopping'], ['completed', 'jobCompleted'],
    ['killed', 'jobKilled'], ['failed', 'jobFailed'], ['ended', 'jobEnded'],
  ]);

  /**
   * What one panel view knows about this session's jobs. The desktop roster drops a job the moment it
   * settles, and its timestamps come from another clock, so the view keeps its own record:
   *   jobs   the last row of every job seen (a live job that leaves the roster becomes `ended`);
   *   ended  when this view saw a live job stop running, on the view's clock;
   *   shown  the jobs that already had a row, which keep it until they leave.
   */
  function jobMemory() {
    return { jobs: new Map(), ended: new Map(), shown: new Set() };
  }

  function rememberJobs(memory, roster, now) {
    const incoming = new Set();
    for (const job of roster ?? []) {
      incoming.add(job.id);
      const before = memory.jobs.get(job.id);
      if (!LIVE_JOB.has(job.status) && before !== undefined && LIVE_JOB.has(before.status)) memory.ended.set(job.id, now);
      memory.jobs.set(job.id, job);
    }
    for (const [id, job] of memory.jobs) {
      if (incoming.has(id) || !LIVE_JOB.has(job.status)) continue;
      memory.jobs.set(id, { ...job, status: 'ended' });
      memory.ended.set(id, now);
    }
    const settled = [...memory.jobs.values()].filter(job => !LIVE_JOB.has(job.status));
    for (const job of settled.slice(0, Math.max(0, settled.length - JOB_MEMORY))) {
      memory.ended.delete(job.id); memory.jobs.delete(job.id); memory.shown.delete(job.id);
    }
    return [...memory.jobs.values()];
  }

  /** The jobs to list, in start order so rows keep their place, and the counts for the header. */
  function jobRows(memory, now) {
    const known = [...memory.jobs.values()].filter(job => JOB_STATUS.has(job.status));
    const live = known.filter(job => LIVE_JOB.has(job.status));
    const settled = known.filter(job => !LIVE_JOB.has(job.status));
    const endedAt = job => memory.ended.get(job.id) ?? job.finishedAt ?? 0;
    const lingering = job => memory.ended.has(job.id) && now - memory.ended.get(job.id) < JOB_LINGER;
    const long = job => job.status === 'stopping' || now - job.startedAt >= JOB_SHOW_AFTER;
    const shown = [...live.filter(job => memory.shown.has(job.id) || long(job)),
      ...settled.filter(job => memory.shown.has(job.id) && lingering(job))].sort((left, right) => left.startedAt - right.startedAt);
    const recent = [...settled].sort((left, right) => endedAt(right) - endedAt(left));
    // The clock runs while a job is live or a finished row is still in place.
    const ticking = live.length > 0 || settled.some(job => memory.shown.has(job.id) && lingering(job));
    return { live, settled, failed: settled.filter(job => job.status === 'failed').length, shown, recent, ticking };
  }

  function useClock(active, interval = 500) {
    const [now, setNow] = React.useState(() => Date.now());
    React.useEffect(() => {
      if (!active) return undefined;
      setNow(Date.now());
      const timer = setInterval(() => setNow(Date.now()), interval);
      return () => clearInterval(timer);
    }, [active, interval]);
    return now;
  }

  function BackgroundJobs({ jobs: roster, t }) {
    const [open, setOpen] = React.useState(false);
    const memory = React.useRef(null);
    memory.current ??= jobMemory();
    rememberJobs(memory.current, roster, Date.now());
    // A first look at the current time decides whether the clock needs to run at all.
    const now = useClock(jobRows(memory.current, Date.now()).ticking);
    const { live, settled, failed, shown, recent } = jobRows(memory.current, now);
    for (const job of shown) memory.current.shown.add(job.id);
    const row = job => {
      const label = String(job.label || job.kind || job.id).split('\n')[0];
      return h('li', { key: job.id, className: 'dpt-job', 'data-state': job.status },
        h('span', { className: 'dpt-agent-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'dpt-agent-name', title: job.label || label }, label),
        h('span', { className: 'dpt-agent-duration' }, t(JOB_STATUS.get(job.status))));
    };
    const title = t('jobsTitle');
    const counts = [live.length ? tf(t, 'jobsRunningCount', { count: live.length }) : '', settled.length ? tf(t, 'jobsDoneCount', { count: settled.length }) : '']
      .filter(Boolean).join(' · ');
    const visible = shown.slice(0, JOB_ROWS);
    return h('section', { className: 'dpt-side-section dpt-side-jobs', 'aria-label': title, 'data-compact': visible.length || open ? undefined : '' },
      h('div', { className: 'dpt-side-label' }, h('span', null, title),
        h('span', { className: 'dpt-side-tail' },
          failed ? h('span', { className: 'dpt-side-hint', 'data-tone': 'warn' }, tf(t, 'jobsFailedCount', { count: failed })) : null,
          settled.length ? h('button', { type: 'button', className: 'dpt-link dpt-side-count', 'aria-expanded': open, title: t(open ? 'jobsHideRecent' : 'jobsShowRecent'),
            onClick: () => setOpen(!open) }, counts)
            : h('span', { className: 'dpt-side-hint', title: counts ? undefined : t('jobsEmpty') }, counts || t('sideNone')))),
      visible.length ? h('ul', { className: 'dpt-jobs-list' }, ...visible.map(row),
        shown.length > visible.length ? h('li', { className: 'dpt-jobs-more' }, tf(t, 'jobsMore', { count: shown.length - visible.length })) : null) : null,
      open && recent.length ? h('ul', { className: 'dpt-jobs-list dpt-jobs-recent', 'aria-label': t('jobsShowRecent') }, ...recent.slice(0, 6).map(row)) : null);
  }

  // Desktop RCs expose the jobs roster through a dedicated service. Other hosts include it in sessions.
  function LiveBackgroundJobs({ sessionId, useJobs, watchJobs, t }) {
    const jobs = useJobs(state => state.rows[sessionId]);
    React.useEffect(() => watchJobs(sessionId), [sessionId, watchJobs]);
    return h(BackgroundJobs, { jobs, t });
  }
  // Output files: newest first, at most three positions, and overflow takes one of them.
  const OUTPUT_PREVIEW_LIMIT = 3;
  const fileName = path => String(path).split(/[\\/]/u).filter(Boolean).at(-1) ?? String(path);

  function openOutputFile(sessionId, path) {
    // Use the same session-scoped resource address as the host's deliverable cards.
    const segment = value => encodeURIComponent(value).replace(/%3A/giu, ':');
    const normalized = path.replace(/\\/gu, '/').replace(/^(?:\.\/)+/u, '');
    const address = `dsh-resource://file/session/${segment(sessionId)}/${normalized.split('/').map(segment).join('/')}`;
    const sidebar = hostCtx?.get?.('sidebarRight');
    if (typeof sidebar?.openResourceIn === 'function') return sidebar.openResourceIn(sessionId, address);
    if (typeof sidebar?.openResource === 'function') return sidebar.openResource(address);
    throw new Error('File preview is unavailable');
  }

  function OutputsSection({ sessionId, outputs, t }) {
    const [failed, setFailed] = React.useState(false);
    React.useEffect(() => setFailed(false), [sessionId]);
    async function open(path) {
      setFailed(false);
      try { await openOutputFile(sessionId, path); } catch { setFailed(true); }
    }
    const rows = Array.isArray(outputs) ? outputs : [];
    const overflow = rows.length > OUTPUT_PREVIEW_LIMIT;
    const visible = rows.slice(0, overflow ? OUTPUT_PREVIEW_LIMIT - 1 : OUTPUT_PREVIEW_LIMIT);
    const hidden = overflow ? rows.slice(visible.length) : [];
    const row = item => h('li', { key: item.path },
      h('button', { type: 'button', className: 'dpt-file dpt-file-open', 'data-kind': item.kind, title: item.path,
        onClick: () => { void open(item.path); } },
      h('span', { className: 'dpt-file-name' }, fileName(item.path)),
      h('span', { className: 'dpt-file-meta' }, item.kind === 'presented' ? t('outputPresented') : tf(t, 'outputTurn', { turn: item.turn }))));
    const title = t('outputsTitle');
    return h('section', { className: 'dpt-side-section dpt-side-files', 'aria-label': title, 'data-compact': rows.length || failed ? undefined : '' },
      h('div', { className: 'dpt-side-label' }, h('span', null, title),
        h('span', { className: 'dpt-side-hint', title: rows.length ? undefined : t('outputsEmpty') }, rows.length ? String(rows.length) : t('sideNone'))),
      rows.length ? h('ul', { className: 'dpt-files' }, ...visible.map(row),
        hidden.length ? h('li', { className: 'dpt-files-more' },
          h('details', null, h('summary', null, tf(t, 'outputsMore', { count: hidden.length })),
            h('ul', { className: 'dpt-files' }, ...hidden.map(row)))) : null) : null,
      failed ? h('p', { className: 'dpt-side-note', role: 'status' }, t('outputOpenFailed')) : null);
  }

  // SSH: the configured host aliases and the hosts this conversation reached, most recent first.
  function SshSection({ form, ssh, t }) {
    const settings = useSettingsForm(form);
    const [copyStatus, setCopyStatus] = React.useState();
    const configured = settings.status === 'ready' && Array.isArray(settings.value?.sshHosts) ? settings.value.sshHosts : [];
    const client = settings.status === 'ready' ? settings.value?.sshClient : undefined;
    const used = Array.isArray(ssh) ? ssh : [];
    const names = new Set(used.map(row => row.host));
    const rows = [...used.map(row => ({ host: row.host, used: row, config: configured.find(item => item.alias === row.host) })),
      ...configured.filter(item => !names.has(item.alias)).map(item => ({ host: item.alias, config: item }))];
    const endpoint = config => config ? [config.user ? `${config.user}@` : '', config.hostName || '', config.port && config.port !== '22' ? `:${config.port}` : ''].join('') : '';
    async function copyHost(item, go) {
      const config = item.config;
      let text;
      if (go) {
        text = tf(t, 'sshGoDetails', { host: config?.hostName || item.host, port: config?.port || '22',
          user: config?.user || t('sshUserNeeded'), alias: item.host });
      } else {
        const value = settings.value;
        const powershell = effectiveEnvironment(value?.environment ?? 'auto', value?.hostPlatform) === 'powershell';
        const quoteEscape = powershell ? "''" : "'\\''";
        const host = "'" + item.host.replaceAll("'", quoteEscape) + "'";
        text = `ssh -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -- ${host} hostname`;
      }
      try {
        await navigator.clipboard.writeText(text);
        setCopyStatus('sshCopied');
      } catch { setCopyStatus('sshCopyFailed'); }
    }
    const title = t('sshTitle');
    return h('section', { className: 'dpt-side-section dpt-side-ssh', 'aria-label': title, 'data-compact': rows.length || copyStatus ? undefined : '' },
      h('div', { className: 'dpt-side-label' }, h('span', null, title),
        h('span', { className: 'dpt-side-hint', 'data-tone': client === '' ? 'warn' : undefined, title: client === '' ? undefined : rows.length ? t('sshHint') : t('sshEmpty') },
          client === '' ? t('sshNoClient') : rows.length ? t('sshHint') : t('sshNone'))),
      rows.length ? h('ul', { className: 'dpt-files' }, ...rows.slice(0, 8).map(item => h('li', { key: item.host },
        h('div', { className: 'dpt-file dpt-host',
        'data-state': item.used ? (item.used.ok ? 'ok' : 'failed') : 'idle', title: endpoint(item.config) || item.host },
        h('span', { className: 'dpt-agent-dot', 'aria-hidden': 'true' }),
        h('span', { className: 'dpt-file-name' }, item.host),
        h('span', { className: 'dpt-file-meta' }, item.used
          ? tf(t, item.used.ok ? 'sshUsed' : 'sshFailed', { count: item.used.count, turn: item.used.turn })
          : endpoint(item.config) || t('sshConfigured'))),
        h('div', { className: 'dpt-ssh-actions' },
          h('button', { type: 'button', className: 'dpt-link', onClick: () => { void copyHost(item, false); } }, t('sshCopy')),
          h('button', { type: 'button', className: 'dpt-link', onClick: () => { void copyHost(item, true); } }, t('sshGoCopy')))))) : null,
      copyStatus ? h('p', { className: 'dpt-side-note', role: 'status' }, t(copyStatus)) : null);
  }

  function projectionValue(useProjection, key) {
    try { return typeof useProjection === 'function' ? useProjection(key) : undefined; } catch { return undefined; }
  }

  // Switch this conversation to one of its view tabs (对话 / 轨迹 / 统计 / 特点卡片) by its label.
  // The host renders the tabs as role="tab" buttons; clicking one goes through its own selection.
  // Plugin views can instead sit in the host's "more views" menu beside the tab row (a portaled
  // role="menu" of role="menuitem" buttons): open it, pick the item, and close it again on a miss.
  // Resolves whether a view was selected.
  async function openConversationTab(sessionId, matches) {
    if (typeof document === 'undefined') return false;
    const root = SESSIONS.map.get(sessionId)?.el?.closest?.('[data-slot="main.conversation"]') ?? document;
    const tabs = [...root.querySelectorAll('[data-conversation-tabs] [role="tab"]')];
    const tab = tabs.find(matches);
    if (tab) { tab.click(); return true; }
    const more = root.querySelector('[data-conversation-tabs]')?.parentElement?.querySelector?.('button[aria-haspopup="menu"]');
    if (!more) return false;
    if (more.getAttribute('aria-expanded') !== 'true') more.click();
    for (let attempt = 0; attempt < 10; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 30));
      const item = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].find(node => matches(node, -1));
      if (item) { item.click(); return true; }
    }
    if (more.getAttribute('aria-expanded') === 'true') more.click();
    return false;
  }

  // Deep creative mode in one place: the switch, and the virtual DSH with a status card the panel
  // keeps current by itself (lib/virtual-dsh.mjs). Nothing here reaches the chat or the model.
  function CreativeSection({ form, runVirtual, useProjection, t }) {
    const state = useSettingsForm(form);
    const [message, setMessage] = React.useState(null);
    if (!form || state.status === 'unavailable') return null;
    const on = state.value?.pluginLab === true;
    const disabled = !state.writable || state.status !== 'ready';
    async function toggle(next) {
      setMessage(null);
      try { if (!await form.mutate([{ op: 'set', path: ['pluginLab'], value: next }], form.getSnapshot().revision)) throw new Error('rejected'); }
      catch { setMessage(t('envFailed')); }
    }
    return h('section', { className: 'dpt-side-section dpt-side-creative', 'aria-label': t('creativeSwitch') },
      h('div', { className: 'dpt-side-label' }, h('span', { title: t('creativeHint') }, t('creativeSwitch')),
        h(SkillSwitch, { on, label: t('creativeSwitch'), disabled, onChange: next => { void toggle(next); } })),
      message ? h('p', { className: 'dpt-side-note', role: 'alert' }, message) : null,
      on && typeof runVirtual === 'function' ? h(VirtualDshCard, { runVirtual, useProjection, t }) : null);
  }

  const VIRTUAL_BUSY = ['preparing', 'installing', 'adding package', 'starting', 'restarting', 'stopping'];
  const VIRTUAL_STEPS = ['preparing', 'installing', 'adding package', 'starting', 'running'];
  function VirtualDshCard({ runVirtual, useProjection, t }) {
    // The server pushes every change through this projection, whoever started the virtual DSH; the
    // command answer only fills in until the first push arrives.
    const pushed = projectionValue(useProjection, 'deepPtcVirtual')?.status;
    const [answered, setStatus] = React.useState({ state: 'unknown' });
    const status = pushed && pushed.state !== 'unknown' ? pushed : answered;
    const [pending, setPending] = React.useState(false);
    const wantOpen = React.useRef(false);
    const call = React.useCallback(async payload => {
      let result;
      try { result = await runVirtual(payload); } catch (error) { setStatus({ state: 'failed', error: String(error?.message ?? error) }); return; }
      const text = (result?.value?.result ?? result?.value)?.text;
      if (commandCode(text) === 'virtual') { try { setStatus(JSON.parse(stripCode(text))); return; } catch { /* below */ } }
      setStatus({ state: 'failed', error: commandError(result, t) ?? stripCode(text) });
    }, [runVirtual, t]);
    // One status call subscribes this conversation; later changes arrive as pushes.
    React.useEffect(() => { void call({ op: 'status' }); }, [call]);
    const open = React.useCallback(() => {
      if (!status.url) return;
      try { hostCtx?.get?.('sidebarRight')?.openTab('browser', { params: { url: status.url } }); }
      catch (error) { console.warn(`[${PLUGIN}] virtual DSH did not open:`, error); }
    }, [status.url]);
    // A start from this card opens the sidebar once the virtual DSH is ready.
    React.useEffect(() => { if (status.state === 'running' && wantOpen.current) { wantOpen.current = false; open(); } }, [status.state, open]);
    const act = async payload => { setPending(true); try { await call(payload); } finally { setPending(false); } };
    const state = status.state ?? 'unknown';
    const running = state === 'running';
    const busy = pending || VIRTUAL_BUSY.includes(state);
    const steps = VIRTUAL_STEPS.filter(step => step !== 'adding package' || status.package);
    const at = steps.indexOf(state === 'restarting' ? 'starting' : state);
    const added = Array.isArray(status.added) ? status.added : [];
    const name = typeof status.package === 'string' ? status.package.split(/[\\/]/u).pop() : '';
    return h('div', { className: 'dpt-virtual', 'data-state': state, 'aria-label': t('virtualTitle') },
      h('div', { className: 'dpt-virtual-head' },
        h('span', { className: 'dpt-virtual-dot', 'data-state': state, 'aria-hidden': 'true' }),
        h('span', { className: 'dpt-virtual-title', title: t('virtualHint') }, t('virtualTitle')),
        h('span', { className: 'dpt-virtual-badge', 'data-state': state, role: 'status' }, t('virtualState_' + state))),
      !running && (at >= 0 || state === 'restarting') ? h('ol', { className: 'dpt-virtual-steps' }, ...steps.map((step, index) =>
        h('li', { key: step, 'data-step': index < at ? 'done' : index === at ? 'active' : 'todo' }, t('virtualStep_' + step)))) : null,
      name || added.length ? h('p', { className: 'dpt-side-note' }, [name ? tf(t, 'virtualTesting', { name }) : '',
        added.length ? tf(t, 'virtualAdded', { names: added.map(row => row.name).join('、') }) : ''].filter(Boolean).join(' · ')) : null,
      state === 'failed' && status.error ? h('p', { className: 'dpt-virtual-error', role: 'alert' }, String(status.error).slice(0, 300)) : null,
      h('div', { className: 'dpt-side-buttons' },
        running ? h('button', { type: 'button', className: 'dpt-btn', 'data-primary': '', onClick: open }, t('virtualOpen'))
          : h('button', { type: 'button', className: 'dpt-btn', disabled: busy, title: t('virtualHint'), onClick: () => { wantOpen.current = true; void act({ op: 'start' }); } }, t('virtualStart')),
        running || (busy && state !== 'stopping') ? h('button', { type: 'button', className: 'dpt-btn', disabled: pending || state === 'stopping',
          onClick: () => { wantOpen.current = false; void act({ op: 'stop' }); } }, t('virtualStop')) : null));
  }

  // Project cards from the panel: open the editor (the model is not involved), or ask the model to
  // guide setup in the main conversation (first setup or further setup; it asks with question cards).
  function ProjectSection({ sessionId, useProjection, reply, runProject, form, t }) {
    const enabled = useFormValue(form, 'projectCards') !== false;
    const project = projectionValue(useProjection, 'deepPtcProject');
    const [note, setNote] = React.useState();
    if (!enabled) return null;
    const cards = Array.isArray(project?.cards) ? project.cards : [];
    const settings = cards.filter(card => card.kind === 'setting').length;
    const pending = Array.isArray(project?.proposals) ? project.proposals.length : 0;
    const status = cards.length === 0 ? t('projectPanelNone') : tf(t, 'projectPanelCount', { count: settings, records: cards.length - settings });
    const openEditor = () => {
      setNote(undefined);
      void openConversationTab(sessionId, tab => tab.textContent.trim() === t('projectTab'))
        .then(opened => { if (!opened) setNote(t('projectPanelNoTab')); });
    };
    const guide = async () => {
      setNote(undefined);
      // The server tells the model in its structured form; an older server leaves it to this text.
      const asked = typeof runProject === 'function' ? await runProject({ op: 'ask', kind: cards.length === 0 ? 'guide-first' : 'guide-more' }).catch(() => undefined) : undefined;
      const notified = commandCode((asked?.value?.result ?? asked?.value)?.text) === 'notified';
      const sent = notified || (typeof reply === 'function' ? await reply(t(cards.length === 0 ? 'projectMsgGuideFirst' : 'projectMsgGuideMore')) : false);
      if (sent === false) { setNote(t('cardReplyFailed')); return; }
      // The guidance happens in the main conversation: show it there.
      openConversationTab(sessionId, (tab, index) => index === 0);
      setNote(t('projectPanelGuideSent'));
    };
    return h('section', { className: 'dpt-side-section dpt-side-project', 'aria-label': t('projectTab') },
      h('div', { className: 'dpt-side-label' }, h('span', null, t('projectTab')),
        h('span', { className: 'dpt-side-hint', 'data-tone': pending > 0 ? 'warn' : undefined, title: status },
          pending > 0 ? tf(t, 'projectPanelPending', { count: pending }) : cards.length === 0 ? t('sideNone') : status)),
      h('div', { className: 'dpt-side-buttons' },
        h('button', { type: 'button', className: 'dpt-btn', title: t('projectPanelEditHint'), onClick: openEditor }, t('projectPanelEdit')),
        h('button', { type: 'button', className: 'dpt-btn', title: t('projectPanelGuideHint'), onClick: () => { void guide(); } },
          t(cards.length === 0 ? 'projectPanelGuideFirst' : 'projectPanelGuideMore'))),
      note ? h('p', { className: 'dpt-side-note', role: 'status' }, note) : null);
  }

  // One conversation's environment, subagents, jobs, outputs, SSH and tool state.
  // Deep sleep mode: one switch, and the state the host folds from the session log. Turning it on
  // only arms the mode; the model asks the batch and the user's confirmation starts the run.
  function DeepSleepSection({ sessionId, useProjection, runSleep, t }) {
    const state = projectionValue(useProjection, 'deepPtcSleep');
    const [busy, setBusy] = React.useState(false);
    const [message, setMessage] = React.useState();
    const on = state?.on === true;
    const phase = on ? state.phase : 'off';
    async function toggle() {
      if (typeof runSleep !== 'function') return;
      setBusy(true);
      setMessage(undefined);
      try {
        const outcome = await runSleep({ action: 'toggle' });
        if (outcome?.ok === false) throw new Error(outcome.error?.message);
        const reply = outcome?.ok === true ? outcome.value : outcome;
        const result = reply?.result ?? reply;
        if (result?.kind === 'error') throw new Error(result.text);
      } catch (error) {
        setMessage(String(error?.message ?? error).slice(0, 180));
      } finally {
        setBusy(false);
      }
    }
    const facts = on ? [
      Array.isArray(state?.cards) && state.cards.length > 0 ? tf(t, 'sleepCards', { done: state.answered ?? 0, total: state.cards.length }) : '',
      state?.objective ? `${t('sleepObjective')}：${state.objective}` : '',
      state?.rounds > 0 ? tf(t, 'sleepRound', { round: state.rounds }) : '',
    ].filter(Boolean).join(' · ') : '';
    return h('section', { className: 'dpt-side-section dpt-side-sleep', 'aria-label': t('sleepSection'), 'data-on': on ? '' : undefined },
      h('div', { className: 'dpt-side-label' }, h('span', null, t('sleepSection')),
        h('span', { className: 'dpt-side-tail' },
          h('span', { className: 'dpt-side-hint', 'data-tone': on ? 'ok' : undefined }, t(`sleepPhase_${phase}`)),
          h('button', { type: 'button', className: 'dpt-link', onClick: toggle, disabled: busy || typeof runSleep !== 'function',
            'aria-pressed': on, title: on ? t('sleepOff') : t('sleepOn') }, busy ? t('sleepBusy') : on ? t('sleepOff') : t('sleepOn')))),
      h('p', { className: 'dpt-side-note' }, facts || (on ? t('sleepHintOn') : t('sleepHintOff'))),
      message ? h('p', { className: 'dpt-side-note', role: 'alert', 'data-tone': 'error' }, message) : null);
  }

  function DeepPtcPanel({ sessionId, useSessions, useProjection, useJobs, watchJobs, reset, reply, runProject, runVirtual, runSleep, form, inline, t }) {
    const sessions = typeof useSessions === 'function' ? useSessions(state => state) : undefined;
    const preset = projectionValue(useProjection, 'agentPreset');
    const activity = projectionValue(useProjection, 'deepPtcActivity');
    const [now, setNow] = React.useState(() => Date.now());
    const deep = preset === 'deep-ptc';
    const rows = deep ? subagentRows(sessions, sessionId, now) : [];
    const running = rows.filter(row => row.state === 'running').length;
    React.useEffect(() => {
      if (running === 0) return undefined;
      const timer = setInterval(() => setNow(Date.now()), 1000);
      return () => clearInterval(timer);
    }, [running > 0]);
    const stateText = row => row.state === 'running' ? t('agentRunning') : row.state === 'completed' ? t('agentCompleted') : row.state === 'external' ? t('agentExternal') : t('agentIdle');
    return h('div', { className: 'dpt-panel', 'data-inline': inline ? '' : undefined, 'aria-label': t('sideTitle') },
      h('div', { className: 'dpt-side-body' },
        !deep ? h('section', { className: 'dpt-side-section' }, h('p', { className: 'dpt-side-note' }, t('sideOtherMode'))) : null,
        h(SortableSections, { t, sections: [
        { key: 'environment', label: t('environment'), node: form ? h(EnvironmentSection, { form, t }) : null },
        { key: 'sleep', label: t('sleepSection'), node: deep && formValue(form, 'deepSleep') !== false && typeof runSleep === 'function'
          ? h(DeepSleepSection, { sessionId, useProjection, runSleep, t }) : null },
        { key: 'creative', label: t('creativeSwitch'), node: deep && form ? h(CreativeSection, { form, runVirtual, useProjection, t }) : null },
        { key: 'project', label: t('projectTab'), node: deep && formValue(form, 'projectCards') !== false ? h(ProjectSection, { sessionId, useProjection, reply, runProject, form, t }) : null },
        // Always present in Deep PTC, one line while empty: a first subagent fills the section instead
        // of inserting it and pushing the sections below down.
        { key: 'agents', label: t('agentsTitle'), node: deep ? h('section', { className: 'dpt-side-section dpt-side-agents', 'aria-label': t('agentsTitle'), 'data-compact': rows.length ? undefined : '' },
          h('div', { className: 'dpt-side-label' }, h('span', null, t('agentsTitle')),
            h('span', { className: 'dpt-side-hint' }, rows.length === 0 ? t('sideNone')
              : [running ? tf(t, 'jobsRunningCount', { count: running }) : '', tf(t, 'agentsCount', { count: rows.length })].filter(Boolean).join(' · '))),
          rows.length ? h('ol', { className: 'dpt-agents-list' }, ...rows.map(row =>
            h('li', { key: row.id }, h('button', { type: 'button', className: 'dpt-agent', 'data-state': row.state,
              'aria-label': `${row.label} · ${stateText(row)}`, style: { '--dpt-depth': row.depth },
              disabled: row.state === 'external', title: t('agentOpen'), onClick: () => openSubagent(row) },
              h('span', { className: 'dpt-agent-dot', 'aria-hidden': 'true' }),
              h('span', { className: 'dpt-agent-name', title: row.label }, row.label),
              row.duration !== undefined ? h('span', { className: 'dpt-agent-duration' }, formatDuration(row.duration, t)) : null)))) : null) : null },
        { key: 'jobs', label: t('jobsTitle'), node: deep ? (typeof useJobs === 'function' && typeof watchJobs === 'function'
          ? h(LiveBackgroundJobs, { key: `jobs:${sessionId}`, sessionId, useJobs, watchJobs, t })
          : h(BackgroundJobs, { key: `jobs:${sessionId}`, jobs: sessions?.jobsBySession?.[sessionId], t })) : null },
        { key: 'outputs', label: t('outputsTitle'), node: deep ? h(OutputsSection, { sessionId, outputs: activity?.outputs, t }) : null },
        { key: 'ssh', label: t('sshTitle'), node: h(SshSection, { form, ssh: deep ? activity?.ssh : undefined, t }) },
        { key: 'tools', label: t('toolsSection'), node: deep && typeof reset === 'function' ? h(ToolStateControls, { sessionId, useProjection, reset, t }) : null },
        ] })));
  }

  const PANEL_WIDTH = 280;
  const PANEL_MIN_WIDTH = 240;
  const PANEL_MAX_WIDTH = 640;
  const PANEL_MIN_ROOM = 820;
  // A docked panel never squeezes the conversation below this width.
  const CHAT_MIN_WIDTH = 540;
  const PANEL_COLLAPSED_KEY = `${PLUGIN}:side-panel-collapsed`;
  const PANEL_WIDTH_KEY = `${PLUGIN}:side-panel-width`;
  const CAPSULE_KEY = `${PLUGIN}:capsule-placement`;
  const PLACEMENTS = ['auto', 'dock', 'toolbar', 'hidden'];
  // Where the panel itself opens: beside the conversation, or as a right-sidebar page (the host's own
  // sidebar, or dsh-better-sidebar's when that plugin is installed).
  const LOCATION_KEY = `${PLUGIN}:panel-location`;
  const LOCATIONS = ['beside', 'sidebar'];
  const BETTER_TAB = 'deep-ptc:panel';
  // dsh-better-sidebar's service, while that plugin is loaded.
  const BETTER = { service: undefined };
  const readStored = key => { try { return localStorage.getItem(key); } catch { return null; } };
  const writeStored = (key, value) => { try { localStorage.setItem(key, value); } catch { /* kept in memory */ } };

  // The order of the side panel's sections, chosen by dragging their handles; kept per browser.
  const SECTION_ORDER_KEY = `${PLUGIN}:panel-order`;
  const SECTION_KEYS = ['environment', 'sleep', 'creative', 'project', 'agents', 'jobs', 'outputs', 'ssh', 'tools'];
  function normalizeOrder(value) {
    const known = Array.isArray(value) ? value.filter((key, index) => SECTION_KEYS.includes(key) && value.indexOf(key) === index) : [];
    return [...known, ...SECTION_KEYS.filter(key => !known.includes(key))];
  }
  const SECTION_ORDER = {
    value: undefined, subs: new Set(),
    get() {
      if (this.value === undefined) {
        try { this.value = normalizeOrder(JSON.parse(readStored(SECTION_ORDER_KEY) ?? '[]')); } catch { this.value = [...SECTION_KEYS]; }
      }
      return this.value;
    },
    set(next) { this.value = normalizeOrder(next); writeStored(SECTION_ORDER_KEY, JSON.stringify(this.value)); for (const listener of this.subs) listener(); },
    subscribe(listener) { this.subs.add(listener); return () => this.subs.delete(listener); },
  };
  // Move one section before another (or to the end), keeping hidden sections where they were.
  function moveSection(order, key, before) {
    const rest = order.filter(item => item !== key);
    const index = before === undefined ? rest.length : rest.indexOf(before);
    const at = index < 0 ? rest.length : index;
    return [...rest.slice(0, at), key, ...rest.slice(at)];
  }
  const GripIcon = () => h('svg', { width: 10, height: 14, viewBox: '0 0 10 14', 'aria-hidden': 'true' },
    ...[2, 7, 12].flatMap(y => [h('circle', { key: `a${y}`, cx: 3, cy: y, r: 1.1, fill: 'currentColor' }), h('circle', { key: `b${y}`, cx: 7, cy: y, r: 1.1, fill: 'currentColor' })]));

  function SortableSections({ sections, t }) {
    const order = React.useSyncExternalStore(listener => SECTION_ORDER.subscribe(listener), () => SECTION_ORDER.get(), () => SECTION_ORDER.get());
    const [dragging, setDragging] = React.useState();
    const [drop, setDrop] = React.useState();
    const visible = sections.filter(section => section.node).sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
    const after = key => visible[visible.findIndex(section => section.key === key) + 1]?.key;
    const shift = (key, step) => {
      const index = visible.findIndex(section => section.key === key);
      if (visible[index + step] === undefined) return;
      // Up: before the previous section. Down: before the section after the next one (or last).
      SECTION_ORDER.set(moveSection(order, key, step < 0 ? visible[index - 1].key : visible[index + 2]?.key));
    };
    // Pointer dragging: the handle captures the pointer, the section under it becomes the drop
    // target, and its upper or lower half decides whether the dragged one lands before or after it.
    const locate = event => {
      const found = typeof document !== 'undefined' ? document.elementFromPoint?.(event.clientX, event.clientY)?.closest?.('.dpt-sortable') : undefined;
      const key = found?.getAttribute?.('data-key');
      if (!key) return undefined;
      const box = found.getBoundingClientRect?.();
      const lower = box ? event.clientY > box.top + box.height / 2 : false;
      return { key, side: lower ? 'after' : 'before' };
    };
    const finish = () => { setDragging(undefined); setDrop(undefined); };
    return h(React.Fragment, null, ...visible.map((section, index) => h('div', { key: section.key, className: 'dpt-sortable', 'data-key': section.key,
      'data-dragging': dragging === section.key ? '' : undefined,
      'data-drop': drop?.key === section.key && dragging !== section.key ? drop.side : undefined },
      h('button', { type: 'button', className: 'dpt-grip', 'aria-label': tf(t, 'panelMove', { name: section.label }), title: t('panelMoveHint'),
        onPointerDown: event => {
          if (event.button !== undefined && event.button !== 0) return;
          event.preventDefault?.();
          try { event.currentTarget?.setPointerCapture?.(event.pointerId); } catch { /* the drag still follows the pointer */ }
          setDragging(section.key);
        },
        onPointerMove: event => {
          if (dragging !== section.key) return;
          const next = locate(event);
          if (next?.key !== drop?.key || next?.side !== drop?.side) setDrop(next);
        },
        onPointerUp: event => {
          if (dragging !== section.key) return;
          const target = locate(event) ?? drop;
          if (target && target.key !== section.key) {
            SECTION_ORDER.set(moveSection(order, section.key, target.side === 'after' ? after(target.key) : target.key));
          }
          finish();
        },
        onPointerCancel: finish,
        onKeyDown: event => {
          if (event.key === 'ArrowUp' && index > 0) { event.preventDefault(); shift(section.key, -1); }
          else if (event.key === 'ArrowDown' && index < visible.length - 1) { event.preventDefault(); shift(section.key, 1); }
        } }, h(GripIcon)),
      section.node)));
  }
  const readPanelWidth = () => {
    const value = Number(readStored(PANEL_WIDTH_KEY));
    return Number.isFinite(value) && value > 0 ? Math.round(value) : PANEL_WIDTH;
  };
  const readPlacement = () => { const value = readStored(CAPSULE_KEY); return PLACEMENTS.includes(value) ? value : 'auto'; };
  const readLocation = () => { const value = readStored(LOCATION_KEY); return LOCATIONS.includes(value) ? value : 'beside'; };

  // Viewer preferences (collapsed, width, capsule placement) and each conversation's open state, shared
  // by the panel host in the composer dock, the capsule wherever it sits, and the right-sidebar tab.
  const PANEL = {
    collapsed: readStored(PANEL_COLLAPSED_KEY) === '1',
    width: readPanelWidth(),
    placement: readPlacement(),
    location: readLocation(),
    // Each mounted conversation's panel props (a ref), so a sidebar page can draw the same panel.
    hosts: new Map(),
    peek: new Map(), wide: new Map(), version: 0, subs: new Set(),
    subscribe(listener) { this.subs.add(listener); return () => this.subs.delete(listener); },
    emit() { this.version++; for (const listener of [...this.subs]) { try { listener(); } catch (error) { console.warn(`[${PLUGIN}]`, error); } } },
    isOpen(id) { return (this.wide.get(id) === true && !this.collapsed) || this.peek.get(id) === true; },
    // A layout change (docked, floating, covered) closes a floating peek, as before.
    setWide(id, wide) {
      if (this.wide.get(id) === wide) return;
      if (wide === undefined) this.wide.delete(id); else this.wide.set(id, wide);
      this.peek.delete(id);
      this.emit();
    },
    setCollapsed(value) { this.collapsed = value; writeStored(PANEL_COLLAPSED_KEY, value ? '1' : '0'); },
    toggle(id) {
      if (this.wide.get(id)) this.setCollapsed(!this.collapsed);
      else this.peek.set(id, this.peek.get(id) !== true);
      this.emit();
    },
    open(id) {
      if (id === undefined) return;
      if (this.wide.get(id)) this.setCollapsed(false); else this.peek.set(id, true);
      this.emit();
    },
    setWidth(width, persist) {
      const next = Math.round(width);
      if (Number.isFinite(next) && next > 0 && next !== this.width) { this.width = next; this.emit(); }
      if (persist) writeStored(PANEL_WIDTH_KEY, String(this.width));
    },
    setPlacement(value) {
      if (!PLACEMENTS.includes(value) || value === this.placement) return;
      this.placement = value;
      writeStored(CAPSULE_KEY, value);
      this.emit();
    },
    setLocation(value) {
      if (!LOCATIONS.includes(value) || value === this.location) return;
      this.location = value;
      writeStored(LOCATION_KEY, value);
      this.emit();
    },
    // The capsule: in the sidebar location it opens the sidebar page; beside the conversation (or when
    // no sidebar can open) it shows or hides the panel there.
    activate(id) {
      if (this.location === 'sidebar' && openInSidebar(id)) return;
      this.toggle(id);
    },
    // Another window changed a preference.
    sync(event) {
      if (event.key !== null && ![PANEL_COLLAPSED_KEY, PANEL_WIDTH_KEY, CAPSULE_KEY, LOCATION_KEY].includes(event.key)) return;
      this.collapsed = readStored(PANEL_COLLAPSED_KEY) === '1';
      this.width = readPanelWidth();
      this.placement = readPlacement();
      this.location = readLocation();
      this.emit();
    },
  };
  // Open the Deep PTC page in the right sidebar: dsh-better-sidebar's page when it is loaded, the
  // host's own tab otherwise. False when neither can open, so the caller falls back to the panel.
  function openInSidebar(sessionId) {
    try {
      if (typeof BETTER.service?.openTab === 'function') {
        BETTER.service.openTab({ type: BETTER_TAB }, sessionId === undefined ? undefined : { sessionId });
        return true;
      }
      const sidebar = hostCtx?.get?.('sidebarRight');
      if (typeof sidebar?.openTab === 'function') { sidebar.openTab(TAB_KIND, { revealIfOpened: true }); return true; }
    } catch (error) { console.warn(`[${PLUGIN}] sidebar page did not open:`, error); }
    return false;
  }
  const getPanelVersion = () => PANEL.version;
  const subscribePanel = listener => PANEL.subscribe(listener);
  function usePanel() {
    React.useSyncExternalStore(subscribePanel, getPanelVersion, getPanelVersion);
    return PANEL;
  }

  // dsh-claude-style folds the composer into one row, which leaves no room for a row of our own below it.
  const compactComposer = () => typeof document !== 'undefined'
    && (document.body?.hasAttribute?.('data-dsh-claude-style') === true || appearancePlugin() === 'dsh-claude-style');
  function subscribeCompact(listener) {
    if (typeof MutationObserver !== 'function' || typeof document === 'undefined' || !document.body) return () => {};
    const observer = new MutationObserver(listener);
    try {
      observer.observe(document.body, { attributes: true, attributeFilter: ['data-dsh-claude-style'] });
      if (document.head) observer.observe(document.head, { childList: true });
    } catch { /* detection stays as first read */ }
    return () => observer.disconnect();
  }
  const useCompactComposer = () => React.useSyncExternalStore(subscribeCompact, compactComposer, compactComposer);
  const resolvePlacement = compact => PANEL.placement === 'auto' ? (compact ? 'toolbar' : 'dock') : PANEL.placement;

  // Floating widgets pinned to the window's bottom-right corner (the dsh-whale-widget whale) cover the
  // bottom of the panel; the panel body reserves that height so its last controls scroll clear of it.
  const CORNER_FLOATERS = '.dshwv-root .dshwv-img';
  function cornerInset(box) {
    if (typeof document === 'undefined') return 0;
    let inset = 0;
    for (const node of document.querySelectorAll?.(CORNER_FLOATERS) ?? []) {
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      const overlaps = rect.left < box.right && rect.right > box.left && rect.top < box.bottom && rect.bottom > box.top;
      if (overlaps) inset = Math.max(inset, box.bottom - rect.top);
    }
    // Never more than half the panel: the panel stays usable under a widget scaled up very large.
    return Math.round(Math.min(inset, (box.bottom - box.top) / 2));
  }

  // Measure the conversation itself, so the panel follows native sidebar resizing and is hidden
  // when that conversation is covered by a fullscreen sidebar.
  function useSidePanelLayout(sessionId, marker) {
    const [layout, setLayout] = React.useState();
    React.useEffect(() => {
      if (typeof document === 'undefined' || typeof ReactDOM?.createPortal !== 'function') return undefined;
      let frame;
      let previous;
      const watched = new Set();
      const resize = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : undefined;
      function measure() {
        frame = undefined;
        const region = marker.current?.closest?.('[data-conversation-region="chat"]')
          ?? [...document.querySelectorAll('[data-conversation-region="chat"]')]
            .find(node => node.getAttribute('data-conversation-session') === sessionId);
        const rect = region?.getBoundingClientRect();
        const room = region?.parentElement?.getBoundingClientRect() ?? rect;
        const fullscreen = [...document.querySelectorAll('[data-sidebar-right-panel="fullscreen"][data-sidebar-right-open]')]
          .some(node => node.getClientRects().length > 0);
        if (!rect || rect.width <= 0 || rect.height <= 0 || fullscreen || region.closest('[hidden],[aria-hidden="true"]')) {
          if (previous !== undefined) { previous = undefined; setLayout(undefined); }
          return;
        }
        const targets = [region, region.parentElement].filter(Boolean);
        for (const node of watched) {
          if (!targets.includes(node)) { resize?.unobserve(node); watched.delete(node); }
        }
        for (const node of targets) {
          if (node && !watched.has(node)) { resize?.observe(node); watched.add(node); }
        }
        const wide = room.width >= PANEL_MIN_ROOM;
        const composer = region.querySelector('[data-composer-seat]')?.getBoundingClientRect();
        const fit = Math.max(0, room.width - 24);
        const maxWidth = Math.min(fit, Math.max(PANEL_MIN_WIDTH, Math.min(PANEL_MAX_WIDTH, wide ? room.width - CHAT_MIN_WIDTH : fit)));
        const minWidth = Math.min(PANEL_MIN_WIDTH, maxWidth);
        const next = { region, wide, minWidth, maxWidth, top: Math.round(rect.top), right: Math.round(window.innerWidth - room.right),
          height: Math.round(wide ? rect.height : Math.max(0, Math.min(rect.height, (composer?.top ?? rect.bottom) - rect.top - 8))),
          width: Math.min(maxWidth, Math.max(minWidth, PANEL.width)) };
        const right = window.innerWidth - next.right;
        next.inset = cornerInset({ left: right - next.width, right, top: next.top, bottom: next.top + next.height });
        const same = previous?.region === region
          && ['wide', 'top', 'right', 'height', 'width', 'minWidth', 'maxWidth', 'inset'].every(key => previous[key] === next[key]);
        if (!same) { previous = next; setLayout(next); }
      }
      function schedule() {
        if (frame === undefined) frame = requestAnimationFrame(measure);
      }
      const changes = typeof MutationObserver === 'function' ? new MutationObserver(records => {
        if (!previous?.region?.isConnected || records.some(record => record.type === 'attributes'
          && (record.target.contains(previous?.region) || record.target.matches?.('[data-sidebar-right-panel],.dshwv-root')))) schedule();
      }) : undefined;
      changes?.observe(document.body, { subtree: true, childList: true, attributes: true,
        attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'data-sidebar-right-panel', 'data-sidebar-right-open'] });
      window.addEventListener('resize', schedule);
      // A new preferred width (dragging the edge, another window) is measured like a resize.
      const unsubscribe = PANEL.subscribe(() => { if (previous?.width !== Math.min(previous?.maxWidth ?? Infinity, Math.max(previous?.minWidth ?? 0, PANEL.width))) schedule(); });
      measure();
      return () => {
        unsubscribe();
        resize?.disconnect(); changes?.disconnect();
        window.removeEventListener('resize', schedule);
        if (frame !== undefined) cancelAnimationFrame(frame);
      };
    }, [sessionId, marker]);
    return layout;
  }

  // The capsule's one-line summary: environment, subagents, tool notices.
  function useCapsuleSummary({ sessionId, useSessions, useProjection, form, t }) {
    const sessions = typeof useSessions === 'function' ? useSessions(state => state) : undefined;
    const tools = projectionValue(useProjection, 'deepPtcTools');
    const settings = useSettingsForm(form);
    const rows = subagentRows(sessions, sessionId, Date.now());
    const running = rows.some(row => row.state === 'running');
    const failures = tools && typeof tools === 'object' ? (tools.report?.tools ?? []).length : 0;
    const environment = settings.status === 'ready' && settings.value ? envLabel(settings.value.environment ?? 'auto', t) : undefined;
    const label = [environment, rows.length ? `${t('agentsTitle')} ${rows.length}` : null, failures ? `${t('toolFailures')} ${failures}` : null]
      .filter(Boolean).join(' · ') || t('sideTitle');
    return { label, running };
  }

  // The capsule toggles this conversation's side panel, below the composer or in its toolbar.
  function CapsuleButton(props) {
    const { sessionId, compact, t } = props;
    usePanel();
    const { label, running } = useCapsuleSummary(props);
    return h('button', { type: 'button', className: 'dpt-capsule', 'data-compact': compact ? '' : undefined,
      'data-state': running ? 'running' : 'idle', 'aria-expanded': PANEL.location === 'sidebar' ? undefined : props.open ?? PANEL.isOpen(sessionId),
      title: compact ? `${t('capsuleOpen')} · ${label}` : t('capsuleOpen'), onClick: () => PANEL.activate(sessionId) },
      h('span', { className: 'dpt-agent-dot', 'aria-hidden': 'true' }), h('span', null, label));
  }

  // The panel's left edge. Dragging sets the preferred width (kept per viewer); arrow keys step it,
  // Home and End jump to the bounds, a double click restores the default.
  function ResizeHandle({ layout, t }) {
    const [active, setActive] = React.useState(false);
    const stop = React.useRef();
    React.useEffect(() => () => stop.current?.(), []);
    const clamp = value => Math.min(layout.maxWidth, Math.max(layout.minWidth, value));
    function onPointerDown(event) {
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      const target = event.currentTarget;
      const startX = event.clientX;
      const startWidth = layout.width;
      const move = next => PANEL.setWidth(clamp(startWidth + startX - next.clientX), false);
      const end = () => {
        target.removeEventListener?.('pointermove', move);
        target.removeEventListener?.('pointerup', end);
        target.removeEventListener?.('pointercancel', end);
        document.body?.removeAttribute?.('data-dpt-resizing');
        stop.current = undefined;
        setActive(false);
        PANEL.setWidth(PANEL.width, true);
      };
      try { target.setPointerCapture?.(event.pointerId); } catch { /* the move events still reach the handle */ }
      target.addEventListener?.('pointermove', move);
      target.addEventListener?.('pointerup', end);
      target.addEventListener?.('pointercancel', end);
      document.body?.setAttribute?.('data-dpt-resizing', '');
      stop.current = end;
      setActive(true);
    }
    function onKeyDown(event) {
      const step = event.shiftKey ? 64 : 16;
      const next = event.key === 'ArrowLeft' ? layout.width + step : event.key === 'ArrowRight' ? layout.width - step
        : event.key === 'Home' ? layout.minWidth : event.key === 'End' ? layout.maxWidth : undefined;
      if (next === undefined) return;
      event.preventDefault();
      PANEL.setWidth(clamp(next), true);
    }
    return h('div', { className: 'dpt-resize', role: 'separator', 'aria-orientation': 'vertical', tabIndex: 0,
      'aria-label': t('panelResize'), title: t('panelResize'), 'data-active': active ? '' : undefined,
      'aria-valuenow': layout.width, 'aria-valuemin': layout.minWidth, 'aria-valuemax': layout.maxWidth,
      onPointerDown, onKeyDown, onDoubleClick: () => PANEL.setWidth(clamp(PANEL_WIDTH), true) });
  }

  // Mounted in the composer dock for every Deep PTC conversation, whatever the capsule placement: its
  // marker locates the conversation, and it owns the side panel. When the capsule sits elsewhere the
  // row is display:none, which keeps the marker (and closest()) working without taking a row.
  function PanelHost(props) {
    const { sessionId, useSessions, t } = props;
    const marker = React.useRef(null);
    const layout = useSidePanelLayout(sessionId, marker);
    usePanel();
    const placement = resolvePlacement(useCompactComposer());
    const wide = layout ? layout.wide : undefined;
    React.useEffect(() => PANEL.setWide(sessionId, wide), [sessionId, wide]);
    React.useEffect(() => () => PANEL.setWide(sessionId, undefined), [sessionId]);
    const latest = React.useRef(props);
    latest.current = props;
    React.useEffect(() => {
      PANEL.hosts.set(sessionId, latest);
      PANEL.emit();
      return () => { if (PANEL.hosts.get(sessionId) === latest) { PANEL.hosts.delete(sessionId); PANEL.emit(); } };
    }, [sessionId]);
    // In the sidebar location the panel never docks here; a peek remains the fallback when no sidebar opens.
    const docked = PANEL.location !== 'sidebar' && !!layout?.wide && !PANEL.collapsed;
    const open = docked || PANEL.peek.get(sessionId) === true;
    React.useEffect(() => {
      const region = layout?.region;
      if (!region) return undefined;
      region.toggleAttribute('data-dpt-panel-open', docked);
      region.style.setProperty('--dpt-panel-width', `${layout.width}px`);
      return () => { region.removeAttribute('data-dpt-panel-open'); region.style.removeProperty('--dpt-panel-width'); };
    }, [layout?.region, layout?.width, docked]);
    const sessions = typeof useSessions === 'function' ? useSessions(state => state) : undefined;
    const running = subagentRows(sessions, sessionId, Date.now()).some(row => row.state === 'running');
    React.useEffect(() => {
      SESSIONS.setWorking(sessionId, running);
      return () => SESSIONS.setWorking(sessionId, false);
    }, [sessionId, running]);
    React.useEffect(() => {
      const seat = marker.current?.closest?.('[data-composer-seat]');
      return seat ? alignToDevicePixels(seat) : undefined;
    }, []);
    const panel = open && layout ? ReactDOM.createPortal(h('aside', { className: 'dpt-sidecar',
      'data-floating': docked ? undefined : '', 'aria-label': t('sideTitle'),
      style: { top: layout.top, right: layout.right, height: layout.height, width: layout.width,
        '--dpt-inset-bottom': layout.inset ? `${layout.inset}px` : undefined } },
      h(ResizeHandle, { layout, t }),
      h('header', { className: 'dpt-sidecar-head' }, h('h3', null, t('sideTitle')),
        h('button', { type: 'button', className: 'dpt-icon-btn', onClick: () => PANEL.toggle(sessionId), 'aria-label': t('panelClose') }, '×')),
      h(DeepPtcPanel, props)), document.body) : null;
    return h(React.Fragment, null,
      h('div', { ref: marker, className: 'dpt-capsule-row', 'data-placement': placement },
        placement === 'dock' ? h(CapsuleButton, { ...props, open }) : null,
        panel),
      open && !layout && typeof ReactDOM?.createPortal !== 'function' ? h(DeepPtcPanel, { ...props, inline: true }) : null);
  }

  // A boundary keeps a failing bridge or panel from taking the conversation with it.
  class Boundary extends React.Component {
    constructor(props) { super(props); this.state = { failed: false }; }
    static getDerivedStateFromError() { return { failed: true }; }
    componentDidCatch(error) { console.warn(`[${PLUGIN}] conversation extras disabled:`, error); }
    render() { return this.state.failed ? null : this.props.children; }
  }

  // When this conversation's model starts the virtual DSH, the user gets to see it: it opens in the right
  // sidebar once, when it runs, if the conversation is on screen.
  const OPENED_KEY = `${PLUGIN}:virtual-opened`;
  function openVirtual(status, sessionId, element) {
    const open = status?.open;
    if (status?.state !== 'running' || !status.url || open?.session !== sessionId || Date.now() - open.at > 15 * 60_000) return;
    if (!(element?.parentElement?.getClientRects?.().length > 0)) return;
    try {
      if (globalThis.sessionStorage?.getItem(OPENED_KEY) === String(open.at)) return;
      globalThis.sessionStorage?.setItem(OPENED_KEY, String(open.at));
      hostCtx?.get?.('sidebarRight')?.openTab('browser', { params: { url: status.url } });
    } catch (error) { console.warn(`[${PLUGIN}] virtual DSH did not open:`, error); }
  }

  function SessionBridge(props) {
    const { sessionId } = props;
    const marker = React.useRef(null);
    const preset = projectionValue(props.useProjection, 'agentPreset');
    const statuses = typeof props.useSessionStatus === 'function' ? props.useSessionStatus(state => state) : undefined;
    const busy = statuses?.get?.(sessionId)?.running === true;
    React.useEffect(() => { SESSIONS.set(sessionId, { id: sessionId, preset, busy, el: marker.current }); }, [sessionId, preset, busy]);
    React.useEffect(() => () => SESSIONS.del(sessionId), [sessionId]);
    React.useEffect(() => SESSIONS.watch(marker.current?.parentElement), []);
    const virtual = projectionValue(props.useProjection, 'deepPtcVirtual')?.status;
    React.useEffect(() => { openVirtual(virtual, sessionId, marker.current); }, [virtual, sessionId]);
    return h('span', { ref: marker, hidden: true, 'aria-hidden': 'true', 'data-dpt-bridge': sessionId });
  }

  // At 125 % scaling the sticky composer can come to rest on half a device pixel, and its text then
  // flickers between two rows while scrolling (#45). The composer's height decides where it rests, so it
  // is padded to whole device pixels. Nothing is padded at whole-number scaling.
  function alignToDevicePixels(seat) {
    if (typeof ResizeObserver !== 'function') return undefined;
    let pad = 0;
    const align = () => {
      const ratio = globalThis.devicePixelRatio || 1;
      const height = seat.getBoundingClientRect().height - pad;
      const device = height * ratio;
      const missing = Math.ceil(device - 0.01) - device;
      const next = Number.isInteger(ratio) || missing < 0.02 ? 0 : missing / ratio;
      if (Math.abs(next - pad) < 0.01) return;
      pad = next;
      seat.style.paddingBottom = pad ? `${pad}px` : '';
    };
    const observer = new ResizeObserver(align);
    observer.observe(seat, { box: 'border-box' });
    globalThis.addEventListener?.('resize', align);
    align();
    return () => { observer.disconnect(); globalThis.removeEventListener?.('resize', align); seat.style.paddingBottom = ''; };
  }

  function DockHost(props) {
    // Registered for every session; only Deep PTC sessions draw the capsule.
    if (projectionValue(props.useProjection, 'agentPreset') !== 'deep-ptc') return null;
    return h(Boundary, null, h(PanelHost, props));
  }

  // The compact capsule in the composer toolbar, beside the host's own controls (conversation.input.right).
  function ToolbarHost(props) {
    usePanel();
    const placement = resolvePlacement(useCompactComposer());
    if (projectionValue(props.useProjection, 'agentPreset') !== 'deep-ptc' || placement !== 'toolbar') return null;
    return h(Boundary, null, h(CapsuleButton, { ...props, compact: true }));
  }

  // The whole panel as a sidebar page. It reuses the props of the conversation's own panel host (its
  // live hooks), and without one (another mode, or not mounted) shows what applies to new sessions.
  function SidebarPanel({ sessionId, form, t, ...rest }) {
    usePanel();
    const id = sessionId ?? SESSIONS.current()?.id;
    const host = id === undefined ? undefined : PANEL.hosts.get(id)?.current;
    return h('div', { className: 'dpt-sidebar-panel' },
      h(DeepPtcPanel, { ...rest, ...host, sessionId: id, form: host?.form ?? form, t }));
  }

  const PLACEMENT_NOTES = { dock: 'panelMoved', toolbar: 'panelMovedToolbar', hidden: 'panelMovedHidden' };
  function TabHost(props) {
    const { sessionId, t } = props;
    usePanel();
    if (PANEL.location === 'sidebar') return h(SidebarPanel, props);
    const placement = resolvePlacement(useCompactComposer());
    const id = sessionId ?? SESSIONS.current()?.id;
    return h('div', { className: 'dpt-side-section' },
      h('p', { className: 'dpt-side-note' }, t(PLACEMENT_NOTES[placement])),
      h('button', { type: 'button', className: 'dpt-btn dpt-btn-block', disabled: id === undefined, onClick: () => PANEL.open(id) }, t('panelOpen')));
  }

  const PLACEMENT_LABELS = { auto: 'placementAuto', dock: 'placementDock', toolbar: 'placementToolbar', hidden: 'placementHidden' };
  function CapsulePlacementSection({ t }) {
    usePanel();
    const compact = useCompactComposer();
    const label = t('capsulePlacement');
    const note = PANEL.placement === 'auto'
      ? `${tf(t, 'placementAutoNow', { place: t(PLACEMENT_LABELS[resolvePlacement(compact)]) })}${t('placementHint')}`
      : t('placementHint');
    return h('section', { className: 'dpt-side-section', 'aria-label': label },
      h('div', { className: 'dpt-side-label' }, h('span', null, label)),
      h('div', { className: 'dpt-seg', role: 'radiogroup', 'aria-label': label },
        ...PLACEMENTS.map(option => h('button', { key: option, type: 'button', role: 'radio', className: 'dpt-seg-btn',
          'aria-checked': option === PANEL.placement, onClick: () => PANEL.setPlacement(option) }, t(PLACEMENT_LABELS[option])))),
      h('p', { className: 'dpt-side-note' }, note));
  }

  const LOCATION_LABELS = { beside: 'locationBeside', sidebar: 'locationSidebar' };
  function PanelLocationSection({ t }) {
    usePanel();
    const label = t('panelLocation');
    return h('section', { className: 'dpt-side-section', 'aria-label': label },
      h('div', { className: 'dpt-side-label' }, h('span', null, label)),
      h('div', { className: 'dpt-seg', role: 'radiogroup', 'aria-label': label },
        ...LOCATIONS.map(option => h('button', { key: option, type: 'button', role: 'radio', className: 'dpt-seg-btn',
          'aria-checked': option === PANEL.location, onClick: () => PANEL.setLocation(option) }, t(LOCATION_LABELS[option])))),
      h('p', { className: 'dpt-side-note' }, `${t('locationHint')}${BETTER.service ? t('locationBetter') : ''}`));
  }

  function TabTitle({ t }) {
    return h('span', { className: 'dpt-tab-title' }, t('sideTitle'));
  }

  function DiagnosticsSection({ t }) {
    const [text, setText] = React.useState('');
    const [copied, setCopied] = React.useState(false);
    async function copy() {
      const value = diagnostics();
      setText(value);
      try { await navigator.clipboard?.writeText(value); setCopied(true); } catch { setCopied(false); }
    }
    return h('section', { 'aria-label': t('diagTitle') },
      h('h3', null, t('diagTitle')),
      h('div', { className: 'dpt-settings-row' }, h('p', { className: 'dpt-side-note' }, t('diagHint')),
        h('button', { type: 'button', className: 'dpt-btn', onClick: () => { void copy(); } }, copied ? t('diagCopied') : t('diagCopy'))),
      text ? h('pre', { className: 'dpt-diag' }, text) : null);
  }

  // The Deep PTC settings page: the environment form, the effects switch and diagnostics.
  function SettingsPage({ form, t }) {
    return h('div', { className: 'dpt-settings' },
      // The form labels its own environment field.
      h('section', { 'aria-label': t('environment') },
        form ? h(Card, { form, t }) : h('p', { className: 'dpt-side-note' }, t('readOnly'))),
      h('section', { 'aria-label': t('cardsSection') }, h('h3', null, t('cardsSection')), h(CardsSettingsSection, { form, t })),
      h('section', { 'aria-label': t('soundSection') }, h('h3', null, t('soundSection')), h(SoundSettings, { form, t })),
      h('section', { 'aria-label': t('appearance') }, h('h3', null, t('appearance')),
        h(VisualEffectsSection, { t }), h(PanelLocationSection, { t }), h(CapsulePlacementSection, { t })),
      h(DiagnosticsSection, { t }));
  }

  const SettingsIcon = ({ size = 16 }) => h('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
    h('path', { d: 'M2.5 4.5h6M2.5 8h11M2.5 11.5h8', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round' }),
    h('circle', { cx: 11.5, cy: 4.5, r: 1.6, stroke: 'currentColor', strokeWidth: 1.3 }));
  // The skill switches run a host command, and the host logs every command. The log keeps it; the
  // conversation shows nothing for a success and a short line for a failure.
  function SkillCommandRow({ node, t }) {
    const outcome = node?.outcome;
    if (outcome?.kind === 'error') return h('div', { className: 'dpt-command-error', role: 'status' }, commandText(outcome.text, t));
    return h('span', { hidden: true, 'data-dpt-hidden-command': SKILL_COMMAND_NAME });
  }

  const SKILL_COMMAND_NAME = 'deep-ptc-skill-state';
  function runSkillCommand(child, sessionId, payload) {
    const execute = child.remote?.commands?.execute;
    if (typeof execute !== 'function') return Promise.resolve({ ok: false, error: { message: 'unavailable' } });
    // The remote command API takes the full line plus attachments. The JSON payload is command input.
    return execute(sessionId, `/${SKILL_COMMAND_NAME} ` + JSON.stringify(payload), []);
  }
  const TAB_KIND = 'deep-ptc';

  // Per-conversation props for the panel and its composer capsule.
  function sessionTools(child) {
    return sessionId => {
      const jobs = child.get?.('jobs');
      const props = {
        reply: text => sendReply(child, sessionId, text),
        runProject: payload => runProjectCommand(child, sessionId, payload),
        runVirtual: payload => runVirtualCommand(child, sessionId, payload),
        reset: () => {
          const execute = child.remote?.commands?.execute;
          if (typeof execute !== 'function') return Promise.resolve({ ok: true, value: undefined });
          return execute(sessionId, '/deep-ptc-reset-tools', []);
        },
        runSleep: payload => {
          const execute = child.remote?.commands?.execute;
          if (typeof execute !== 'function') return Promise.resolve({ ok: false, error: { message: 'unavailable' } });
          return execute(sessionId, '/deep-ptc-sleep ' + JSON.stringify(payload), []);
        },
      };
      if (jobs?.state && typeof jobs.watchRows === 'function') {
        props.hooks = { jobs: jobs.state };
        props.watchJobs = id => jobs.watchRows(id);
      }
      return props;
    };
  }

  function apply(ctx) {
    hostCtx = ctx;
    const t = ctx.locale.bind('deep-ptc');
    const subscribeLocale = listener => ctx.locale.subscribe?.(listener) ?? noSubscribe();
    const readLocale = () => ctx.locale.getSnapshot?.()?.revision ?? 0;
    const useLocaleRevision = () => React.useSyncExternalStore(subscribeLocale, readLocale, readLocale);
    function LocalizedSlot({ component, ...props }) {
      useLocaleRevision();
      return h(component, { ...props, t: props.t ?? t });
    }
    ctx.effect(() => ctx.locale.register('deep-ptc', dictionaries));
    installPresetLabels(ctx.slots, t, useLocaleRevision);
    try {
      ctx.inject?.(['remote', 'remote.session'], child => {
        REMOTE_SESSION.current = child;
        child.effect(() => () => { if (REMOTE_SESSION.current === child) REMOTE_SESSION.current = undefined; }, `${PLUGIN}: session messages`);
      });
    } catch { /* reply buttons report that the message could not be sent */ }
    try {
      ctx.inject?.(['remote'], child => installNotices(child, {
        setting: key => formValue(ctx.configForms.get(NS), key), deep: id => SESSIONS.map.get(id)?.preset === 'deep-ptc' }));
    } catch { /* cards keep working without sounds */ }
    ctx.effect(() => injectCss(), `${PLUGIN}: style`);
    ctx.effect(() => watchActiveSession(), `${PLUGIN}: active session`);
    ctx.effect(() => {
      if (typeof window?.addEventListener !== 'function') return () => {};
      const sync = event => PANEL.sync(event);
      window.addEventListener('storage', sync);
      return () => window.removeEventListener('storage', sync);
    }, `${PLUGIN}: panel preferences`);
    const form = ctx.configForms.get(NS);
    ctx.effect(() => ctx.configForms.whileServed([NS], () => {
      const disposers = [
        // The plugin manager row keeps its settings card.
        ctx.slots.inject('plugins.item', () => ctx.slots.register({
          name: 'plugins.item', id: 'deep-ptc', order: 41,
          label: () => t('title'), locale: 'deep-ptc',
        }, props => h(LocalizedSlot, { ...props, form, component: Card }))),
        // Deep PTC's own settings page, under its own id: no other entry is shadowed.
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'deep-ptc', order: 24,
          label: () => t('title'), locale: 'deep-ptc',
        }, props => h(LocalizedSlot, { ...props, form, component: SettingsPage }))),
      ];
      try {
        disposers.push(ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
          name: 'settings.section.icon', id: 'deep-ptc',
        }, SettingsIcon)));
      } catch { /* the nav keeps its default icon */ }
      return () => disposers.reverse().forEach(dispose => dispose?.());
    }));
    try {
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
        name: 'conversation.chat.commandview', key: SKILL_COMMAND_NAME, locale: 'deep-ptc',
      }, props => h(LocalizedSlot, { ...props, component: SkillCommandRow })));
    } catch { /* without the renderer the host shows its generic command row */ }
    try {
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
        name: 'conversation.chat.commandview', key: CARD_COMMAND_NAME, locale: 'deep-ptc',
      }, props => h(LocalizedSlot, { ...props, component: CardCommandRow })));
    } catch { /* the host shows its generic command row */ }
    try {
      ctx.inject?.(['uiConversation', 'remote', 'remote.commands'], child => {
        const prefix = 'plugin:dsh-deep-ptc-mode/';
        function inline(kind, match, component, inject, dataOf = () => ({})) {
          child.uiConversation.events.register({
            kind, target: 'chat', match,
            start: (_context, match) => match, update: context => context.state,
            buildViewNode(context) {
              const first = context.start ?? context.matches[0];
              if (!first) return null;
              return { key: context.key, kind, id: context.id, target: 'chat', anchorSeq: first.event.seq,
                location: first.location, visibility: 'visible', groupTree: 'turn', data: { anchor: context.id, ...dataOf(first.event) } };
            },
          });
          child.slots.inject('conversation.chat.node', () => child.slots.register({
            name: 'conversation.chat.node', key: kind, locale: 'deep-ptc', inject,
          }, props => h(LocalizedSlot, { ...props, anchor: props.node.data.anchor, component, form })));
        }
        const start = id => ({ id: String(id), role: 'start' });
        inline('deep-ptc-cards', { [prefix + 'cards']: event => {
          const r = event.data;
          if (r?.op === 'phase' && r.next) return start(r.next.rev);
          return r?.op === 'show' ? start(r.group ?? r.rev) : r?.v === 1 ? start(event.seq) : null;
        } }, ConversationCards, sessionId => ({
          sessionId, run: (id, action, extra) => runCardCommand(child, sessionId, { id, action, ...extra }),
          reply: text => sendReply(child, sessionId, text),
        }));
        const assignment = event => {
          const message = event.data?.message ?? event.data;
          if (message?.source?.kind !== 'agent-message' || !Array.isArray(message.content)) return;
          const block = message.content.find(row => row.type === 'text' && row.text?.startsWith('[Deep PTC task assignment]\n'));
          if (!block) return;
          const [, title, ...lines] = block.text.split('\n');
          const items = lines.filter(line => line.startsWith('- ')).map(line => line.slice(2));
          if (title && items.length) return { title, items };
        };
        inline('deep-ptc-assignment', { 'user/message': event => assignment(event) ? start(event.seq) : null },
          AssignmentCard, undefined, assignment);
        inline('deep-ptc-task-brief', { [prefix + 'brief']: event => event.data?.rev ? start(event.data.anchor ?? event.data.rev) : null },
          BriefInline, sessionId => ({ sessionId, run: payload => runBriefCommand(child, sessionId, payload) }));
        inline('deep-ptc-project-proposals', {
          [prefix + 'project']: event => event.data?.inlineNew !== false && event.data?.proposals?.length ? start(event.seq) : null,
          [prefix + 'project-proposal']: event => start(event.data?.anchor ?? event.seq),
        }, ProjectInline, sessionId => ({ sessionId, run: payload => runProjectCommand(child, sessionId, payload), reply: text => sendReply(child, sessionId, text) }));
        const skillResult = event => {
          const blocks = event.data?.message?.content ?? event.data?.content;
          return Array.isArray(blocks) && blocks.some(row => row.type === 'text' && /^\s*<skill_content\s+name=/u.test(row.text)) ? start(event.seq) : null;
        };
        inline('deep-ptc-skills', { 'tool/result': skillResult, 'tool/ptc-dispatch': event => event.data?.name === 'skill' ? skillResult(event) : null },
          SkillTail, sessionId => ({ setSkill: (name, enabled) => runSkillCommand(child, sessionId, { action: 'set', name, enabled }),
            setAll: enabled => runSkillCommand(child, sessionId, { action: 'all', enabled }) }));
        // The confirmed task sits in the composer dock beside the host's plan (todo order 0, goal 10).
        child.slots.inject('conversation.input.dock', () => child.slots.register({
          name: 'conversation.input.dock', id: 'deep-ptc-task', order: 5, locale: 'deep-ptc',
          inject: sessionId => ({ sessionId, run: payload => runBriefCommand(child, sessionId, payload) }),
        }, props => h(LocalizedSlot, { ...props, form, component: TaskDock })));
        // In a subagent's conversation: what the user writes here also reaches the parent.
        child.slots.inject('conversation.input.dock', () => child.slots.register({
          name: 'conversation.input.dock', id: 'deep-ptc-direct', order: 6, locale: 'deep-ptc',
        }, props => h(LocalizedSlot, { ...props, component: DirectNote })));
        child.slots.inject('conversation.session.header.actions', () => child.slots.register({
          name: 'conversation.session.header.actions', id: 'deep-ptc-project-sync',
          inject: sessionId => ({ sessionId, refresh: () => runProjectCommand(child, sessionId, { op: 'refresh' }) }),
        }, props => h(ProjectSync, { ...props, form })));
      });
    } catch { /* the conversation keeps working without the card */ }
    try {
      // The Virtual DSH card asks for its status through a command: keep those rows out of the chat.
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
        name: 'conversation.chat.commandview', key: 'deep-ptc-virtual-dsh', locale: 'deep-ptc',
      }, () => h('span', { hidden: true, 'data-dpt-hidden-command': 'deep-ptc-virtual-dsh' })));
    } catch { /* the host shows its generic command row */ }
    try {
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
        name: 'conversation.chat.commandview', key: BRIEF_COMMAND_NAME, locale: 'deep-ptc',
      }, props => h(LocalizedSlot, { ...props, component: ({ node, t: tt }) => node?.outcome?.kind === 'error'
        ? h('div', { className: 'dpt-command-error', role: 'status' }, commandText(node.outcome.text, tt))
        : h('span', { hidden: true, 'data-dpt-hidden-command': BRIEF_COMMAND_NAME }) })));
    } catch { /* the host shows its generic command row */ }
    try {
      ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
        name: 'conversation.chat.commandview', key: PROJECT_COMMAND_NAME, locale: 'deep-ptc',
      }, props => h(LocalizedSlot, { ...props, component: ({ node, t: tt }) => node?.outcome?.kind === 'error'
        ? h('div', { className: 'dpt-command-error', role: 'status' }, commandText(node.outcome.text, tt))
        : h('span', { hidden: true, 'data-dpt-hidden-command': PROJECT_COMMAND_NAME }) })));
    } catch { /* the host shows its generic command row */ }
    try {
      // The 特点卡片 view joins 对话 / 轨迹 / 统计 only while a Deep PTC conversation is on screen and
      // project cards are on; other conversations still read the cards in their prompt.
      ctx.inject?.(['remote', 'remote.commands'], child => {
        child.effect(() => {
          let dispose;
          const sync = () => {
            const wanted = SESSIONS.current()?.preset === 'deep-ptc' && formValue(form, 'projectCards') !== false;
            if (wanted && dispose === undefined) {
              dispose = child.slots.inject('conversation.view', () => child.slots.register({
                name: 'conversation.view', id: 'deep-ptc-project', order: 50, locale: 'deep-ptc', label: () => t('projectTab'),
                inject: sessionId => ({ sessionId, run: payload => runProjectCommand(child, sessionId, payload), reply: text => sendReply(child, sessionId, text),
                  runBrief: formValue(form, 'taskBrief') !== false ? payload => runBriefCommand(child, sessionId, payload) : undefined }),
              }, props => h(LocalizedSlot, { ...props, component: ProjectView })));
            } else if (!wanted && dispose !== undefined) { const stop = dispose; dispose = undefined; stop?.(); }
          };
          sync();
          SESSIONS.subs.add(sync);
          const unsubscribe = form?.subscribe?.(sync);
          return () => { SESSIONS.subs.delete(sync); unsubscribe?.(); dispose?.(); dispose = undefined; };
        }, `${PLUGIN}: project cards view`);
      });
    } catch { /* conversations keep their other views */ }
    try {
      // Each conversation header reports which session is on screen and whether it works.
      ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
        name: 'conversation.session.header.actions', id: 'deep-ptc-session', order: 31,
      }, props => h(Boundary, null, h(SessionBridge, props))));
    } catch { /* the conversation keeps working without the look */ }
    try {
      ctx.inject?.(['remote', 'remote.commands'], child => {
        try {
          // The capsule renders in the composer's own dock, in the page flow.
          child.slots.inject('conversation.composer.dock', () => child.slots.register({
            name: 'conversation.composer.dock', id: 'deep-ptc-side', order: 89, locale: 'deep-ptc',
            inject: sessionTools(child),
          }, props => h(LocalizedSlot, { ...props, form, component: DockHost })));
        } catch { /* the composer stays usable when this slot cannot register */ }
        try {
          // The compact capsule joins the host's tool row, so a one-row composer keeps one row.
          child.slots.inject('conversation.input.right', () => child.slots.register({
            name: 'conversation.input.right', id: 'deep-ptc-capsule', order: 80, locale: 'deep-ptc',
          }, props => h(LocalizedSlot, { ...props, form, component: ToolbarHost })));
        } catch { /* the capsule stays below the composer */ }
      });
    } catch { /* the composer stays usable when this slot cannot register */ }
    try {
      // The tab holds a button that opens the panel. It is listed on the sidebar's new-tab guide only
      // while the capsule is hidden, as the way back to the panel; saved tabs open in any placement.
      ctx.inject?.(['remote', 'remote.commands', 'sidebarRightTabs'], child => {
        child.effect(() => {
          let hidden;
          let dispose;
          const register = () => {
            const next = !BETTER.service && (PANEL.placement === 'hidden' || PANEL.location === 'sidebar');
            if (next === hidden) return;
            hidden = next;
            dispose?.();
            dispose = child.sidebarRightTabs.register({
              id: PLUGIN, kind: TAB_KIND, title: () => t('sideTitle'),
              guide: hidden ? [{ id: TAB_KIND, order: 60, title: () => t('sideTitle'), description: () => t('sideGuide') }] : [],
            });
          };
          register();
          const unsubscribe = PANEL.subscribe(register);
          return () => { unsubscribe(); dispose?.(); };
        }, `${PLUGIN}: sidebar tab type`);
        child.slots.inject('sidebar.right.pane.tab', () => child.slots.register({
          name: 'sidebar.right.pane.tab', key: PLUGIN, locale: 'deep-ptc', inject: sessionTools(child),
        }, props => h(LocalizedSlot, { ...props, form, component: TabHost })));
        child.slots.inject('sidebar.right.pane.tab.title', () => child.slots.register({
          name: 'sidebar.right.pane.tab.title', key: PLUGIN,
        }, props => h(LocalizedSlot, { ...props, component: TabTitle })));
      });
    } catch { /* without a right sidebar the capsule opens the panel in place */ }
    try {
      // With dsh-better-sidebar the panel is one of its pages (right sidebar or bottom workbench).
      ctx.inject?.(['betterSidebar'], child => {
        child.effect(() => {
          const service = child.betterSidebar ?? child.get?.('betterSidebar');
          if (typeof service?.registerTab !== 'function') return () => {};
          const dispose = service.registerTab({
            id: BETTER_TAB, title: () => t('sideTitle'), description: () => t('sideGuide'), order: 60, single: true,
            component: ({ scope }) => h(Boundary, null, h(LocalizedSlot, { component: SidebarPanel, sessionId: scope?.sessionId, form })),
          });
          BETTER.service = service;
          PANEL.emit();
          return () => {
            if (BETTER.service === service) { BETTER.service = undefined; PANEL.emit(); }
            dispose?.();
          };
        }, `${PLUGIN}: better sidebar tab type`);
      });
    } catch { /* the host's own sidebar tab stays */ }
  }
  return { apply, inject };
} });

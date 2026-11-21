  const CARD_CSS = `
.dpt-card,.dpt-panel,.dpt-sidecar,.dpt-capsule,.dpt-settings{--dpt-accent:var(--dpt-brand,#3370ff);--dpt-ease:cubic-bezier(.22,1,.36,1);--dpt-line:var(--dsw-alias-border-l1,#e3e7ee)}
.dpt-card{--dpt-card-fill:var(--dsw-static-neutral-50,#f7f8fa);box-sizing:border-box;width:100%;margin:2px 0 4px;border:.5px solid var(--dsw-alias-border-l2,#d6dce6);border-radius:var(--dsw-radius-lg,16px);background:var(--dpt-card-fill);color:var(--dsw-alias-label-primary,#101828);font-size:13px;line-height:20px;overflow:hidden;animation:dpt-rise 220ms var(--dpt-ease) both}
${DARK} .dpt-card{--dpt-card-fill:var(--dsw-static-neutral-850,#1a1f29)}
.dpt-card-head{display:flex;align-items:center;gap:10px;padding:10px 12px 6px}
.dpt-card-icon{flex:none;display:grid;place-items:center;width:32px;height:32px;box-sizing:border-box;border-radius:10px;border:.5px solid color-mix(in srgb,var(--dpt-accent) 22%,transparent);background:color-mix(in srgb,var(--dpt-accent) 10%,transparent);color:var(--dpt-accent)}
.dpt-card-titles{flex:1;min-width:0;display:flex;flex-direction:column}
.dpt-card-title{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-card-sub{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#667085);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-card-sub [data-tone="warn"]{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dpt-card-actions{flex:none;display:flex;gap:6px}
.dpt-btn{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;height:26px;padding:0 10px;border:1px solid color-mix(in srgb,var(--dpt-accent) 35%,transparent);border-radius:var(--dsw-radius-sm,8px);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#101828);font:inherit;font-size:12px;font-weight:500;line-height:18px;white-space:nowrap;cursor:pointer;transition:background-color 120ms,border-color 120ms,opacity 120ms}
.dpt-btn:hover:not(:disabled){background:color-mix(in srgb,var(--dpt-accent) 8%,var(--dsw-alias-bg-base,#fff))}
.dpt-card .dpt-btn{border:.5px solid var(--dsw-alias-border-l3,#c9d0db);background:var(--dsw-alias-button-floating-fill,#fff);font-weight:400}
.dpt-card .dpt-btn:hover:not(:disabled){background:var(--dsw-alias-button-floating-hover,var(--dsw-alias-interactive-bg-hover,rgba(16,24,40,.05)))}
.dpt-btn:disabled{opacity:.45;cursor:default}
.dpt-btn[aria-busy="true"]{cursor:wait}
.dpt-btn:focus-visible,.dpt-switch:focus-visible,.dpt-agent:focus-visible,.dpt-file-open:focus-visible,.dpt-icon-btn:focus-visible,.dpt-link:focus-visible,.dpt-capsule:focus-visible{outline:2px solid var(--dpt-accent,#3370ff);outline-offset:2px}
.dpt-skill-list{list-style:none;margin:0;padding:0 4px 4px;display:flex;flex-direction:column;gap:2px}
.dpt-skill{display:flex;align-items:center;gap:12px;padding:7px 8px 7px 10px;border-radius:10px;transition:background-color 120ms}
.dpt-skill:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(16,24,40,.05))}
.dpt-skill-text{flex:1;min-width:0;display:flex;flex-direction:column;transition:opacity 160ms}
.dpt-skill[data-off] .dpt-skill-text{opacity:.5}
.dpt-skill-name{display:flex;align-items:center;gap:6px;min-width:0;font-family:var(--ds-font-family-code,ui-monospace,Consolas,monospace);font-size:12.5px;font-weight:500;line-height:20px}
.dpt-skill-name>span:first-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-skill[data-off] .dpt-skill-name>span:first-child{text-decoration:line-through;text-decoration-color:var(--dsw-alias-label-tertiary,#667085)}
.dpt-tag{flex:none;font-family:var(--ds-font-family,inherit);font-size:10px;line-height:16px;padding:0 6px;border-radius:999px;font-weight:500;background:color-mix(in srgb,var(--dpt-accent) 12%,transparent);color:var(--dpt-accent)}
.dpt-skill-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#667085);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-switch{position:relative;flex:none;width:32px;height:18px;padding:0;border:0;border-radius:999px;background:var(--dsw-alias-border-l2,#cfd5df);cursor:pointer;transition:background-color 160ms var(--dpt-ease,ease)}
.dpt-switch[aria-checked="true"]{background:var(--dpt-accent,#3370ff)}
.dpt-switch:disabled{opacity:.5;cursor:default}
.dpt-switch-thumb{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.28);transition:transform 160ms var(--dpt-ease,ease)}
.dpt-switch[aria-checked="true"] .dpt-switch-thumb{transform:translateX(14px)}
.dpt-card-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0;padding:8px 14px 10px;border-top:.5px solid var(--dsw-alias-border-l1,#e3e7ee);font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#667085)}
.dpt-link{flex:none;border:0;background:none;padding:0;font:inherit;color:var(--dpt-accent,#3370ff);cursor:pointer}
.dpt-panel{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#101828);font-size:13px;line-height:20px}
.dpt-panel[data-inline]{height:auto;max-height:min(60vh,520px);margin:6px 0 2px;border:1px solid var(--dpt-line);border-radius:14px;background:var(--dsw-alias-bg-base,#fff);overflow:hidden;animation:dpt-rise 200ms var(--dpt-ease) both}
.dpt-side-body{flex:1;overflow:auto;min-height:0;padding-top:10px}
.dpt-side-section{padding:2px 14px 12px}
.dpt-side-section+.dpt-side-section{border-top:1px solid var(--dpt-line);padding-top:10px}
.dpt-side-agents{padding-left:8px;padding-right:8px}
.dpt-side-agents .dpt-agents-list{display:flex;flex-direction:column;gap:4px;padding:2px 0}
.dpt-side-agents>.dpt-side-label{padding:0 6px}
.dpt-side-label{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:6px;font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#4a5565)}
.dpt-side-hint{min-width:0;font-size:11px;font-weight:400;color:var(--dsw-alias-label-tertiary,#667085);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-seg{display:flex;gap:2px;padding:2px;border-radius:10px;background:color-mix(in srgb,var(--dpt-accent) 9%,transparent)}
.dpt-seg-btn{flex:1;min-width:0;height:26px;padding:0 6px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,#4a5565);font:inherit;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;transition:background-color 120ms,color 120ms,box-shadow 120ms}
.dpt-seg-btn:hover:not(:disabled):not([aria-checked="true"]){color:var(--dsw-alias-label-primary,#101828)}
.dpt-seg-btn[aria-checked="true"]{background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#101828);font-weight:600;box-shadow:0 1px 3px color-mix(in srgb,var(--dpt-accent) 25%,transparent),0 0 0 1px color-mix(in srgb,var(--dpt-accent) 35%,transparent)}
.dpt-seg-btn:disabled{cursor:default}
.dpt-seg-btn:focus-visible,.dpt-input:focus-visible,.dpt-select:focus-visible{outline:2px solid var(--dpt-accent,#3370ff);outline-offset:1px}
.dpt-field{display:flex;gap:6px;margin-top:8px}
.dpt-input,.dpt-select{flex:1;min-width:0;box-sizing:border-box;height:28px;padding:0 8px;border:1px solid var(--dpt-line);border-radius:8px;background:var(--dsw-alias-bg-base,#fff);color:inherit;font:inherit;font-size:12px}
.dpt-btn-block{display:flex;width:100%}
.dpt-side-hint[data-tone="warn"]{color:var(--dsw-alias-state-warn-primary,#b45309)}
.dpt-tool-failures{margin:0 0 8px;padding:8px 10px;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary,#d97706) 10%,transparent);font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary,#4a5565)}
.dpt-tool-failures p{margin:0 0 4px}
.dpt-tool-failures ul{margin:0;padding-left:16px}
.dpt-tool-failures code{font-family:var(--ds-font-family-code,ui-monospace,monospace)}
.dpt-side-note{margin:6px 0 0;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#667085)}
.dpt-side-note[data-tone="ok"]{color:var(--dsw-alias-state-success-primary,#0f7a4f)}
.dpt-side-note[data-tone="error"]{color:var(--dsw-alias-state-error-primary,#c4321f)}
.dpt-agents-list{list-style:none;margin:0;padding:0;overflow:visible;min-height:0}
.dpt-agent{display:flex;align-items:flex-start;gap:10px;width:100%;box-sizing:border-box;padding:7px 8px 7px calc(8px + var(--dpt-depth,0) * 14px);border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background-color 120ms}
.dpt-agent:hover:not(:disabled){background:color-mix(in srgb,var(--dpt-accent) 7%,transparent)}
.dpt-agent:disabled{cursor:default}
.dpt-agent-dot{flex:none;width:8px;height:8px;margin-top:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#98a2b3)}
.dpt-agent[data-state="running"] .dpt-agent-dot,.dpt-capsule[data-state="running"] .dpt-agent-dot,.dpt-job[data-state="running"] .dpt-agent-dot{background:var(--dpt-accent,#3370ff);box-shadow:0 0 6px 2px color-mix(in srgb,var(--dpt-accent,#3370ff) 60%,transparent)}
${ON} .dpt-capsule[data-state="running"] .dpt-agent-dot,${ON} .dpt-agent[data-state="running"] .dpt-agent-dot{animation:dpt-dot-flash 1.2s ease-in-out infinite}
@keyframes dpt-dot-flash{0%,100%{opacity:1}50%{opacity:.35}}
.dpt-agent[data-state="completed"] .dpt-agent-dot,.dpt-job[data-state="completed"] .dpt-agent-dot{background:var(--dsw-alias-state-success-primary,#0f7a4f)}
.dpt-job[data-state="stopping"] .dpt-agent-dot,.dpt-job[data-state="killed"] .dpt-agent-dot{background:var(--dsw-alias-state-warn-primary,#b45309)}
.dpt-job[data-state="failed"] .dpt-agent-dot{background:var(--dsw-alias-state-error-primary,#c4321f)}
.dpt-side-effects .dpt-side-label{align-items:center}
.dpt-jobs-list{display:grid;gap:4px;list-style:none;padding:0;margin:0}
.dpt-job,.dpt-jobs-more{padding:5px 6px;border-radius:6px;background:var(--dpt-surface-soft,var(--dsw-alias-fill-secondary,transparent))}
.dpt-job{display:flex;align-items:flex-start;gap:7px}
.dpt-jobs-more summary{cursor:pointer;font-size:11px;line-height:16px}
.dpt-jobs-more .dpt-jobs-list{margin-top:4px}
.dpt-agent-main{flex:1;min-width:0;display:flex;flex-direction:column}
.dpt-agent-name{font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-side-agents .dpt-agent{align-items:center}
.dpt-side-agents .dpt-agent-dot{margin-top:0}
.dpt-side-agents .dpt-agent-name{flex:1;min-width:0}
.dpt-agent-duration{flex:none;margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#667085);font-variant-numeric:tabular-nums;white-space:nowrap}
.dpt-agent-meta{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,#667085);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-capsule-row{display:flex;flex-direction:column;align-items:flex-end;padding:4px 2px 0}
.dpt-capsule{display:inline-flex;align-items:center;gap:8px;max-width:100%;height:26px;padding:0 11px;box-sizing:border-box;border-radius:999px;border:1px solid var(--dpt-line);background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-secondary,#4a5565);font:inherit;font-size:12px;cursor:pointer;transition:border-color 120ms,color 120ms}
.dpt-capsule>span:last-child{min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-capsule:hover,.dpt-capsule[aria-expanded="true"]{color:var(--dsw-alias-label-primary,#101828);border-color:color-mix(in srgb,var(--dpt-accent) 40%,transparent)}
.dpt-capsule .dpt-agent-dot{margin-top:0}
.dpt-capsule-row>.dpt-panel{align-self:stretch}
.dpt-capsule-row:not([data-placement="dock"]){display:none}
.dpt-capsule[data-compact]{height:28px;max-width:200px;padding:0 10px;gap:6px;flex:none}
.dpt-sidecar{position:fixed;z-index:20;display:flex;flex-direction:column;box-sizing:border-box;background:var(--dsw-alias-bg-base,#fff);color:var(--dsw-alias-label-primary,#101828);border-left:1px solid var(--dpt-line);overflow:hidden}
.dpt-sidecar[data-floating]{border:1px solid var(--dpt-line);border-radius:12px;box-shadow:0 4px 20px #0002}
.dpt-sidecar-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-bottom:1px solid var(--dpt-line);font-size:13px}
.dpt-sidecar-head h3{margin:0;font:inherit;font-weight:600}
.dpt-sidebar-panel{box-sizing:border-box;display:flex;flex-direction:column;height:100%;min-height:0;padding:0 4px}
.dpt-sidebar-panel .dpt-panel{flex:1;height:auto;overflow:hidden}
.dpt-sidecar .dpt-panel{flex:1;height:auto;overflow:hidden}
.dpt-sidecar .dpt-side-body{padding-bottom:var(--dpt-inset-bottom,0px)}
.dpt-resize{position:absolute;left:0;top:0;bottom:0;z-index:1;width:6px;cursor:col-resize;touch-action:none;-webkit-app-region:no-drag;outline:none}
.dpt-resize::after{content:"";position:absolute;left:0;top:0;bottom:0;width:2px;background:transparent;transition:background-color 120ms}
.dpt-resize:hover::after,.dpt-resize:focus-visible::after,.dpt-resize[data-active]::after{background:color-mix(in srgb,var(--dpt-accent,#3370ff) 55%,transparent)}
body[data-dpt-resizing],body[data-dpt-resizing] *{cursor:col-resize!important;user-select:none!important}
[data-conversation-region="chat"][data-dpt-panel-open]{margin-right:var(--dpt-panel-width,280px)!important}
.dpt-tab-title{display:inline-flex;align-items:center;gap:6px}
.dpt-tab-title::before,.dpt-panel-mark::before{content:"";width:8px;height:8px;border-radius:50%;background:linear-gradient(135deg,var(--dpt-brand-light,#7fb0ff),var(--dpt-accent,#3370ff))}
.dpt-settings{display:grid;gap:22px;max-width:640px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#101828)}
.dpt-settings h3{margin:0 0 10px;font-size:14px;line-height:20px;font-weight:600}
.dpt-settings .dpt-side-section{padding:0}
.dpt-settings .dpt-side-section+.dpt-side-section{border:0;padding:0}
.dpt-settings-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.dpt-diag{margin:8px 0 0;padding:10px 12px;max-height:220px;overflow:auto;border-radius:10px;border:1px solid var(--dpt-line);font:11px/16px var(--ds-font-family-code,ui-monospace,monospace);white-space:pre-wrap;word-break:break-word}
.dpt-files{display:grid;gap:1px;list-style:none;margin:0;padding:0}
.dpt-file{display:flex;align-items:center;gap:6px;min-width:0;height:22px;padding:0 6px;border-radius:6px;font-size:12px;line-height:18px}
.dpt-file-open{box-sizing:border-box;width:100%;border:0;background:transparent;color:inherit;font-family:inherit;text-align:left;cursor:pointer}
.dpt-file:hover{background:color-mix(in srgb,var(--dpt-accent) 6%,transparent)}
.dpt-file-name{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--ds-font-family-code,ui-monospace,monospace);font-size:11.5px}
.dpt-file-meta{flex:none;max-width:45%;font-size:11px;color:var(--dsw-alias-label-tertiary,#667085);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-file[data-kind="presented"] .dpt-file-name{color:var(--dpt-accent,#3370ff)}
.dpt-files-more{padding:0 6px}
.dpt-files-more summary{cursor:pointer;height:22px;font-size:11px;line-height:22px;color:var(--dsw-alias-label-tertiary,#667085)}
.dpt-host .dpt-agent-dot{width:6px;height:6px;margin-top:0}
.dpt-host[data-state="ok"] .dpt-agent-dot{background:var(--dsw-alias-state-success-primary,#0f7a4f)}
.dpt-host[data-state="failed"] .dpt-agent-dot{background:var(--dsw-alias-state-error-primary,#c4321f)}
.dpt-ssh-actions{display:flex;gap:6px;padding:2px 6px 6px}
.dpt-ssh-actions .dpt-link{font-size:11px}
[data-chat-flow-kind="command"]:has([data-dpt-hidden-command]){display:none!important}
.dpt-command-error{padding:4px 2px;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#c4321f)}
@keyframes dpt-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.dpt-card,.dpt-panel,.dpt-capsule,.dpt-agent-dot,.dpt-switch,.dpt-switch-thumb{animation:none!important;transition:none!important}}
`;
  // The effects restyle a few host elements only. Toggling them never touches a design token, font or
  // inherited value, so switching conversations restyles those elements and not the whole page (#17).
  const THEME_CSS = `
:root{--dpt-dur-fast:120ms;--dpt-dur-base:200ms;--dpt-ease-out:cubic-bezier(0.22,1,0.36,1);--dpt-brand:#3370ff;--dpt-brand-light:color-mix(in srgb,var(--dpt-brand) 70%,#7fd0ff)}
${DARK}{--dpt-brand:#5b8cff}
${ON} ${COMPOSER}{position:relative;box-shadow:0 10px 30px rgba(16,24,40,0.07),0 2px 6px rgba(16,24,40,0.05);transition:border-color var(--dpt-dur-base) var(--dpt-ease-out),box-shadow var(--dpt-dur-base) var(--dpt-ease-out)}
${ON_DARK} ${COMPOSER}{box-shadow:0 10px 30px rgba(0,0,0,0.45),0 2px 6px rgba(0,0,0,0.35)}
${ON} ${COMPOSER}::before{content:"";position:absolute;inset:-1px;border-radius:inherit;padding:1.5px;pointer-events:none;background:linear-gradient(115deg,var(--dpt-brand),var(--dpt-brand-light),var(--dpt-brand),var(--dpt-brand-light));background-size:300% 100%;-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;opacity:0;transition:opacity var(--dpt-dur-base) var(--dpt-ease-out)}
${ON} ${COMPOSER}:focus-within::before{opacity:1}
${ON} ${COMPOSER}::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;opacity:0;box-shadow:0 0 0 4px color-mix(in srgb,var(--dpt-brand) 22%,transparent),0 0 44px 10px color-mix(in srgb,var(--dpt-brand) 46%,transparent),0 14px 44px color-mix(in srgb,var(--dpt-brand) 22%,transparent);transition:opacity var(--dpt-dur-base) var(--dpt-ease-out)}
${ON}:not([data-dpt-busy]) ${COMPOSER}:focus-within{box-shadow:0 0 0 4px color-mix(in srgb,var(--dpt-brand) 10%,transparent),0 14px 38px color-mix(in srgb,var(--dpt-brand) 16%,transparent) !important}
${ON} ${COMPOSER}:hover:not(:focus-within){background-image:radial-gradient(360px circle at var(--dpt-mx,50%) var(--dpt-my,50%),color-mix(in srgb,var(--dpt-brand) 7%,transparent),transparent 70%)}
@keyframes dpt-sheen{from{background-position:0% 0}to{background-position:300% 0}}
${ON} [data-dpt-send]:not(:disabled):not([aria-disabled="true"]){background-image:linear-gradient(135deg,var(--dpt-brand-light),var(--dpt-brand)) !important;color:#fff !important;box-shadow:0 4px 14px color-mix(in srgb,var(--dpt-brand) 38%,transparent);transition:transform 160ms var(--dpt-ease-out),box-shadow 160ms var(--dpt-ease-out),filter var(--dpt-dur-fast) var(--dpt-ease-out) !important}
${ON} [data-dpt-send]:not(:disabled):not([aria-disabled="true"]):hover{transform:translateY(-1px);box-shadow:0 8px 20px color-mix(in srgb,var(--dpt-brand) 46%,transparent);filter:saturate(1.08)}
${ON} [data-dpt-send]:not(:disabled):not([aria-disabled="true"]):active{transform:translateY(0) scale(0.94);transition-duration:60ms}
${ON} ${BUBBLE}{background-image:linear-gradient(90deg,color-mix(in srgb,var(--dpt-brand) 20%,transparent),color-mix(in srgb,var(--dpt-brand) 7%,transparent)) !important;background-color:transparent !important;color:var(--dsw-alias-label-primary) !important;border-radius:18px 18px 6px 18px !important;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dpt-brand) 16%,transparent);animation:dpt-bubble-rise var(--dpt-dur-base) var(--dpt-ease-out) both}
${ON} ${BUBBLE} *{color:inherit}
@keyframes dpt-bubble-rise{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
${ON} [data-chat-flow-kind="assistant-step"]{font-size:15px}
${ON} [data-chat-flow-kind="assistant-step"] :is(p,li){line-height:1.82}
${ON} [data-chat-flow-kind="assistant-step"] p{margin-block:0.7em}
${ON} [data-chat-flow-kind="assistant-step"] pre{border-radius:14px;border:1px solid var(--dsw-alias-border-l1);box-shadow:0 1px 2px rgba(16,24,40,0.04)}
${ON} [data-chat-flow-kind="assistant-step"] blockquote{border-radius:0 10px 10px 0}
${ON} [data-row-key^="session:"][role="treeitem"]{transition:background-color var(--dpt-dur-fast) var(--dpt-ease-out),color var(--dpt-dur-fast) var(--dpt-ease-out)}
${ON} [data-row-key^="session:"][role="treeitem"]:hover{background-color:color-mix(in srgb,var(--dpt-brand) 7%,transparent)}
${ON} [data-row-key^="session:"][role="treeitem"]:hover:not(:is([aria-selected="true"],[aria-current="true"],[data-selected="true"],.ld-row-selected)){background-image:radial-gradient(160px circle at var(--dpt-mx,50%) var(--dpt-my,50%),color-mix(in srgb,var(--dpt-brand) 18%,transparent),transparent 72%)}
${ON} [data-row-key^="session:"][role="treeitem"]:is([aria-selected="true"],[aria-current="true"],[data-selected="true"],.ld-row-selected){background-image:linear-gradient(90deg,color-mix(in srgb,var(--dpt-brand) 15%,transparent),color-mix(in srgb,var(--dpt-brand) 3%,transparent));font-weight:500}
${ON}[data-dpt-busy] ${COMPOSER}::before{opacity:1;padding:2.5px;animation:dpt-sheen 1.6s linear infinite}
${ON}[data-dpt-busy] ${COMPOSER}{border-color:color-mix(in srgb,var(--dpt-brand) 55%,transparent) !important}
${ON}[data-dpt-busy] ${COMPOSER}::after{animation:dpt-glow 1.9s ease-in-out infinite}
@keyframes dpt-glow{0%,100%{opacity:.3}50%{opacity:1}}
${ON} ${COMPOSER}[data-dpt-done]{animation:dpt-done 900ms var(--dpt-ease-out) 1}
@keyframes dpt-done{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--dpt-brand) 60%,transparent)}100%{box-shadow:0 0 0 26px color-mix(in srgb,var(--dpt-brand) 0%,transparent)}}
${ON}[data-dpt-busy] [data-dpt-send]{position:relative}
${ON}[data-dpt-busy] [data-dpt-send]::after{content:"";position:absolute;inset:-4px;border-radius:50%;padding:2.5px;pointer-events:none;background:conic-gradient(from 0deg,transparent 0 40%,var(--dpt-brand-light) 70%,#fff 100%);-webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude;animation:dpt-spin 1.1s linear infinite}
@keyframes dpt-spin{to{transform:rotate(360deg)}}
.dpt-ripple{position:fixed;z-index:2147483000;pointer-events:none;width:20px;height:20px;margin:-10px 0 0 -10px;border-radius:50%;border:2px solid color-mix(in srgb,var(--dpt-brand,#3370ff) 75%,transparent);background:radial-gradient(circle,color-mix(in srgb,var(--dpt-brand,#3370ff) 45%,transparent),color-mix(in srgb,var(--dpt-brand,#3370ff) 12%,transparent) 60%,transparent 72%);animation:dpt-ripple 650ms cubic-bezier(.22,1,.36,1) forwards}
@keyframes dpt-ripple{0%{transform:scale(.3);opacity:1}100%{transform:scale(7);opacity:0}}
.dpt-fx{position:fixed;left:0;top:0;z-index:2147482000;pointer-events:none;-webkit-app-region:initial!important}
.dpt-cc{--cc-surface:var(--dsw-static-neutral-50,#f8f9fb);--cc-raised:var(--dsw-alias-bg-base,#fff);--cc-line:var(--dsw-alias-border-l1,#e6e9ef);--cc-ink:var(--dsw-alias-label-primary,#101828);--cc-ink-2:var(--dsw-alias-label-secondary,#4a5565);--cc-ink-3:var(--dsw-alias-label-tertiary,#667085);--cc-track:color-mix(in srgb,var(--cc-ink) 8%,transparent);--cc-s1:#2a78d6;--cc-s2:#eb6834;--cc-s3:#1baf7a;--cc-s4:#eda100;--cc-s5:#e87ba4;--cc-good:#0ca30c;--cc-warn:#fab219;--cc-bad:#d03b3b;--cc-accent:var(--cc-s1);position:relative;box-sizing:border-box;width:100%;border:.5px solid var(--dsw-alias-border-l2,#d9dee7);border-radius:14px;background:var(--cc-surface);color:var(--cc-ink);font-size:13px;line-height:20px;overflow:hidden;animation:dpt-rise 220ms var(--dpt-ease,cubic-bezier(.22,1,.36,1)) both}
${DARK} .dpt-cc{--cc-surface:var(--dsw-static-neutral-850,#1b1f27);--cc-raised:color-mix(in srgb,#fff 4%,var(--cc-surface));--cc-track:color-mix(in srgb,#fff 10%,transparent);--cc-s1:#3987e5;--cc-s2:#d95926;--cc-s3:#199e70;--cc-s4:#c98500;--cc-s5:#d55181}
.dpt-cc[data-tone="success"]{--cc-accent:var(--cc-good)}.dpt-cc[data-tone="warn"]{--cc-accent:var(--cc-warn)}.dpt-cc[data-tone="danger"]{--cc-accent:var(--cc-bad)}
.dpt-cc::before{content:"";position:absolute;inset:0 0 auto;height:2px;background:linear-gradient(90deg,var(--cc-accent),transparent);opacity:.85}
.dpt-cc-head{display:flex;align-items:flex-start;gap:10px;padding:12px 14px 4px}
.dpt-cc-icon{flex:none;display:grid;place-items:center;width:30px;height:30px;border-radius:9px;background:color-mix(in srgb,var(--cc-accent) 13%,transparent);color:var(--cc-accent)}
.dpt-cc-titles{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px;padding-top:1px}
.dpt-cc-title{font-size:14px;font-weight:600;line-height:20px;letter-spacing:-.005em;overflow-wrap:anywhere}
.dpt-cc-sub{font-size:12px;line-height:17px;color:var(--cc-ink-3);overflow-wrap:anywhere}
.dpt-cc-pill{flex:none;display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:999px;background:var(--cc-track);color:var(--cc-ink-2);font-size:11px;font-weight:500}
.dpt-cc-pill::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.dpt-cc-pill[data-phase="stopping"]::before{animation:dpt-pulse 1.1s ease-in-out infinite}
.dpt-cc-pill[data-phase="stopped"]{color:var(--cc-good)}.dpt-cc-pill[data-phase="failed"]{color:var(--cc-bad)}
.dpt-side-buttons{display:flex;gap:6px;flex-wrap:wrap;margin-top:6px}
.dpt-virtual{display:flex;flex-direction:column;gap:6px;margin-top:8px;padding:10px 12px;border:.5px solid var(--dpt-line,#e3e7ee);border-radius:10px;background:var(--dsw-static-neutral-50,#f8f9fb)}
${DARK} .dpt-virtual{background:var(--dsw-static-neutral-850,#1b1f27)}
.dpt-virtual-head{display:flex;align-items:center;justify-content:space-between;gap:8px}
.dpt-virtual-title{font-size:13px;font-weight:600}
.dpt-virtual-badge{font-size:11px;line-height:18px;padding:0 8px;border-radius:999px;background:color-mix(in srgb,currentColor 8%,transparent);color:var(--dsw-alias-label-secondary,#4a5565)}
.dpt-virtual-badge[data-state="running"]{color:#0ca30c;background:color-mix(in srgb,#0ca30c 12%,transparent)}
.dpt-virtual-badge[data-state="failed"]{color:#d03b3b;background:color-mix(in srgb,#d03b3b 12%,transparent)}
.dpt-virtual-steps{display:flex;flex-wrap:wrap;gap:4px 10px;margin:0;padding:0;list-style:none;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#667085)}
.dpt-virtual-steps li{display:inline-flex;align-items:center;gap:5px}
.dpt-virtual-steps li::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.35}
.dpt-virtual-steps li[data-step="done"]{color:#0ca30c}
.dpt-virtual-steps li[data-step="done"]::before{opacity:1}
.dpt-virtual-steps li[data-step="active"]{color:var(--dpt-accent,#3370ff);font-weight:600}
.dpt-virtual-steps li[data-step="active"]::before{opacity:1;animation:dpt-spin-pulse 1s ease-in-out infinite alternate}
@keyframes dpt-spin-pulse{from{opacity:.35}to{opacity:1}}
.dpt-virtual-error{margin:0;font-size:12px;color:#d03b3b;overflow-wrap:anywhere}
.dpt-side-buttons .dpt-btn{flex:1 1 auto}
.dpt-side-section[data-compact]{padding-bottom:9px}
.dpt-side-section[data-compact]>.dpt-side-label{margin-bottom:0}
.dpt-side-tail{display:inline-flex;align-items:baseline;gap:10px;min-width:0}
.dpt-side-label .dpt-link{font-size:11px;font-weight:500;line-height:18px}
.dpt-side-label .dpt-link:disabled{opacity:.5;cursor:default}
.dpt-side-hint[data-tone="ok"]{color:var(--dsw-alias-state-success-primary,#0f7a4f)}
.dpt-side-creative>.dpt-side-label{align-items:center}
.dpt-side-creative>.dpt-side-label>span[title]{cursor:help}
.dpt-virtual{gap:8px;margin-top:6px;padding:9px 10px}
.dpt-virtual-head{justify-content:flex-start}
.dpt-virtual-title{flex:1;min-width:0;font-size:12.5px;cursor:help;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-virtual-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#98a2b3);opacity:.6}
.dpt-virtual-dot[data-state="running"]{background:#0ca30c;opacity:1;box-shadow:0 0 0 3px color-mix(in srgb,#0ca30c 18%,transparent)}
.dpt-virtual-dot[data-state="failed"]{background:#d03b3b;opacity:1}
.dpt-virtual-dot:is([data-state="preparing"],[data-state="installing"],[data-state="adding package"],[data-state="starting"],[data-state="restarting"],[data-state="stopping"]){background:var(--dpt-accent,#3370ff);opacity:1;animation:dpt-spin-pulse 1s ease-in-out infinite alternate}
.dpt-virtual .dpt-side-note{margin:0}
.dpt-virtual .dpt-side-buttons{margin-top:0}
.dpt-pv-polish{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dpt-pv-polish .dpt-seg{height:28px}
.dpt-pv-polishing{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;color:var(--cc-ink-2)}
.dpt-pv-spinner{width:12px;height:12px;border-radius:50%;border:1.5px solid color-mix(in srgb,var(--cc-s1) 30%,transparent);border-top-color:var(--cc-s1);animation:dpt-spin .8s linear infinite}
.dpt-pv-editor[data-polishing] .dpt-pv-textarea{opacity:.65}
.dpt-pv-review{display:flex;flex-direction:column;gap:8px;padding:12px 14px;border-radius:10px;border:.5px solid color-mix(in srgb,var(--cc-s1) 35%,var(--cc-line));background:color-mix(in srgb,var(--cc-s1) 4%,var(--cc-raised))}
.dpt-pv-review-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px}
.dpt-pv-review-title{font-size:12.5px;font-weight:600}
.dpt-pv-review .dpt-pv-item{grid-template-columns:34px minmax(0,1fr) auto}
.dpt-pv-note{font-size:11.5px;line-height:16px;color:var(--cc-ink-3)}
.dpt-pv-take{flex:none;align-self:center}
.dpt-pv-take .dpt-seg-btn{padding:0 8px;font-size:11.5px}
.dpt-cc-pill[data-phase="archived"]{background:transparent;color:var(--cc-ink-3);padding:0}
.dpt-cc-pill[data-phase="archived"]::before{display:none}
.dpt-cc-pill[data-phase="question"]{color:var(--cc-s1);background:color-mix(in srgb,var(--cc-s1) 10%,transparent)}
.dpt-cc-pill[data-phase="question"]::before{animation:dpt-pulse 1.6s ease-in-out infinite}
.dpt-cc[data-archived]{background:transparent;border-style:dashed;border-color:var(--cc-line);animation:none}
.dpt-cc[data-archived]::before{opacity:.35}
.dpt-cc[data-archived] .dpt-cc-icon{background:var(--cc-track);color:var(--cc-ink-3)}
.dpt-cc[data-archived] .dpt-cc-option:not([aria-checked="true"]){opacity:.45}
.dpt-cc[data-archived] :is(.dpt-cc-option,.dpt-cc-input){cursor:default}
.dpt-cc-stub{align-self:flex-start;grid-column:1/-1;display:inline-flex;align-items:center;gap:6px;height:26px;padding:0 10px;border:.5px dashed var(--cc-line,#e3e7ee);border-radius:999px;background:transparent;color:var(--dsw-alias-label-tertiary,#667085);font:inherit;font-size:11.5px;cursor:pointer}
.dpt-cc-stub:hover{color:var(--dsw-alias-label-primary,#101828)}
.dpt-cc-stub::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor;opacity:.5}
.dpt-cc-stub-open{grid-column:1/-1;display:flex;flex-direction:column;gap:6px}
.dpt-cq{--cc-accent:var(--cc-s1)}
.dpt-cq .dpt-cq-icon{background:color-mix(in srgb,var(--cc-s1) 12%,transparent);color:var(--cc-s1)}
.dpt-cq-kicker{font-size:11px;line-height:15px;font-weight:600;letter-spacing:.04em;color:var(--cc-s1)}
.dpt-cq[data-answered] .dpt-cq-kicker,.dpt-cq[data-archived] .dpt-cq-kicker{color:var(--cc-ink-3)}
.dpt-cq-list{margin:0;padding:6px 14px 12px;list-style:none;display:flex;flex-direction:column;gap:14px}
.dpt-cq-item{display:flex;flex-direction:column;gap:8px}
.dpt-cq-prompt{margin:0;display:flex;align-items:baseline;gap:8px;font-size:13px;line-height:20px;font-weight:500}
.dpt-cq-num{flex:none;display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;background:var(--cc-track);color:var(--cc-ink-2);font-size:11px;font-weight:600;font-variant-numeric:tabular-nums}
.dpt-cq-optional{font-size:11px;font-weight:400;color:var(--cc-ink-3)}
.dpt-cq-text{box-sizing:border-box;width:100%;min-height:52px;padding:8px 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,#c9d0db);background:var(--cc-raised);color:var(--cc-ink);font:inherit;font-size:13px;line-height:19px;resize:vertical}
.dpt-cq-text:focus{outline:2px solid color-mix(in srgb,var(--cc-s1) 55%,transparent);outline-offset:0;border-color:var(--cc-s1)}
.dpt-cq-answer{margin:0;padding-left:26px;font-size:13px;line-height:20px;color:var(--cc-ink-2);white-space:pre-wrap;overflow-wrap:anywhere}
.dpt-cq .dpt-cc-tags{padding-left:26px}
.dpt-tb-manage>summary,.dpt-skills>summary{cursor:pointer}
.dpt-tb-manage>summary{font-size:12px;padding:4px 8px}
.dpt-cc[data-readonly] .dpt-cc-body{padding-bottom:10px}
.dpt-tb{--cc-accent:var(--cc-s3)}
.dpt-tb-body{display:flex;flex-direction:column;gap:10px;padding:6px 14px 10px}
.dpt-tb-group{display:flex;flex-direction:column;gap:4px}
.dpt-tb-group-label{font-size:11px;line-height:15px;font-weight:600;letter-spacing:.04em;color:var(--cc-ink-3)}
.dpt-tb-items{display:flex;flex-direction:column;gap:2px;margin:0;padding:0;list-style:none}
.dpt-tb-item{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:baseline;column-gap:8px;padding:5px 8px;border-radius:8px;background:var(--cc-raised)}
.dpt-tb-id{font-size:11px;font-weight:600;font-variant-numeric:tabular-nums;color:var(--cc-ink-3)}
.dpt-tb-main{display:flex;flex-direction:column;gap:1px;min-width:0}
.dpt-tb-text{overflow-wrap:anywhere}
.dpt-tb-item[data-status="done"] .dpt-tb-text{color:var(--cc-ink-3);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--cc-ink-3) 60%,transparent)}
.dpt-tb-quote{font-size:11.5px;line-height:16px;color:var(--cc-ink-3);overflow-wrap:anywhere}
.dpt-tb-basis{font-size:11px;line-height:18px;padding:0 6px;border-radius:999px;background:var(--cc-track);color:var(--cc-ink-2);white-space:nowrap}
.dpt-tb-basis[data-basis="inferred"]{background:color-mix(in srgb,var(--cc-warn) 16%,transparent);color:color-mix(in srgb,var(--cc-warn) 55%,var(--cc-ink))}
.dpt-tb-basis[data-basis="confirmed"]{background:color-mix(in srgb,var(--cc-good) 13%,transparent);color:var(--cc-good)}
.dpt-tb-tools{grid-column:2/-1;display:flex;flex-wrap:wrap;gap:10px;padding-top:2px}
.dpt-tb .dpt-pv-link[data-danger]:hover{color:var(--cc-bad)}
.dpt-tb-edit{display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.dpt-tb-edit .dpt-cc-input{flex:1;min-width:140px}
.dpt-tb-select{flex:0 0 auto!important;min-width:0!important}
.dpt-tb-msgs{display:flex;flex-direction:column;gap:6px;margin:2px 0 0;padding:8px 0 0;border-top:.5px solid var(--cc-line);list-style:none}
.dpt-tb-msg{display:flex;flex-direction:column;gap:4px}
.dpt-tb-msg-head{display:flex;flex-wrap:wrap;align-items:center;gap:8px;font-size:12px;color:var(--cc-ink-2)}
.dpt-tb-msg-cover{color:var(--cc-ink-3);font-variant-numeric:tabular-nums}
.dpt-tb-unfiled{display:flex;flex-wrap:wrap;gap:4px 6px;align-items:baseline}
.dpt-tb-unfiled-label{font-size:11px;font-weight:600;color:color-mix(in srgb,var(--cc-warn) 60%,var(--cc-ink))}
.dpt-tb-frag{font-size:12px;line-height:18px;padding:0 6px;border-radius:6px;background:color-mix(in srgb,var(--cc-warn) 12%,transparent);overflow-wrap:anywhere}
.dpt-tb-status{padding:0 14px}
.dpt-tb[data-compact]{margin-top:6px;animation:none}
.dpt-side-brief .dpt-side-label .dpt-pv-link{color:var(--dsw-alias-label-tertiary,#667085);font-size:12px}
@keyframes dpt-pulse{50%{opacity:.25}}
.dpt-cc-body{display:flex;flex-direction:column;gap:12px;padding:8px 14px 12px}
.dpt-cc-cap{display:flex;justify-content:space-between;gap:8px;margin:0 0 6px;font-size:11.5px;line-height:16px;color:var(--cc-ink-3)}
.dpt-cc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(104px,1fr));gap:8px}
.dpt-cc-stat{display:flex;flex-direction:column;gap:2px;min-width:0;padding:10px 12px;border-radius:10px;background:var(--cc-raised);border:.5px solid var(--cc-line);box-shadow:inset 2px 0 0 var(--cc-tone,transparent)}
.dpt-cc-stat[data-tone="success"]{--cc-tone:var(--cc-good)}.dpt-cc-stat[data-tone="warn"]{--cc-tone:var(--cc-warn)}.dpt-cc-stat[data-tone="danger"]{--cc-tone:var(--cc-bad)}
.dpt-cc-stat-label{font-size:11.5px;line-height:16px;color:var(--cc-ink-3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dpt-cc-stat-value{font-size:20px;line-height:26px;font-weight:600;letter-spacing:-.01em;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.dpt-cc-stat-foot{display:flex;flex-wrap:wrap;gap:6px;align-items:baseline;font-size:11.5px;line-height:16px;color:var(--cc-ink-3)}
.dpt-cc-delta{font-weight:500;color:var(--cc-ink-2)}
.dpt-cc-delta[data-tone="success"]{color:var(--cc-good)}.dpt-cc-delta[data-tone="danger"]{color:var(--cc-bad)}
.dpt-cc-rows{display:grid;grid-template-columns:minmax(64px,max-content) 1fr;gap:4px 14px;margin:0}
.dpt-cc-rows>dt{color:var(--cc-ink-3);font-size:12.5px}.dpt-cc-rows>dd{margin:0;min-width:0;overflow-wrap:anywhere;font-size:12.5px}
.dpt-cc-meter+.dpt-cc-meter{margin-top:8px}
.dpt-cc-meter-head{display:flex;justify-content:space-between;gap:8px;font-size:12px;line-height:18px;margin-bottom:4px}
.dpt-cc-meter-head>span:last-child{color:var(--cc-ink-2);font-variant-numeric:tabular-nums}
.dpt-cc-track{position:relative;height:6px;border-radius:999px;background:var(--cc-track);overflow:hidden}
.dpt-cc-fill{position:absolute;inset:0 auto 0 0;border-radius:inherit;background:var(--cc-fill,var(--cc-s1));transform-origin:left;animation:dpt-grow 520ms var(--dpt-ease,ease) both}
.dpt-cc [data-tone="success"]{--cc-fill:var(--cc-good)}.dpt-cc [data-tone="warn"]{--cc-fill:var(--cc-warn)}.dpt-cc [data-tone="danger"]{--cc-fill:var(--cc-bad)}.dpt-cc [data-tone="neutral"]{--cc-fill:color-mix(in srgb,var(--cc-ink) 38%,transparent)}
@keyframes dpt-grow{from{transform:scaleX(0)}}
.dpt-cc-bars{display:grid;grid-template-columns:minmax(56px,max-content) 1fr max-content;gap:6px 10px;align-items:center;margin:0;padding:0;list-style:none}
.dpt-cc-bars>li{display:contents}
.dpt-cc-bar-label{font-size:12px;color:var(--cc-ink-2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:160px}
.dpt-cc-bar-track{position:relative;height:14px}
.dpt-cc-bar{position:absolute;inset:0 auto 0 0;min-width:3px;border-radius:2px 4px 4px 2px;background:var(--cc-fill,var(--cc-s1));transform-origin:left;animation:dpt-grow 520ms var(--dpt-ease,ease) both;transition:filter 120ms}
.dpt-cc-bars>li:hover .dpt-cc-bar{filter:brightness(1.12)}
.dpt-cc-bars>li:hover .dpt-cc-bar-label{color:var(--cc-ink)}
.dpt-cc-bar-value{font-size:12px;color:var(--cc-ink);font-variant-numeric:tabular-nums;text-align:right}
.dpt-cc-chart{position:relative}
.dpt-cc-chart svg{display:block;width:100%;height:96px;overflow:visible}
.dpt-cc-grid{stroke:var(--cc-line);stroke-width:1;vector-effect:non-scaling-stroke}
.dpt-cc-line{fill:none;stroke:var(--cc-s1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}
.dpt-cc-area{fill:var(--cc-s1);opacity:.1}
.dpt-cc-cross{stroke:var(--cc-ink-3);stroke-width:1;stroke-dasharray:2 3;vector-effect:non-scaling-stroke}
.dpt-cc-dot{position:absolute;width:8px;height:8px;margin:-4px 0 0 -4px;border-radius:50%;background:var(--cc-s1);box-shadow:0 0 0 2px var(--cc-surface);pointer-events:none}
.dpt-cc-axis{display:flex;justify-content:space-between;margin-top:4px;font-size:11px;line-height:14px;color:var(--cc-ink-3)}
.dpt-cc-tip{position:absolute;z-index:2;transform:translate(-50%,calc(-100% - 10px));padding:4px 8px;border-radius:6px;background:var(--cc-ink);color:var(--cc-surface);font-size:11.5px;line-height:16px;white-space:nowrap;pointer-events:none;box-shadow:0 4px 14px rgba(0,0,0,.18)}
.dpt-cc-donut{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.dpt-cc-donut svg{flex:none;width:104px;height:104px}
.dpt-cc-seg{fill:none;stroke-width:14;transition:stroke-width 140ms var(--dpt-ease,ease),opacity 140ms}
.dpt-cc-donut[data-hover] .dpt-cc-seg{opacity:.35}.dpt-cc-donut .dpt-cc-seg[data-on]{opacity:1;stroke-width:17}
.dpt-cc-total{font-size:16px;font-weight:600;fill:var(--cc-ink)}.dpt-cc-total-sub{font-size:9px;fill:var(--cc-ink-3)}
.dpt-cc-legend{flex:1;min-width:150px;display:flex;flex-direction:column;gap:3px;margin:0;padding:0;list-style:none}
.dpt-cc-legend>li{display:grid;grid-template-columns:10px 1fr max-content max-content;gap:8px;align-items:center;padding:2px 6px;margin:0 -6px;border-radius:6px;font-size:12px;cursor:default}
.dpt-cc-legend>li[data-on]{background:var(--cc-track)}
.dpt-cc-swatch{width:10px;height:10px;border-radius:3px}
.dpt-cc-legend .dpt-cc-pct{min-width:38px;text-align:right;color:var(--cc-ink-3);font-variant-numeric:tabular-nums}
.dpt-cc-steps{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
.dpt-cc-step{position:relative;display:grid;grid-template-columns:18px 1fr;gap:10px;padding-bottom:10px}
.dpt-cc-step:last-child{padding-bottom:0}
.dpt-cc-step:not(:last-child)::after{content:"";position:absolute;left:8.5px;top:20px;bottom:2px;width:1px;background:var(--cc-line)}
.dpt-cc-step[data-state="done"]:not(:last-child)::after{background:color-mix(in srgb,var(--cc-good) 45%,var(--cc-line))}
.dpt-cc-mark{display:grid;place-items:center;width:18px;height:18px;margin-top:1px;border-radius:50%;box-sizing:border-box;border:1.5px dashed color-mix(in srgb,var(--cc-ink-3) 70%,transparent);color:#fff}
:is([data-state="done"],[data-state="failed"],[data-state="active"])>.dpt-cc-mark{border-style:solid}
[data-state="done"]>.dpt-cc-mark{border-color:var(--cc-good);background:var(--cc-good)}
[data-state="failed"]>.dpt-cc-mark{border-color:var(--cc-bad);background:var(--cc-bad)}
[data-state="active"]>.dpt-cc-mark{border-color:var(--cc-s1);box-shadow:0 0 0 3px color-mix(in srgb,var(--cc-s1) 18%,transparent)}
[data-state="active"]>.dpt-cc-mark::after{content:"";width:6px;height:6px;border-radius:50%;background:var(--cc-s1);animation:dpt-pulse 1.4s ease-in-out infinite}
.dpt-cc-step-text{display:flex;flex-wrap:wrap;gap:2px 8px;align-items:baseline;min-width:0}
.dpt-cc-step-label{font-size:12.5px}[data-state="todo"] .dpt-cc-step-label{color:var(--cc-ink-2)}[data-state="active"] .dpt-cc-step-label{font-weight:600}
.dpt-cc-step-value{font-size:11.5px;color:var(--cc-ink-3)}
.dpt-cc-table-wrap{overflow-x:auto;border:.5px solid var(--cc-line);border-radius:10px;background:var(--cc-raised)}
.dpt-cc-table{width:100%;border-collapse:collapse;font-size:12.5px;line-height:18px}
.dpt-cc-table th{text-align:left;font-weight:500;font-size:11.5px;color:var(--cc-ink-3);padding:7px 10px;border-bottom:.5px solid var(--cc-line);white-space:nowrap}
.dpt-cc-table td{padding:7px 10px;border-bottom:.5px solid var(--cc-line);font-variant-numeric:tabular-nums}
.dpt-cc-table tr:last-child td{border-bottom:0}.dpt-cc-table tbody tr:hover td{background:var(--cc-track)}
.dpt-cc-table td:first-child{font-weight:500}
.dpt-cc-tags{display:flex;flex-wrap:wrap;gap:6px}
.dpt-cc-tag{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 9px;border-radius:999px;border:.5px solid var(--cc-line);background:var(--cc-raised);font-size:11.5px;color:var(--cc-ink-2)}
.dpt-cc-tag[data-tone]::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--cc-fill)}
.dpt-cc-text{margin:0;font-size:13px;line-height:20px;color:var(--cc-ink-2)}
.dpt-cc-callout{--cc-fill:var(--cc-s1);display:grid;grid-template-columns:16px 1fr;gap:9px;align-items:start;padding:9px 12px;border-radius:10px;background:color-mix(in srgb,var(--cc-fill) 10%,transparent);border:.5px solid color-mix(in srgb,var(--cc-fill) 28%,transparent);font-size:12.5px;line-height:19px}
.dpt-cc-callout>svg{margin-top:2px;color:var(--cc-fill)}
.dpt-cc-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:8px 14px 10px;border-top:.5px solid var(--cc-line);font-size:11.5px;line-height:16px;color:var(--cc-ink-3)}
.dpt-cc-note{flex:1;min-width:140px;margin:0;overflow-wrap:anywhere}
.dpt-cc-actions{display:flex;gap:6px;margin-left:auto}
.dpt-cc-btn{height:28px;padding:0 12px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,#c9d0db);background:var(--cc-raised);color:var(--cc-ink);font:inherit;font-size:12px;font-weight:500;cursor:pointer;transition:background-color 120ms var(--dpt-ease,ease),opacity 120ms}
.dpt-cc-btn:hover:not(:disabled){background:var(--cc-track)}
.dpt-cc-btn[data-primary]{border-color:transparent;background:var(--cc-ink);color:var(--cc-surface)}
.dpt-cc-btn[data-primary]:hover:not(:disabled){background:color-mix(in srgb,var(--cc-ink) 86%,var(--cc-surface))}
.dpt-cc-btn[data-ghost]{border-color:transparent;background:transparent;color:var(--cc-ink-3)}
.dpt-cc-btn:disabled{opacity:.5;cursor:default}
.dpt-cc-btn:focus-visible{outline:2px solid var(--cc-s1);outline-offset:1px}
.dpt-cc-close{flex:none;display:grid;place-items:center;width:26px;height:26px;margin:-2px -6px 0 0;padding:0;border:0;border-radius:7px;background:transparent;color:var(--cc-ink-3);cursor:pointer;opacity:.7;transition:opacity 120ms,background-color 120ms}
.dpt-cc:hover .dpt-cc-close,.dpt-cc-close:focus-visible{opacity:1}.dpt-cc-close:hover:not(:disabled){background:var(--cc-track);color:var(--cc-ink)}.dpt-cc-close:focus-visible{outline:2px solid var(--cc-s1);outline-offset:1px}.dpt-cc-close:disabled{cursor:default}
.dpt-cc-options{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.dpt-cc-option{display:flex;align-items:flex-start;gap:9px;min-width:0;padding:9px 11px;border-radius:10px;border:.5px solid var(--cc-line);background:var(--cc-raised);color:var(--cc-ink);font:inherit;text-align:left;cursor:pointer;transition:border-color 120ms,background-color 120ms,box-shadow 120ms}
.dpt-cc-option:hover:not(:disabled){border-color:color-mix(in srgb,var(--cc-s1) 45%,var(--cc-line))}
.dpt-cc-option[aria-checked="true"]{border-color:var(--cc-s1);background:color-mix(in srgb,var(--cc-s1) 8%,var(--cc-raised));box-shadow:0 0 0 1px var(--cc-s1) inset}
.dpt-cc-option:disabled{cursor:default;opacity:.7}
.dpt-cc-option:focus-visible{outline:2px solid var(--cc-s1);outline-offset:1px}
.dpt-cc-option-mark{flex:none;width:14px;height:14px;margin-top:3px;box-sizing:border-box;border-radius:50%;border:1.5px solid var(--cc-ink-3);display:grid;place-items:center}
.dpt-cc-option[data-multiple] .dpt-cc-option-mark{border-radius:4px}
.dpt-cc-option[aria-checked="true"] .dpt-cc-option-mark{border-color:var(--cc-s1);background:var(--cc-s1);box-shadow:inset 0 0 0 2px var(--cc-raised)}
.dpt-cc-option[data-multiple][aria-checked="true"] .dpt-cc-option-mark{box-shadow:none;background:var(--cc-s1) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath d='m3.5 8.3 3 3 6-6.3' fill='none' stroke='white' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/10px no-repeat}
.dpt-cc-option-text{display:flex;flex-direction:column;min-width:0}
.dpt-cc-option-label{font-size:12.5px;line-height:18px;font-weight:500;overflow-wrap:anywhere}
.dpt-cc-option-hint{font-size:11.5px;line-height:16px;color:var(--cc-ink-3)}
.dpt-cc-field{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.dpt-cc-field>label{font-size:12.5px;color:var(--cc-ink-2)}
.dpt-cc-input-wrap{display:inline-flex;align-items:center;gap:6px}
.dpt-cc-input{height:30px;box-sizing:border-box;padding:0 10px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,#c9d0db);background:var(--cc-raised);color:var(--cc-ink);font:inherit;font-size:13px;font-variant-numeric:tabular-nums;color-scheme:light dark}
.dpt-cc-input:focus{outline:2px solid color-mix(in srgb,var(--cc-s1) 60%,transparent);outline-offset:0;border-color:var(--cc-s1)}
.dpt-cc-input:disabled{opacity:.6}
.dpt-cc-input-unit{font-size:12px;color:var(--cc-ink-3)}
.dpt-cc-btn[data-danger]{color:var(--cc-bad);border-color:color-mix(in srgb,var(--cc-bad) 40%,transparent)}
.dpt-cc-btn[data-danger]:hover:not(:disabled){background:color-mix(in srgb,var(--cc-bad) 10%,transparent)}
.dpt-cc-actions{flex-wrap:wrap;justify-content:flex-end}
.dpt-cards{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;box-sizing:border-box;width:100%;margin:4px 0 6px;container-type:inline-size}
.dpt-cards>.dpt-cc{grid-column:span 6;display:flex;flex-direction:column}
.dpt-cards>.dpt-cc[data-size="half"]{grid-column:span 3}
.dpt-cards>.dpt-cc[data-size="third"]{grid-column:span 2}
.dpt-cc>.dpt-cc-body{flex:1}
.dpt-cc[data-size="third"] .dpt-cc-stats{grid-template-columns:repeat(auto-fit,minmax(76px,1fr));gap:6px}
.dpt-cc[data-size="third"] .dpt-cc-stat{padding:8px 10px}
.dpt-cc[data-size="third"] .dpt-cc-stat-value{font-size:18px;line-height:24px}
@container (max-width:620px){.dpt-cards>.dpt-cc[data-size="third"]{grid-column:span 3}}
@container (max-width:460px){.dpt-cards>.dpt-cc[data-size]{grid-column:span 6}}
.dpt-pv{--cc-surface:var(--dsw-static-neutral-50,#f8f9fb);--cc-raised:var(--dsw-alias-bg-base,#fff);--cc-line:var(--dsw-alias-border-l1,#e6e9ef);--cc-ink:var(--dsw-alias-label-primary,#101828);--cc-ink-2:var(--dsw-alias-label-secondary,#4a5565);--cc-ink-3:var(--dsw-alias-label-tertiary,#667085);--cc-track:color-mix(in srgb,var(--cc-ink) 7%,transparent);--cc-s1:#2a78d6;--cc-good:#0ca30c;--cc-warn:#c98500;--cc-bad:#d03b3b;box-sizing:border-box;width:100%;align-self:stretch;flex:1 1 auto;min-height:0;overflow:auto;max-width:920px;margin:0 auto;padding:20px 20px 40px;color:var(--cc-ink);font-size:13px;line-height:20px;container-type:inline-size}
${DARK} .dpt-pv{--cc-surface:var(--dsw-static-neutral-850,#1b1f27);--cc-raised:color-mix(in srgb,#fff 4%,var(--cc-surface));--cc-track:color-mix(in srgb,#fff 9%,transparent);--cc-s1:#3987e5}
.dpt-pv-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dpt-pv-title{margin:0;font-size:18px;line-height:26px;font-weight:600;letter-spacing:-.01em}
.dpt-pv-sub{margin:2px 0 0;font-size:12px;color:var(--cc-ink-3);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dpt-pv-intro{margin:10px 0 0;max-width:640px;font-size:12.5px;line-height:19px;color:var(--cc-ink-2)}
.dpt-pv-warn{margin:10px 0 0;font-size:12px;color:var(--cc-warn)}
.dpt-pv-group{margin-top:22px;display:flex;flex-direction:column;gap:10px}
.dpt-pv-tally{font-weight:400;color:var(--cc-ink-3);font-variant-numeric:tabular-nums}
.dpt-pv-cats{display:flex;flex-wrap:wrap;gap:6px}
.dpt-pv-cat{height:24px;padding:0 10px;border-radius:999px;border:.5px solid var(--cc-line);background:var(--cc-raised);color:var(--cc-ink-2);font:inherit;font-size:11.5px;cursor:pointer}
.dpt-pv-cat[aria-checked="true"]{border-color:var(--cc-s1);color:var(--cc-ink);box-shadow:0 0 0 .5px var(--cc-s1) inset}
.dpt-pv-cat:focus-visible{outline:2px solid var(--cc-s1);outline-offset:1px}
.dpt-pv-group-title{display:flex;align-items:center;gap:8px;margin:0;font-size:12px;font-weight:600;letter-spacing:.02em;color:var(--cc-ink-2)}
.dpt-pv-count{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 5px;box-sizing:border-box;border-radius:999px;background:var(--cc-s1);color:#fff;font-size:11px}
.dpt-pv-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;align-items:start}
@container (max-width:640px){.dpt-pv-grid{grid-template-columns:minmax(0,1fr)}}
.dpt-pv-card,.dpt-pv-proposal{box-sizing:border-box;display:flex;flex-direction:column;gap:10px;padding:14px 16px;border:.5px solid var(--dsw-alias-border-l2,#d9dee7);border-radius:12px;background:var(--cc-surface)}
.dpt-pv-proposal{background:var(--cc-raised);border-color:color-mix(in srgb,var(--cc-s1) 40%,var(--cc-line))}
.dpt-pv-card[data-kind="features"],.dpt-pv-card[data-kind="requirements"]{background:var(--cc-raised)}
.dpt-pv-grid>.dpt-pv-card:only-child{grid-column:1/-1}
.dpt-pv-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dpt-pv-card-titles{display:flex;flex-direction:column;gap:1px;min-width:0}
.dpt-pv-card-title{font-size:14px;font-weight:600;line-height:20px;overflow-wrap:anywhere}
.dpt-pv-meta{font-size:11.5px;line-height:16px;color:var(--cc-ink-3)}
.dpt-pv-card-actions{display:flex;gap:12px;flex:none}
.dpt-pv-link{padding:0;border:0;background:none;color:var(--cc-ink-3);font:inherit;font-size:12px;cursor:pointer}
.dpt-pv-link:hover{color:var(--cc-ink)}
.dpt-pv-link:focus-visible,.dpt-pv-add:focus-visible,.dpt-pv-version:focus-visible{outline:2px solid var(--cc-s1);outline-offset:2px;border-radius:4px}
.dpt-pv-items{margin:0;padding:0;list-style:none;display:flex;flex-direction:column}
.dpt-pv-item{display:grid;grid-template-columns:34px minmax(0,1fr) auto;gap:8px;align-items:start;padding:6px 0;border-top:.5px solid var(--cc-line)}
.dpt-pv-item:first-child{border-top:0;padding-top:0}
.dpt-pv-item .dpt-pv-link{opacity:0;transition:opacity 120ms}
.dpt-pv-item:hover .dpt-pv-link,.dpt-pv-item .dpt-pv-link:focus-visible{opacity:1}
.dpt-pv-id{padding-top:1px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11.5px;line-height:19px;color:var(--cc-ink-3)}
.dpt-pv-id[data-new]{color:var(--cc-s1)}
.dpt-pv-item-main{display:flex;flex-direction:column;gap:4px;min-width:0}
.dpt-pv-item-text{font-size:13px;line-height:20px;overflow-wrap:anywhere}
.dpt-pv-item[data-status="superseded"] .dpt-pv-item-text,.dpt-pv-item[data-status="done"] .dpt-pv-item-text{color:var(--cc-ink-3)}
.dpt-pv-status{align-self:flex-start;padding:0 7px;border-radius:999px;background:var(--cc-track);font-size:11px;line-height:18px;color:var(--cc-ink-2)}
.dpt-pv-item[data-diff="added"]{box-shadow:inset 2px 0 0 var(--cc-good)}
.dpt-pv-item[data-diff="changed"]{box-shadow:inset 2px 0 0 var(--cc-s1)}
.dpt-pv-item[data-diff="removed"]{box-shadow:inset 2px 0 0 var(--cc-bad)}
.dpt-pv-item[data-diff] .dpt-pv-id{padding-left:8px}
.dpt-pv-item[data-diff="removed"] .dpt-pv-item-text,.dpt-pv-old{color:var(--cc-ink-3);text-decoration:line-through;text-decoration-color:color-mix(in srgb,var(--cc-bad) 60%,transparent)}
.dpt-pv-old{font-size:12px;line-height:18px}
.dpt-pv-ask{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.dpt-pv-ask .dpt-cc-input{flex:1;min-width:160px}
.dpt-pv-editor{display:flex;flex-direction:column;gap:10px}
.dpt-pv-title-input{width:100%;font-weight:600}
.dpt-pv-textarea{box-sizing:border-box;width:100%;min-height:30px;padding:5px 9px;border-radius:8px;border:.5px solid var(--dsw-alias-border-l3,#c9d0db);background:var(--cc-raised);color:var(--cc-ink);font:inherit;font-size:13px;line-height:19px;resize:vertical}
.dpt-pv-textarea:focus{outline:2px solid color-mix(in srgb,var(--cc-s1) 55%,transparent);outline-offset:0;border-color:var(--cc-s1)}
.dpt-pv-editor .dpt-pv-item .dpt-pv-link{opacity:1;font-size:15px;line-height:28px}
.dpt-pv-add{align-self:flex-start;padding:4px 0;border:0;background:none;color:var(--cc-s1);font:inherit;font-size:12.5px;cursor:pointer}
.dpt-pv-editor-foot{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding-top:8px;border-top:.5px solid var(--cc-line)}
.dpt-pv-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--cc-ink-2);cursor:pointer}
.dpt-pv-check input{accent-color:var(--cc-s1)}
.dpt-pv-history{display:flex;flex-direction:column;gap:10px}
.dpt-pv-versions{display:flex;gap:6px;flex-wrap:wrap}
.dpt-pv-version{display:inline-flex;gap:6px;align-items:baseline;height:24px;padding:0 9px;border-radius:999px;border:.5px solid var(--cc-line);background:var(--cc-raised);color:var(--cc-ink-2);font:inherit;font-size:11.5px;cursor:pointer}
.dpt-pv-version span{color:var(--cc-ink-3)}
.dpt-pv-version[aria-selected="true"]{border-color:var(--cc-s1);color:var(--cc-ink)}
.dpt-pv-empty{margin-top:20px;padding:28px 24px;border:.5px dashed var(--dsw-alias-border-l3,#c9d0db);border-radius:12px;display:flex;flex-direction:column;align-items:flex-start;gap:4px}
.dpt-pv-empty .dpt-cc-actions{margin:12px 0 0}
.dpt-pv-empty-title{margin:0;font-size:14px;font-weight:600}
.dpt-pv-empty-line{margin:0;font-size:12.5px;color:var(--cc-ink-3)}
.dpt-pv .dpt-cc-actions{margin-left:0}
.dpt-sortable{position:relative;transition:opacity 120ms}
.dpt-sortable+.dpt-sortable>.dpt-side-section{border-top:1px solid var(--dpt-line);padding-top:10px}
.dpt-sortable[data-dragging]{opacity:.45}
.dpt-sortable[data-dragging] .dpt-grip{cursor:grabbing;opacity:1}
.dpt-sortable[data-drop]::before{content:"";position:absolute;left:14px;right:14px;height:2px;border-radius:2px;background:var(--dpt-accent,#3370ff);z-index:1}
.dpt-sortable[data-drop="before"]::before{top:-1px}
.dpt-sortable[data-drop="after"]::before{bottom:-1px}
.dpt-grip{position:absolute;left:1px;top:1px;z-index:1;display:grid;place-items:center;width:12px;height:18px;padding:0;border:0;border-radius:4px;background:none;color:var(--dsw-alias-label-tertiary,#667085);cursor:grab;opacity:0;touch-action:none;transition:opacity 120ms}
.dpt-sortable+.dpt-sortable>.dpt-grip{top:11px}
.dpt-sortable:hover>.dpt-grip,.dpt-grip:focus-visible{opacity:.8}
.dpt-grip:hover{opacity:1;background:var(--dsw-alias-interactive-bg-hover,rgba(16,24,40,.05))}
.dpt-grip:active{cursor:grabbing}
.dpt-grip:focus-visible{outline:2px solid var(--dpt-accent,#3370ff);outline-offset:1px}
.dpt-cc-errors{margin:0;padding:8px 14px 10px;border-top:.5px solid var(--cc-line);font-size:12px;line-height:18px;color:var(--cc-bad);list-style:none}
.dpt-cc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:520px){.dpt-cc-donut svg{width:88px;height:88px}.dpt-cc-bar-label{max-width:96px}}
@media (prefers-reduced-motion:reduce){.dpt-cc,.dpt-cc *,.dpt-cc *::after,.dpt-cc *::before{animation:none!important;transition:none!important}}
@media (prefers-reduced-motion:reduce){
  ${ON} :is(${COMPOSER},[data-dpt-send],${BUBBLE},[data-row-key^="session:"]),${ON} ${COMPOSER}::before,${ON} ${COMPOSER}::after,${ON} [data-dpt-send]::after{animation:none !important;transition:none !important}
}
`;

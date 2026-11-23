// Kept for presets published before 2.5.0: their row registers the tool in its own scope. The tool is now
// registered at profile level (lib/virtual-dsh.mjs), so deep creative mode reaches running conversations.
import { virtualRuntime, virtualToolDefinition } from './virtual-dsh.mjs';

export const name = 'deep-ptc-virtual-dsh-tool';
export const inject = ['tools'];

export function apply(ctx) {
  ctx.effect(() => ctx.tools.register(virtualToolDefinition(virtualRuntime, { approval: () => ctx.get?.('approval') ?? ctx.approval })), 'Deep PTC: virtual DSH tool');
}

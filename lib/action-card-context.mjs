// Runtime for the Deep PTC action card.
//
// One generic kind, registered with the host's action-cards service, backs every
// small card the user asks for. The card's one verb really runs here: it deletes
// the scheduled tasks the card names and runs its command. The kind is optional:
// a missing host service turns the card off instead of rejecting the preset.

import { exec } from 'node:child_process';
import { CARD_ACTION, CARD_INVITATION, CARD_SKILL, CARD_SKILL_REGISTRATION, CARD_STOP, cardDetails } from './action-card.mjs';

export const name = 'deep-ptc-action-card';
// Optional layer: a missing service disables the card rather than rejecting the preset.
export const inject = [];
const REQUIRED = ['actionCards', 'skills'];
const STOP_TIMEOUT_MS = 30_000;
const MAX_REASON = 300;

const failure = reason => ({ status: 'refused', reason });

export function apply(ctx) {
  // Starts once the host services exist; the caller never holds the boot for it.
  return ctx.plugin({ name: 'deep-ptc-action-card-layer', inject: REQUIRED, apply: install }).await()
    .catch(error => ctx.logger.warn('Deep PTC: action cards are off (%s)', error.message));
}

function install(ctx) {
  ctx.effect(() => ctx.actionCards.register({
    action: CARD_ACTION,
    skill: CARD_SKILL,
    invitation: CARD_INVITATION,
    details: cardDetails,
    // The one verb writes: a read-only sandbox refuses it before we run anything.
    verbs: { [CARD_STOP]: { writes: true } },
    statusFields: ['schedules', 'command', 'errors'],
    act: (agent, card, verb) => stop(ctx, agent, card, verb),
  }), 'Deep PTC: action card kind');
  ctx.effect(() => ctx.skills.register(CARD_SKILL_REGISTRATION), 'Deep PTC: action card skill');
}

/** Run the card's action, then record what really happened for the next model request. */
async function stop(ctx, agent, card, verb) {
  if (verb !== CARD_STOP) return failure('unavailable');
  const stop = card.details.stop;
  if (stop === undefined) return failure('unavailable');
  const data = { schedules: [] };
  const errors = [];
  const schedule = stop.schedules === undefined ? undefined : ctx.get('schedule');
  for (const id of stop.schedules ?? []) {
    if (schedule === undefined) {
      errors.push('schedule service unavailable');
      break;
    }
    try {
      await schedule.edit({ id, action: 'delete' }, agent.id);
      data.schedules.push(id);
    } catch (error) {
      errors.push('schedule ' + id + ': ' + reason(error));
      ctx.logger.warn('Deep PTC: could not delete schedule %s (%s)', id, error.message);
    }
  }
  if (stop.command !== undefined) {
    try {
      await run(stop.command);
      data.command = 'ok';
    } catch (error) {
      data.command = 'failed';
      errors.push('command: ' + reason(error));
      ctx.logger.warn('Deep PTC: card command failed (%s)', error.message);
    }
  }
  if (errors.length > 0) data.errors = errors;
  const decision = { callId: card.callId, action: CARD_ACTION,
    phase: errors.length === 0 ? 'stopped' : 'failed', data };
  ctx.actionCards.record(agent, decision);
  return { status: 'settled', decision };
}

function reason(error) {
  return String(error?.message ?? error).trim().slice(0, MAX_REASON);
}

function run(command) {
  return new Promise((resolve, reject) => {
    exec(command, { timeout: STOP_TIMEOUT_MS, windowsHide: true, maxBuffer: 1 << 20 }, (error, _stdout, stderr) => {
      if (error === null) resolve();
      else reject(new Error(String(stderr ?? '').trim().split('\n')[0].slice(0, MAX_REASON) || error.message));
    });
  });
}

import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { sweep } from './preview.mjs';

/**
 * Where virtual homes live. Not the system's temporary directory on Windows: its cleanup deletes files by
 * age, and copied files keep their age, so it took the sign-in, skills and packages of a running one. AppData is redirected for packaged apps.
 */
export function virtualBase(platform = process.platform) {
  return platform === 'win32' ? join(homedir(), '.dsh-virtual') : tmpdir();
}

/** Leftovers in today's place and in the temporary directory earlier versions used. */
export function sweepAll() {
  return [...new Set([virtualBase(), tmpdir()])].flatMap(base => sweep(base));
}

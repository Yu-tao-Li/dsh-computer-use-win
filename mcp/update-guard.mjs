// Before the plugin market replaces this package, nothing may hold a file or a
// working folder inside it. pnpm stages the new build beside the old one; when
// the final rename is refused it empties the old folder and tries again, and
// with something still open there the second rename fails too. The old build
// is then half deleted, and the market drops the plugin from the profile
// ("the running host holds its files open", seen on DSH Desktop on 2026-11-05
// and 2026-11-22). The settings page asks this route first. Renaming the folder
// away and straight back is the operation pnpm needs, without its cost: when it
// works, nothing holds the folder at that moment; when Windows refuses it,
// nothing has moved, and the page does not start the update.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { trustedRequest } from './diagnostics.mjs';

export const UPDATE_READY_ROUTE = '/dsh-computer-use-win/api/update-ready';
export const PLUGIN_ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// { ready, checked, code? }. Only a package the market installed (one inside
// node_modules) is replaced by an update; a linked checkout is left to its owner.
export async function probeReplaceable(root = PLUGIN_ROOT, { rename = fs.renameSync, wait = sleep, logger } = {}) {
  if (path.basename(path.dirname(root)).toLowerCase() !== 'node_modules') return { ready: true, checked: false };
  const aside = `${root}.wcu-update-check-${process.pid}`;
  try { rename(root, aside); }
  catch (error) { return { ready: false, checked: true, code: String(error?.code || 'ERROR') }; }
  // Back in the same moment. Something that opened a file in the moved folder
  // meanwhile (an indexer, a scanner) lets go shortly; DSH needs the folder
  // back, so it keeps trying for a minute without blocking the host.
  for (let attempt = 1; ; attempt++) {
    try { rename(aside, root); return { ready: true, checked: true }; }
    catch (error) {
      if (attempt === 1) logger?.warn?.('dsh-computer-use-win: the update check is putting the plugin folder back: %s', error?.message ?? error);
      if (attempt >= 600) throw error;
      await wait(attempt < 40 ? 25 : 100);
    }
  }
}

export function createUpdateReadyHandler({ probe = probeReplaceable, logger } = {}) {
  return async (request, response) => {
    const send = (status, data) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      response.end(JSON.stringify(data));
    };
    if (!trustedRequest(request)) return send(403, { ok: false });
    if (request.method !== 'POST') return send(405, { ok: false });
    try {
      const result = await probe(PLUGIN_ROOT, { logger });
      if (!result.ready) logger?.warn?.('dsh-computer-use-win: an update was not started: something holds the plugin folder open (%s)', result.code);
      send(200, { ok: true, ...result });
    } catch (error) {
      logger?.error?.('dsh-computer-use-win: the update check could not put the plugin folder back: %s', error?.message ?? error);
      send(500, { ok: false, error: String(error?.message || error).slice(0, 300) });
    }
  };
}

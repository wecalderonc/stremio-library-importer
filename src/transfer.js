#!/usr/bin/env node
import 'dotenv/config';
import {
  login,
  datastoreGet,
  datastorePut,
  maskAuthKey,
} from './stremio-api.js';

const BATCH_SIZE = 50;

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
  };
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return String(value).trim();
}

function isActiveLibraryItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.removed === true) return false;
  if (item.temp === true) return false;
  const id = item._id || item.id;
  return Boolean(id);
}

/**
 * Normalize a source library item into a payload suitable for datastorePut.
 * Keeps watch state; refreshes _mtime so the target sync picks it up.
 */
function toPutPayload(item) {
  const now = new Date().toISOString();
  const id = item._id || item.id;

  const payload = {
    _id: id,
    name: item.name ?? '',
    type: item.type ?? 'movie',
    poster: item.poster ?? null,
    posterShape: item.posterShape ?? 'poster',
    removed: false,
    temp: false,
    _ctime: item._ctime ?? now,
    _mtime: now,
    state: item.state ?? {
      lastWatched: null,
      timeWatched: 0,
      timeOffset: 0,
      overallTimeWatched: 0,
      timesWatched: 0,
      flaggedWatched: 0,
      duration: 0,
      video_id: null,
      watched: null,
      noNotif: false,
    },
  };

  if (item.background !== undefined) payload.background = item.background;
  if (item.logo !== undefined) payload.logo = item.logo;
  if (item.year !== undefined) payload.year = item.year;
  if (item.behaviorHints !== undefined) payload.behaviorHints = item.behaviorHints;

  return payload;
}

function summarizeItem(item) {
  const id = item._id || item.id || '?';
  const name = item.name || '(untitled)';
  const type = item.type || '?';
  return `${name} [${type}] (${id})`;
}

function chunk(array, size) {
  const out = [];
  for (let i = 0; i < array.length; i += size) {
    out.push(array.slice(i, i + size));
  }
  return out;
}

async function main() {
  const { dryRun } = parseArgs(process.argv.slice(2));

  const sourceEmail = requireEnv('SOURCE_EMAIL');
  const sourcePassword = requireEnv('SOURCE_PASSWORD');
  const targetEmail = requireEnv('TARGET_EMAIL');
  const targetPassword = requireEnv('TARGET_PASSWORD');

  if (sourceEmail.toLowerCase() === targetEmail.toLowerCase()) {
    throw new Error('SOURCE_EMAIL and TARGET_EMAIL must be different accounts');
  }

  console.log(dryRun ? 'Mode: dry-run (no writes)' : 'Mode: transfer');
  console.log(`Source: ${sourceEmail}`);
  console.log(`Target: ${targetEmail}`);
  console.log('');

  console.log('Logging into source account…');
  const source = await login(sourceEmail, sourcePassword);
  console.log(`  authKey ${maskAuthKey(source.authKey)}`);

  console.log('Fetching source library…');
  const allItems = await datastoreGet(source.authKey);
  const active = allItems.filter(isActiveLibraryItem);
  const skippedRemoved = allItems.length - active.length;

  console.log(`  total items: ${allItems.length}`);
  console.log(`  active (will transfer): ${active.length}`);
  console.log(`  skipped (removed/temp): ${skippedRemoved}`);
  console.log('');

  if (active.length === 0) {
    console.log('Nothing to transfer.');
    return;
  }

  const previewLimit = Math.min(active.length, 25);
  console.log(`Preview (first ${previewLimit}):`);
  for (const item of active.slice(0, previewLimit)) {
    console.log(`  - ${summarizeItem(item)}`);
  }
  if (active.length > previewLimit) {
    console.log(`  … and ${active.length - previewLimit} more`);
  }
  console.log('');

  if (dryRun) {
    console.log('Dry-run complete. Re-run without --dry-run to write to the target account.');
    return;
  }

  console.log('Logging into target account…');
  const target = await login(targetEmail, targetPassword);
  console.log(`  authKey ${maskAuthKey(target.authKey)}`);

  const changes = active.map(toPutPayload);
  const batches = chunk(changes, BATCH_SIZE);

  let ok = 0;
  let failed = 0;

  console.log(`Writing ${changes.length} items in ${batches.length} batch(es)…`);
  for (let i = 0; i < batches.length; i++) {
    const batch = batches[i];
    try {
      await datastorePut(target.authKey, batch);
      ok += batch.length;
      console.log(`  batch ${i + 1}/${batches.length}: ok (${batch.length} items)`);
    } catch (err) {
      failed += batch.length;
      console.error(
        `  batch ${i + 1}/${batches.length}: FAILED — ${err.message}`
      );
    }
  }

  console.log('');
  console.log('Summary');
  console.log(`  transferred: ${ok}`);
  console.log(`  failed:      ${failed}`);
  console.log(`  skipped:     ${skippedRemoved}`);

  if (failed > 0) {
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(`\nError: ${err.message}`);
  process.exitCode = 1;
});

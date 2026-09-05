const CINEMETA_BASE = 'https://v3-cinemeta.strem.io';
const STREAM_TIMEOUT_MS = 12_000;
const META_TIMEOUT_MS = 10_000;
const DEFAULT_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
];

/**
 * @param {string} id
 */
function encodeStreamId(id) {
  return String(id).replace(/[?#%]/g, (ch) => encodeURIComponent(ch));
}

/**
 * @param {string} transportUrl
 */
export function addonBaseUrl(transportUrl) {
  return String(transportUrl || '')
    .replace(/\/manifest\.json$/i, '')
    .replace(/\/$/, '');
}

/**
 * @param {object} manifest
 * @param {string} resourceName
 */
function getResource(manifest, resourceName) {
  const resources = manifest?.resources || [];
  for (const resource of resources) {
    if (resource === resourceName) {
      return {
        name: resourceName,
        types: manifest.types,
        idPrefixes: manifest.idPrefixes,
      };
    }
    if (resource && resource.name === resourceName) {
      return {
        name: resourceName,
        types: resource.types || manifest.types,
        idPrefixes: resource.idPrefixes || manifest.idPrefixes,
      };
    }
  }
  return null;
}

/**
 * @param {object} addon
 * @param {string} resourceName
 * @param {string} type
 * @param {string} id
 */
export function addonSupports(addon, resourceName, type, id) {
  const manifest = addon?.manifest;
  if (!manifest) return false;
  const resource = getResource(manifest, resourceName);
  if (!resource) return false;
  if (resource.types?.length && !resource.types.includes(type)) return false;
  if (
    resource.idPrefixes?.length &&
    !resource.idPrefixes.some((prefix) => String(id).startsWith(prefix))
  ) {
    return false;
  }
  return true;
}

/**
 * @param {string} transportUrl
 * @param {string} resource
 * @param {string} type
 * @param {string} id
 */
export function addonResourceUrl(transportUrl, resource, type, id) {
  const base = addonBaseUrl(transportUrl);
  if (!base) return null;
  return `${base}/${resource}/${type}/${encodeStreamId(id)}.json`;
}

async function fetchJson(url, timeoutMs) {
  const response = await fetch(url, {
    headers: { accept: 'application/json', 'user-agent': 'stremio-library-importer' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Detailed metadata (episodes for series) from Cinemeta, then the user's meta addons.
 * @param {object[]} addons
 * @param {string} type
 * @param {string} id
 */
export async function getMeta(addons, type, id) {
  const attempts = [
    `${CINEMETA_BASE}/meta/${type}/${encodeStreamId(id)}.json`,
    ...addons
      .filter((addon) => addonSupports(addon, 'meta', type, id))
      .map((addon) => addonResourceUrl(addon.transportUrl, 'meta', type, id))
      .filter(Boolean),
  ];

  const seen = new Set();
  for (const url of attempts) {
    if (seen.has(url)) continue;
    seen.add(url);
    try {
      const payload = await fetchJson(url, META_TIMEOUT_MS);
      if (payload?.meta) return payload.meta;
    } catch {
      // try next source
    }
  }
  return null;
}

/**
 * @param {object} stream
 * @returns {string|null}
 */
export function streamToMagnet(stream) {
  if (stream?.url && String(stream.url).startsWith('magnet:')) {
    return stream.url;
  }
  const infoHash = normalizeInfoHash(stream?.infoHash);
  if (!infoHash) return null;

  const name =
    stream.behaviorHints?.filename ||
    stream.description ||
    stream.title ||
    stream.name ||
    'download';
  const params = [`xt=urn:btih:${infoHash}`, `dn=${encodeURIComponent(name)}`];
  const trackers = new Set(DEFAULT_TRACKERS);

  for (const source of [...(stream.sources || []), ...(stream.announce || [])]) {
    if (typeof source !== 'string') continue;
    if (source.startsWith('tracker:')) {
      trackers.add(source.slice('tracker:'.length));
    } else if (
      source.startsWith('http://') ||
      source.startsWith('https://') ||
      source.startsWith('udp://')
    ) {
      trackers.add(source);
    }
  }

  for (const tracker of trackers) {
    params.push(`tr=${encodeURIComponent(tracker)}`);
  }

  if (Number.isInteger(stream.fileIdx) && stream.fileIdx >= 0) {
    params.push(`so=${stream.fileIdx}`);
  }

  return `magnet:?${params.join('&')}`;
}

/**
 * @param {unknown} value
 */
export function normalizeInfoHash(value) {
  if (typeof value !== 'string') return null;
  const hex = value.trim().toLowerCase();
  if (/^[a-f0-9]{40}$/.test(hex)) return hex;
  return null;
}

/**
 * @param {object} stream
 */
export function isTorrentStream(stream) {
  if (!stream || typeof stream !== 'object') return false;
  if (normalizeInfoHash(stream.infoHash)) return true;
  if (typeof stream.url === 'string' && stream.url.startsWith('magnet:')) return true;
  if (typeof stream.url === 'string' && /\.torrent(\?|#|$)/i.test(stream.url)) return true;
  return false;
}

function infoHashFromMagnet(magnet) {
  const match = String(magnet).match(/xt=urn:btih:([a-fA-F0-9]{40})/i);
  return match ? match[1].toLowerCase() : null;
}

function torrentFileUrl(stream) {
  if (typeof stream.url === 'string' && /^https?:\/\//i.test(stream.url) && /\.torrent(\?|#|$)/i.test(stream.url)) {
    return stream.url;
  }
  return null;
}

/**
 * @param {object} stream
 * @param {object} addon
 */
export function serializeStream(stream, addon) {
  const magnet = streamToMagnet(stream);
  const infoHash =
    normalizeInfoHash(stream.infoHash) || (magnet ? infoHashFromMagnet(magnet) : null);
  return {
    addonId: addon?.manifest?.id || null,
    addonName: addon?.manifest?.name || 'Addon',
    name: stream.name || null,
    title: stream.title || null,
    description: stream.description || null,
    infoHash,
    fileIdx: Number.isInteger(stream.fileIdx) ? stream.fileIdx : null,
    magnet,
    torrentUrl: torrentFileUrl(stream),
    filename: stream.behaviorHints?.filename || null,
  };
}

/**
 * Query every installed stream addon for torrent sources.
 * @param {object[]} addons
 * @param {string} type
 * @param {string} id
 */
export async function getTorrentStreams(addons, type, id) {
  const candidates = addons.filter((addon) => addonSupports(addon, 'stream', type, id));
  const results = await Promise.allSettled(
    candidates.map(async (addon) => {
      const url = addonResourceUrl(addon.transportUrl, 'stream', type, id);
      if (!url) throw new Error('missing transportUrl');
      const payload = await fetchJson(url, STREAM_TIMEOUT_MS);
      const streams = Array.isArray(payload?.streams) ? payload.streams : [];
      return streams.filter(isTorrentStream).map((stream) => serializeStream(stream, addon));
    })
  );

  const streams = [];
  let failed = 0;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      streams.push(...result.value);
    } else {
      failed += 1;
    }
  }

  const seen = new Set();
  const unique = [];
  for (const stream of streams) {
    const key = stream.infoHash || stream.magnet || stream.torrentUrl;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    unique.push(stream);
  }

  return {
    streams: unique,
    queried: candidates.length,
    failed,
  };
}

#!/usr/bin/env node
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import {
  login,
  logout,
  datastoreGet,
  addonCollectionGet,
} from '../stremio-api.js';
import { getMeta, getTorrentStreams, normalizeInfoHash } from '../streams.js';

const PORT = Number(process.env.PORT) || 3456;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = fileURLToPath(new URL('./public', import.meta.url));
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** @type {Map<string, { authKey: string, user: object, addons: object[], expiresAt: number }>} */
const sessions = new Map();

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(payload);
}

function text(res, status, body, headers = {}) {
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    ...headers,
  });
  res.end(body);
}

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    'set-cookie',
    `sid=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('set-cookie', 'sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
}

function getSession(req) {
  const sid = parseCookies(req.headers.cookie).sid;
  if (!sid) return null;
  const session = sessions.get(sid);
  if (!session) return null;
  if (Date.now() > session.expiresAt) {
    sessions.delete(sid);
    return null;
  }
  return { sid, ...session };
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    json(res, 401, { error: 'Not signed in' });
    return null;
  }
  return session;
}

function isActiveLibraryItem(item) {
  if (!item || typeof item !== 'object') return false;
  if (item.removed === true || item.temp === true) return false;
  return Boolean(item._id || item.id);
}

function publicUser(user) {
  if (!user || typeof user !== 'object') return { email: null };
  return {
    email: user.email || null,
    avatar: user.avatar || null,
  };
}

function publicLibraryItem(item) {
  const state = item.state || {};
  return {
    id: item._id || item.id,
    name: item.name || '(untitled)',
    type: item.type || 'movie',
    poster: item.poster || null,
    background: item.background || null,
    year: item.year || null,
    lastWatched: state.lastWatched || null,
    videoId: state.video_id || null,
    timeOffset: state.timeOffset || 0,
    duration: state.duration || 0,
    flaggedWatched: Boolean(state.flaggedWatched),
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
    if (Buffer.concat(chunks).length > 1_000_000) {
      throw new Error('Request body too large');
    }
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  return JSON.parse(raw);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let pathname = url.pathname === '/' ? '/index.html' : url.pathname;
  if (pathname.includes('..')) {
    text(res, 400, 'Bad path');
    return;
  }
  const filePath = join(PUBLIC_DIR, pathname);
  try {
    const data = await readFile(filePath);
    const type = MIME[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(data);
  } catch {
    if (pathname !== '/index.html') {
      const data = await readFile(join(PUBLIC_DIR, 'index.html'));
      res.writeHead(200, { 'content-type': MIME['.html'] });
      res.end(data);
      return;
    }
    text(res, 404, 'Not found');
  }
}

function parseRoute(pathname) {
  const meta = pathname.match(/^\/api\/meta\/([^/]+)\/(.+)$/);
  if (meta) return { name: 'meta', type: decodeURIComponent(meta[1]), id: decodeURIComponent(meta[2]) };
  const streams = pathname.match(/^\/api\/streams\/([^/]+)\/(.+)$/);
  if (streams) {
    return {
      name: 'streams',
      type: decodeURIComponent(streams[1]),
      id: decodeURIComponent(streams[2]),
    };
  }
  return { name: pathname };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const route = parseRoute(url.pathname);

  if (req.method === 'POST' && url.pathname === '/api/login') {
    let body;
    try {
      body = await readBody(req);
    } catch {
      json(res, 400, { error: 'Invalid JSON' });
      return;
    }
    const email = String(body.email || '').trim();
    const password = String(body.password || '');
    if (!email || !password) {
      json(res, 400, { error: 'Email and password are required' });
      return;
    }
    try {
      const result = await login(email, password);
      const addons = await addonCollectionGet(result.authKey);
      const sid = randomBytes(24).toString('hex');
      sessions.set(sid, {
        authKey: result.authKey,
        user: result.user || { email },
        addons,
        expiresAt: Date.now() + SESSION_TTL_MS,
      });
      setSessionCookie(res, sid);
      json(res, 200, {
        user: publicUser(result.user || { email }),
        addonCount: addons.length,
      });
    } catch (err) {
      json(res, 401, { error: err.message || 'Login failed' });
    }
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/shutdown') {
    json(res, 200, { ok: true });
    setTimeout(() => {
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 400);
    }, 50);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/logout') {
    const session = getSession(req);
    if (session) {
      sessions.delete(session.sid);
      await logout(session.authKey);
    }
    clearSessionCookie(res);
    json(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/session') {
    const session = getSession(req);
    if (!session) {
      json(res, 200, { user: null });
      return;
    }
    json(res, 200, {
      user: publicUser(session.user),
      addonCount: session.addons.length,
    });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/library') {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      const items = (await datastoreGet(session.authKey))
        .filter(isActiveLibraryItem)
        .map(publicLibraryItem)
        .sort((a, b) => {
          const aTime = a.lastWatched ? Date.parse(a.lastWatched) : 0;
          const bTime = b.lastWatched ? Date.parse(b.lastWatched) : 0;
          return bTime - aTime;
        });
      json(res, 200, { items });
    } catch (err) {
      json(res, 502, { error: err.message || 'Failed to load library' });
    }
    return;
  }

  if (req.method === 'GET' && route.name === 'meta') {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      const meta = await getMeta(session.addons, route.type, route.id);
      json(res, 200, { meta });
    } catch (err) {
      json(res, 502, { error: err.message || 'Failed to load metadata' });
    }
    return;
  }

  if (req.method === 'GET' && route.name === 'streams') {
    const session = requireSession(req, res);
    if (!session) return;
    try {
      const result = await getTorrentStreams(session.addons, route.type, route.id);
      json(res, 200, result);
    } catch (err) {
      json(res, 502, { error: err.message || 'Failed to load streams' });
    }
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/torrent') {
    const session = requireSession(req, res);
    if (!session) return;
    const infoHash = normalizeInfoHash(url.searchParams.get('infoHash') || '');
    const torrentUrl = url.searchParams.get('torrentUrl') || '';
    const filename = (url.searchParams.get('filename') || infoHash || 'download').replace(
      /[^\w.\- ()[\]]+/g,
      '_'
    );

    const sources = [];
    if (torrentUrl && /^https?:\/\//i.test(torrentUrl) && /\.torrent(\?|#|$)/i.test(torrentUrl)) {
      sources.push(torrentUrl);
    }
    if (infoHash) {
      sources.push(`https://itorrents.org/torrent/${infoHash}.torrent`);
    }
    if (sources.length === 0) {
      json(res, 400, { error: 'No torrent source available' });
      return;
    }

    for (const source of sources) {
      try {
        const response = await fetch(source, {
          headers: { 'user-agent': 'stremio-library-importer' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!response.ok) continue;
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 16 || !buffer.subarray(0, 1).equals(Buffer.from('d'))) continue;
        res.writeHead(200, {
          'content-type': 'application/x-bittorrent',
          'content-disposition': `attachment; filename="${filename}.torrent"`,
          'cache-control': 'no-store',
        });
        res.end(buffer);
        return;
      } catch {
        // try next cache
      }
    }

    json(res, 404, {
      error: 'Could not fetch a .torrent file. Use the magnet link instead.',
    });
    return;
  }

  json(res, 404, { error: 'Not found' });
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      text(res, 405, 'Method not allowed');
      return;
    }
    await serveStatic(req, res);
  } catch (err) {
    if (!res.headersSent) {
      json(res, 500, { error: err.message || 'Server error' });
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Stremio library viewer: http://${HOST}:${PORT}`);
});

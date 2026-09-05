const app = document.getElementById('app');

const state = {
  user: null,
  addonCount: 0,
  items: [],
  filter: 'all',
  query: '',
  email: '',
  error: '',
  loading: false,
  modal: null,
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function posterStyle(url) {
  if (!url || !/^https?:\/\//i.test(url)) return '';
  return `style="background-image:url('${escapeHtml(url)}')"`;
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

function render() {
  if (!state.user) {
    app.innerHTML = `
      <div class="login-page">
        <form class="login-card" id="login-form">
          <h1>Stremio Library</h1>
          <p>Sign in to view saved movies, series, and episodes. Torrent links come from addons already installed on this account.</p>
          ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
          <div class="field">
            <label for="email">Email</label>
            <input id="email" name="email" type="email" autocomplete="username" required value="${escapeHtml(state.email)}" />
          </div>
          <div class="field">
            <label for="password">Password</label>
            <input id="password" name="password" type="password" autocomplete="current-password" required />
          </div>
          <button class="btn" type="submit" ${state.loading ? 'disabled' : ''}>
            ${state.loading ? 'Signing in…' : 'Sign in'}
          </button>
          <button class="btn btn-ghost stop-server" type="button" id="stop-server">Stop server</button>
        </form>
      </div>
    `;
    document.getElementById('login-form').addEventListener('submit', onLogin);
    document.getElementById('stop-server').addEventListener('click', onStopServer);
    return;
  }

  const items = visibleItems();
  app.innerHTML = `
    <header class="topbar">
      <div class="wrap topbar-inner">
        <div>
          <div class="brand">Stremio Library</div>
          <div class="meta">${escapeHtml(state.user.email || '')} · ${state.addonCount} addons</div>
        </div>
        <div class="btn-row">
          <button class="btn btn-ghost" id="logout">Sign out</button>
          <button class="btn btn-ghost" id="stop-server">Stop server</button>
        </div>
      </div>
    </header>
    <main class="wrap">
      <div class="toolbar">
        <input id="search" type="search" placeholder="Search library…" value="${escapeHtml(state.query)}" />
        <div class="chips">
          ${chip('all', 'All')}
          ${chip('movie', 'Movies')}
          ${chip('series', 'Series')}
        </div>
      </div>
      ${state.error ? `<p class="error">${escapeHtml(state.error)}</p>` : ''}
      ${state.loading && !items.length ? `<p class="empty">Loading library…</p>` : ''}
      ${!state.loading && !items.length ? `<p class="empty">No saved titles match this view.</p>` : `<p class="empty" hidden>No saved titles match this view.</p>`}
      <section class="grid">
        ${items.map(cardHtml).join('')}
      </section>
    </main>
    ${state.modal ? modalHtml(state.modal) : ''}
  `;

  document.getElementById('logout').addEventListener('click', onLogout);
  document.getElementById('stop-server').addEventListener('click', onStopServer);
  document.getElementById('search').addEventListener('input', (event) => {
    state.query = event.target.value;
    const grid = document.querySelector('.grid');
    const empty = document.querySelector('main .empty');
    const items = visibleItems();
    if (grid) grid.innerHTML = items.map(cardHtml).join('');
    if (empty) empty.hidden = items.length > 0;
    for (const button of document.querySelectorAll('[data-open]')) {
      button.addEventListener('click', () => openItem(button.dataset.open));
    }
  });
  for (const button of document.querySelectorAll('[data-filter]')) {
    button.addEventListener('click', () => {
      state.filter = button.dataset.filter;
      render();
    });
  }
  for (const button of document.querySelectorAll('[data-open]')) {
    button.addEventListener('click', () => openItem(button.dataset.open));
  }
  bindModal();
}

function chip(id, label) {
  return `<button type="button" class="chip ${state.filter === id ? 'active' : ''}" data-filter="${id}">${label}</button>`;
}

function visibleItems() {
  const query = state.query.trim().toLowerCase();
  return state.items.filter((item) => {
    if (state.filter !== 'all' && item.type !== state.filter) return false;
    if (query && !item.name.toLowerCase().includes(query)) return false;
    return true;
  });
}

function cardHtml(item) {
  const year = item.year ? ` · ${escapeHtml(item.year)}` : '';
  const watched = item.flaggedWatched ? ' · watched' : '';
  return `
    <article class="card">
      <div class="poster" ${posterStyle(item.poster)}>
        <span class="badge">${escapeHtml(item.type)}</span>
      </div>
      <div class="card-body">
        <h3>${escapeHtml(item.name)}</h3>
        <div class="meta">${escapeHtml(item.id)}${year}${watched}</div>
        <button class="btn" data-open="${escapeHtml(item.id)}">
          ${item.type === 'series' ? 'Episodes & torrents' : 'Find torrents'}
        </button>
      </div>
    </article>
  `;
}

function modalHtml(modal) {
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <div class="modal-head">
          <div>
            <h2>${escapeHtml(modal.title)}</h2>
            <div class="meta">${escapeHtml(modal.subtitle || '')}</div>
          </div>
          <button class="btn btn-ghost" id="close-modal">Close</button>
        </div>
        <div class="modal-body">${modal.body}</div>
      </div>
    </div>
  `;
}

function bindModal() {
  const backdrop = document.getElementById('modal-backdrop');
  if (!backdrop) return;
  document.getElementById('close-modal')?.addEventListener('click', closeModal);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) closeModal();
  });
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'Escape') closeModal();
    },
    { once: true }
  );
  for (const button of document.querySelectorAll('[data-episode]')) {
    button.addEventListener('click', () => {
      loadStreams(button.dataset.type, button.dataset.episode, button.dataset.label);
    });
  }
  document.getElementById('find-movie-streams')?.addEventListener('click', () => {
    const button = document.getElementById('find-movie-streams');
    loadStreams(button.dataset.type, button.dataset.id, button.dataset.label);
  });
  for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
      await navigator.clipboard.writeText(button.dataset.copy);
      button.textContent = 'Copied';
      setTimeout(() => {
        button.textContent = 'Copy magnet';
      }, 1200);
    });
  }
}

function closeModal() {
  state.modal = null;
  render();
}

function setModal(title, subtitle, body) {
  state.modal = { title, subtitle, body };
  render();
}

function itemById(id) {
  return state.items.find((item) => item.id === id);
}

async function openItem(id) {
  const item = itemById(id);
  if (!item) return;

  if (item.type !== 'series') {
    setModal(
      item.name,
      `${item.type}${item.year ? ` · ${item.year}` : ''}`,
      `<p class="hint">Streams are requested from this account’s installed addons.</p>
       <button class="btn" id="find-movie-streams" data-type="${escapeHtml(item.type)}" data-id="${escapeHtml(item.id)}" data-label="${escapeHtml(item.name)}">Find torrents</button>`
    );
    return;
  }

  setModal(item.name, 'Loading episodes…', '<p class="hint">Fetching episode list…</p>');
  try {
    const { meta } = await api(`/api/meta/${encodeURIComponent(item.type)}/${encodeURIComponent(item.id)}`);
    const videos = (meta?.videos || []).filter((video) => video && video.id);
    if (!videos.length) {
      setModal(
        item.name,
        'No episode list found',
        `<p class="hint">Metadata did not include episodes. You can still try the series id.</p>
         <button class="btn" id="find-movie-streams" data-type="series" data-id="${escapeHtml(item.id)}" data-label="${escapeHtml(item.name)}">Find torrents</button>`
      );
      return;
    }

    const seasons = new Map();
    for (const video of videos) {
      const season = Number.isInteger(video.season) ? video.season : 0;
      if (!seasons.has(season)) seasons.set(season, []);
      seasons.get(season).push(video);
    }

    const body = [...seasons.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([season, episodes]) => {
        const label = season === 0 ? 'Specials' : `Season ${season}`;
        const rows = episodes
          .sort((a, b) => (a.episode || 0) - (b.episode || 0))
          .map((episode) => {
            const current = item.videoId && episode.id === item.videoId ? ' current' : '';
            const epLabel = episode.episode != null ? `E${episode.episode}` : episode.id;
            const title = episode.title || episode.name || epLabel;
            return `
              <div class="episode${current}">
                <div>
                  <div class="ep-title">${escapeHtml(epLabel)} · ${escapeHtml(title)}</div>
                  <div class="meta">${escapeHtml(episode.id)}</div>
                </div>
                <button class="btn" data-episode="${escapeHtml(episode.id)}" data-type="series" data-label="${escapeHtml(`${item.name} ${epLabel}`)}">Torrents</button>
              </div>
            `;
          })
          .join('');
        return `<section class="season"><h3>${label}</h3>${rows}</section>`;
      })
      .join('');

    setModal(
      item.name,
      `${videos.length} episodes`,
      `<p class="hint">Open an episode to get its torrents, or search the series id for season packs.</p>
       <p><button class="btn" id="find-movie-streams" data-type="series" data-id="${escapeHtml(item.id)}" data-label="${escapeHtml(item.name)}">Series torrents</button></p>
       ${body}`
    );
  } catch (err) {
    setModal(item.name, 'Could not load episodes', `<p class="error">${escapeHtml(err.message)}</p>`);
  }
}

function streamRow(stream) {
  const title = stream.name || stream.filename || 'Torrent';
  const detail = [stream.addonName, stream.description || stream.title, stream.infoHash]
    .filter(Boolean)
    .join(' · ');
  const torrentHref =
    stream.infoHash || stream.torrentUrl
      ? `/api/torrent?infoHash=${encodeURIComponent(stream.infoHash || '')}&torrentUrl=${encodeURIComponent(stream.torrentUrl || '')}&filename=${encodeURIComponent(stream.filename || title)}`
      : '';
  return `
    <article class="stream">
      <div>
        <h4>${escapeHtml(title)}</h4>
        <div class="meta">${escapeHtml(detail)}</div>
      </div>
      <div class="btn-row">
        ${stream.magnet ? `<a class="btn" href="${escapeHtml(stream.magnet)}">Open magnet</a>` : ''}
        ${stream.magnet ? `<button class="btn btn-ghost" data-copy="${escapeHtml(stream.magnet)}">Copy magnet</button>` : ''}
        ${torrentHref ? `<a class="btn btn-ghost" href="${escapeHtml(torrentHref)}">Download .torrent</a>` : ''}
      </div>
    </article>
  `;
}

async function loadStreams(type, id, label) {
  setModal(label || id, 'Searching addons…', '<p class="hint">Asking installed stream addons for torrents…</p>');
  try {
    const result = await api(`/api/streams/${encodeURIComponent(type)}/${encodeURIComponent(id)}`);
    if (!result.streams.length) {
      setModal(
        label || id,
        `No torrents · queried ${result.queried} addons`,
        '<p class="hint">This account’s stream addons did not return a torrent or magnet for this title. Install a torrent stream addon in Stremio and sign in again.</p>'
      );
      return;
    }
    setModal(
      label || id,
      `${result.streams.length} torrents · ${result.queried} addons${result.failed ? ` · ${result.failed} failed` : ''}`,
      result.streams.map(streamRow).join('')
    );
  } catch (err) {
    setModal(label || id, 'Search failed', `<p class="error">${escapeHtml(err.message)}</p>`);
  }
}

async function onLogin(event) {
  event.preventDefault();
  const form = new FormData(event.target);
  state.email = String(form.get('email') || '');
  state.loading = true;
  state.error = '';
  render();
  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: JSON.stringify({
        email: form.get('email'),
        password: form.get('password'),
      }),
    });
    state.user = result.user;
    state.addonCount = result.addonCount;
    await loadLibrary();
  } catch (err) {
    state.error = err.message;
    state.loading = false;
    render();
  }
}

async function onLogout() {
  await api('/api/logout', { method: 'POST', body: '{}' }).catch(() => {});
  state.user = null;
  state.items = [];
  state.modal = null;
  state.error = '';
  render();
}

async function onStopServer() {
  if (!window.confirm('Stop the library server? You can start it again from the Stremio Library icon.')) {
    return;
  }
  try {
    await api('/api/shutdown', { method: 'POST', body: '{}' });
  } catch {
    // The connection may drop as the process exits.
  }
  app.innerHTML = `
    <div class="login-page">
      <div class="login-card">
        <h1>Server stopped</h1>
        <p>You can close this tab. Double-click Stremio Library when you want it again.</p>
      </div>
    </div>
  `;
}

async function loadLibrary() {
  state.loading = true;
  state.error = '';
  render();
  try {
    const result = await api('/api/library');
    state.items = result.items || [];
  } catch (err) {
    state.error = err.message;
  } finally {
    state.loading = false;
    render();
  }
}

async function boot() {
  try {
    const session = await api('/api/session');
    if (session.user) {
      state.user = session.user;
      state.addonCount = session.addonCount;
      await loadLibrary();
      return;
    }
  } catch {
    // show login
  }
  render();
}

boot();

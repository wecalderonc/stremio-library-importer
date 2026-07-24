const ENDPOINT = 'https://api.strem.io';

/**
 * Low-level Stremio API request.
 * @param {string} method - API method name (e.g. "login", "datastoreGet")
 * @param {object} params - Request body fields (authKey merged in when provided)
 * @param {string|null} [authKey]
 * @returns {Promise<any>} result payload
 */
export async function request(method, params = {}, authKey = null) {
  const body = { ...params };
  if (authKey != null) {
    body.authKey = authKey;
  }

  const response = await fetch(`${ENDPOINT}/api/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`${method} failed with HTTP ${response.status}`);
  }

  const payload = await response.json();

  if (payload.error) {
    const message =
      typeof payload.error === 'string'
        ? payload.error
        : payload.error.message || JSON.stringify(payload.error);
    throw new Error(`${method} error: ${message}`);
  }

  if (payload.result === undefined) {
    throw new Error(`${method} response has no result`);
  }

  return payload.result;
}

/**
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{ authKey: string, user: object }>}
 */
export async function login(email, password) {
  const result = await request('login', { email, password });
  if (!result?.authKey) {
    throw new Error('login did not return an authKey');
  }
  return result;
}

/**
 * Fetch all library items for the authenticated user.
 * @param {string} authKey
 * @returns {Promise<object[]>}
 */
export async function datastoreGet(authKey) {
  const result = await request(
    'datastoreGet',
    {
      collection: 'libraryItem',
      ids: [],
      all: true,
    },
    authKey
  );

  if (Array.isArray(result)) {
    return result;
  }
  if (Array.isArray(result?.libraryItems)) {
    return result.libraryItems;
  }
  if (Array.isArray(result?.library)) {
    return result.library;
  }
  return [];
}

/**
 * Write library item changes for the authenticated user.
 * @param {string} authKey
 * @param {object[]} changes
 * @returns {Promise<any>}
 */
export async function datastorePut(authKey, changes) {
  return request(
    'datastorePut',
    {
      collection: 'libraryItem',
      changes,
    },
    authKey
  );
}

/**
 * Mask an auth key for safe logging.
 * @param {string} authKey
 */
export function maskAuthKey(authKey) {
  if (!authKey || authKey.length < 8) return '***';
  return `${authKey.slice(0, 4)}…${authKey.slice(-4)}`;
}

import {
  startAuth,
  exchangeCode,
  refreshToken as doRefresh,
  getCurrentAccount,
  type DropboxConfig,
} from "./dropbox";
import {
  persistedTokenSchema,
  pkceStateSchema,
  type SyncToken,
  type PersistedToken,
} from "./interface";

const TOKEN_KEY = "dbx_token";
const PKCE_KEY = "dbx_pkce";

let _accessToken: string | null = null;
let _accessTokenExpiresAt = 0;

export function getDropboxClientId(): string | undefined {
  return import.meta.env.VITE_DROPBOX_CLIENT_ID as string | undefined;
}

function getDropboxConfig(): DropboxConfig {
  const clientId = getDropboxClientId();
  if (!clientId) throw new Error("VITE_DROPBOX_CLIENT_ID is not set");
  return { clientId, redirectUri: `${location.origin}${location.pathname}` };
}

function loadPersisted(): PersistedToken | null {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return null;
    const parsed = persistedTokenSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function savePersisted(p: PersistedToken): void {
  localStorage.setItem(TOKEN_KEY, JSON.stringify(p));
}

export function loadToken(): PersistedToken | null {
  return loadPersisted();
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
  _accessToken = null;
  _accessTokenExpiresAt = 0;
}

export async function ensureToken(): Promise<SyncToken> {
  const cfg = getDropboxConfig();
  const persisted = loadPersisted();
  if (!persisted) throw new Error("Not authenticated with Dropbox");

  const TEN_MIN = 600_000;
  if (_accessToken && Date.now() < _accessTokenExpiresAt - TEN_MIN) {
    return {
      accessToken: _accessToken,
      refreshToken: persisted.refreshToken,
      expiresAt: _accessTokenExpiresAt,
    };
  }

  const stale: SyncToken = {
    accessToken: _accessToken ?? "",
    refreshToken: persisted.refreshToken,
    expiresAt: _accessTokenExpiresAt,
  };
  const refreshed = await doRefresh(cfg, stale);
  _accessToken = refreshed.accessToken;
  _accessTokenExpiresAt = refreshed.expiresAt;

  return {
    accessToken: _accessToken,
    refreshToken: persisted.refreshToken,
    expiresAt: _accessTokenExpiresAt,
  };
}

export async function beginOAuth(): Promise<void> {
  const cfg = getDropboxConfig();
  const { url, state } = await startAuth(cfg);
  sessionStorage.setItem(PKCE_KEY, JSON.stringify(state));
  location.href = url;
}

export async function handleCallback(code: string): Promise<void> {
  const cfg = getDropboxConfig();
  const raw = sessionStorage.getItem(PKCE_KEY);
  if (!raw) throw new Error("PKCE state missing");
  const pkceState = pkceStateSchema.safeParse(JSON.parse(raw));
  if (!pkceState.success) throw new Error("PKCE state missing");
  sessionStorage.removeItem(PKCE_KEY);

  const token = await exchangeCode(cfg, code, pkceState.data);
  if (!token.refreshToken) throw new Error("No refresh token received");

  _accessToken = token.accessToken;
  _accessTokenExpiresAt = token.expiresAt;

  const persisted: PersistedToken = { refreshToken: token.refreshToken };
  try {
    const account = await getCurrentAccount(token);
    persisted.displayName = account.displayName;
    persisted.email = account.email;
  } catch {
    // best-effort
  }
  savePersisted(persisted);
}

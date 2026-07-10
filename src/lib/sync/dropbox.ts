import { z } from "zod/mini";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  pkceStateSchema,
  SyncAuthError,
  type SyncFile,
  type SyncToken,
} from "./interface";
import { isMDFile } from "../path";

const AUTH_URL = "https://www.dropbox.com/oauth2/authorize";
const TOKEN_URL = "https://api.dropboxapi.com/oauth2/token";
const CONTENT_URL = "https://content.dropboxapi.com/2";
const API_URL = "https://api.dropboxapi.com/2";

export interface DropboxConfig {
  clientId: string;
  redirectUri: string;
}

export type DropboxPkceState = z.infer<typeof pkceStateSchema>;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.optional(z.string()),
  expires_in: z.optional(z.number()),
});

const oauthErrorSchema = z.object({
  error: z.optional(z.string()),
  error_description: z.optional(z.string()),
});

const fileEntrySchema = z.object({
  ".tag": z.optional(z.string()),
  id: z.optional(z.string()),
  name: z.string(),
  path_lower: z.optional(z.string()),
  client_modified: z.optional(z.string()),
  server_modified: z.optional(z.string()),
  size: z.optional(z.number()),
});

const listFolderResponseSchema = z.object({
  entries: z.array(z.record(z.string(), z.unknown())),
  cursor: z.string(),
  has_more: z.boolean(),
});

const accountResponseSchema = z.object({
  name: z.object({ display_name: z.string() }),
  email: z.string(),
});

const apiErrorSchema = z.object({
  error_summary: z.optional(z.string()),
  error: z.optional(z.unknown()),
});

function headerJson(obj: unknown): string {
  return JSON.stringify(obj).replace(
    /[\x80-￿]/g,
    (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

function dbxError(msg: string, cause?: unknown): never {
  throw new Error(msg, cause ? { cause } : undefined);
}

function parseApiError(json: unknown): string {
  const parsed = apiErrorSchema.safeParse(json);
  if (parsed.success) {
    return (
      parsed.data.error_summary ?? JSON.stringify(parsed.data.error ?? json)
    );
  }
  return JSON.stringify(json);
}

export async function startAuth(
  cfg: DropboxConfig,
): Promise<{ url: string; state: DropboxPkceState }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    token_access_type: "offline",
  });
  return { url: `${AUTH_URL}?${params}`, state: { codeVerifier } };
}

export async function exchangeCode(
  cfg: DropboxConfig,
  code: string,
  state: DropboxPkceState,
): Promise<SyncToken> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      redirect_uri: cfg.redirectUri,
      grant_type: "authorization_code",
      code,
      code_verifier: state.codeVerifier,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = oauthErrorSchema.safeParse(json);
    dbxError(
      err.success
        ? (err.data.error_description ?? err.data.error ?? "OAuth error")
        : JSON.stringify(json),
      json,
    );
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) dbxError("Invalid token response", parsed.error);
  return tokenFromParsed(parsed.data);
}

export async function refreshToken(
  cfg: DropboxConfig,
  token: SyncToken,
): Promise<SyncToken> {
  if (!token.refreshToken) dbxError("No refresh token available");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      grant_type: "refresh_token",
      refresh_token: token.refreshToken!,
    }),
  });
  const json = await res.json();
  if (!res.ok) {
    const err = oauthErrorSchema.safeParse(json);
    const message = err.success
      ? (err.data.error_description ?? err.data.error ?? "Token refresh failed")
      : JSON.stringify(json);
    // Dropbox returns error: "invalid_grant" when the refresh token itself
    // is dead (revoked from the account settings, or expired from disuse) —
    // retrying with the same token will just fail the same way forever.
    if (err.success && err.data.error === "invalid_grant") {
      throw new SyncAuthError(message);
    }
    dbxError(message, json);
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) dbxError("Invalid token response", parsed.error);
  return { ...tokenFromParsed(parsed.data), refreshToken: token.refreshToken };
}

export async function maybeRefresh(
  cfg: DropboxConfig,
  token: SyncToken,
): Promise<SyncToken> {
  if (Date.now() < token.expiresAt - 60_000) return token;
  return refreshToken(cfg, token);
}

export async function list(
  token: SyncToken,
  cursor?: string,
): Promise<{ files: SyncFile[]; cursor: string; hasMore: boolean }> {
  let res: Response;
  if (cursor) {
    res = await fetch(`${API_URL}/files/list_folder/continue`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ cursor }),
    });
  } else {
    res = await fetch(`${API_URL}/files/list_folder`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ path: "", limit: 100 }),
    });
  }
  const json = await res.json();
  if (!res.ok) dbxError(`List failed: ${parseApiError(json)}`, json);

  const parsed = listFolderResponseSchema.safeParse(json);
  if (!parsed.success)
    dbxError("Unexpected list_folder response", parsed.error);

  const files = parsed.data.entries
    .filter(
      (e) =>
        e[".tag"] === "file" &&
        typeof e["name"] === "string" &&
        isMDFile(e["name"] as string),
    )
    .map((e) => {
      const f = fileEntrySchema.safeParse(e);
      if (!f.success) dbxError("Unexpected file entry shape", f.error);
      return fileFromParsed(f.data);
    })
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  return { files, cursor: parsed.data.cursor, hasMore: parsed.data.has_more };
}

export async function upload(
  token: SyncToken,
  name: string,
  blob: Blob,
): Promise<SyncFile> {
  const res = await fetch(`${CONTENT_URL}/files/upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/octet-stream",
      "Dropbox-API-Arg": headerJson({
        path: `/${name}`,
        mode: "overwrite",
        autorename: false,
        mute: true,
      }),
    },
    body: blob,
  });
  const json = await res.json();
  if (!res.ok) dbxError(`Upload failed: ${parseApiError(json)}`, json);

  const parsed = fileEntrySchema.safeParse(json);
  if (!parsed.success) dbxError("Unexpected upload response", parsed.error);
  return fileFromParsed(parsed.data);
}

export async function deleteFile(
  token: SyncToken,
  name: string,
): Promise<void> {
  const res = await fetch(`${API_URL}/files/delete_v2`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ path: `/${name}` }),
  });
  if (!res.ok) {
    const json = await res.json().catch(() => ({}));
    dbxError(`Delete failed: ${parseApiError(json)}`, json);
  }
}

export async function download(token: SyncToken, name: string): Promise<Blob> {
  const res = await fetch(`${CONTENT_URL}/files/download`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Dropbox-API-Arg": headerJson({ path: `/${name}` }),
    },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    dbxError(`Download failed: ${parseApiError(err)}`, err);
  }
  return res.blob();
}

export interface DropboxAccount {
  displayName: string;
  email: string;
}

export async function getCurrentAccount(
  token: SyncToken,
): Promise<DropboxAccount> {
  const res = await fetch(`${API_URL}/users/get_current_account`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "application/json",
    },
    body: "null",
  });
  const json = await res.json();
  if (!res.ok) dbxError(`Get account failed: ${parseApiError(json)}`, json);

  const parsed = accountResponseSchema.safeParse(json);
  if (!parsed.success) dbxError("Unexpected account response", parsed.error);
  return {
    displayName: parsed.data.name.display_name,
    email: parsed.data.email,
  };
}

type TokenParsed = z.infer<typeof tokenResponseSchema>;
type FileParsed = z.infer<typeof fileEntrySchema>;

function tokenFromParsed(d: TokenParsed): SyncToken {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: Date.now() + (d.expires_in ?? 14400) * 1000,
  };
}

function fileFromParsed(f: FileParsed): SyncFile {
  return {
    id: f.id ?? f.path_lower ?? f.name,
    name: f.name,
    modifiedAt: new Date(f.client_modified ?? f.server_modified ?? 0),
    size: f.size,
  };
}

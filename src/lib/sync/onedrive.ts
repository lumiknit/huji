import { z } from "zod/mini";
import {
  generateCodeVerifier,
  generateCodeChallenge,
  pkceStateSchema,
  type SyncFile,
  type SyncToken,
} from "./interface";
import { isMDFile } from "../path";

const AUTH_URL =
  "https://login.microsoftonline.com/common/oauth2/v2.0/authorize";
const TOKEN_URL = "https://login.microsoftonline.com/common/oauth2/v2.0/token";
const GRAPH_URL = "https://graph.microsoft.com/v1.0";
const APP_ROOT = `${GRAPH_URL}/me/drive/special/approot`;

export interface OneDriveConfig {
  clientId: string;
  redirectUri: string;
}

export type OneDrivePkceState = z.infer<typeof pkceStateSchema>;

const tokenResponseSchema = z.object({
  access_token: z.string(),
  refresh_token: z.optional(z.string()),
  expires_in: z.optional(z.number()),
});

const oauthErrorSchema = z.object({
  error: z.optional(z.string()),
  error_description: z.optional(z.string()),
});

const driveItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  lastModifiedDateTime: z.optional(z.string()),
  size: z.optional(z.number()),
  file: z.optional(z.record(z.string(), z.unknown())),
});

const listResponseSchema = z.object({
  value: z.array(z.record(z.string(), z.unknown())),
  "@odata.nextLink": z.optional(z.string()),
});

const meResponseSchema = z.object({
  displayName: z.optional(z.string()),
  mail: z.optional(z.string()),
  userPrincipalName: z.optional(z.string()),
});

function odvError(msg: string, cause?: unknown): never {
  throw new Error(msg, cause ? { cause } : undefined);
}

export async function startAuth(
  cfg: OneDriveConfig,
): Promise<{ url: string; state: OneDrivePkceState }> {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: "Files.ReadWrite.AppFolder offline_access",
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });
  return { url: `${AUTH_URL}?${params}`, state: { codeVerifier } };
}

export async function exchangeCode(
  cfg: OneDriveConfig,
  code: string,
  state: OneDrivePkceState,
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
    odvError(
      err.success
        ? (err.data.error_description ?? err.data.error ?? "OAuth error")
        : JSON.stringify(json),
      json,
    );
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) odvError("Invalid token response", parsed.error);
  return tokenFromParsed(parsed.data);
}

export async function refreshToken(
  cfg: OneDriveConfig,
  token: SyncToken,
): Promise<SyncToken> {
  if (!token.refreshToken) odvError("No refresh token available");
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
    odvError(
      err.success
        ? (err.data.error_description ??
            err.data.error ??
            "Token refresh failed")
        : JSON.stringify(json),
      json,
    );
  }
  const parsed = tokenResponseSchema.safeParse(json);
  if (!parsed.success) odvError("Invalid token response", parsed.error);
  return { ...tokenFromParsed(parsed.data), refreshToken: token.refreshToken };
}

export async function list(
  token: SyncToken,
  cursor?: string,
): Promise<{ files: SyncFile[]; cursor: string; hasMore: boolean }> {
  const url = cursor
    ? cursor
    : `${APP_ROOT}/children?$select=id,name,lastModifiedDateTime,size,file&$top=100`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  const json = await res.json();
  if (!res.ok)
    odvError(
      `List failed: ${JSON.stringify((json as { error?: unknown }).error ?? json)}`,
    );

  const parsed = listResponseSchema.safeParse(json);
  if (!parsed.success) odvError("Unexpected list response", parsed.error);

  const files = parsed.data.value
    .map((e) => driveItemSchema.safeParse(e))
    .filter(
      (r) => r.success && r.data.file !== undefined && isMDFile(r.data.name),
    )
    .map((r) => {
      const d = (r as { success: true; data: z.infer<typeof driveItemSchema> })
        .data;
      return {
        id: d.id,
        name: d.name,
        modifiedAt: new Date(d.lastModifiedDateTime ?? 0),
        size: d.size,
      } satisfies SyncFile;
    })
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());

  const nextLink = parsed.data["@odata.nextLink"];
  return {
    files,
    cursor: nextLink ?? "",
    hasMore: !!nextLink,
  };
}

export async function upload(
  token: SyncToken,
  name: string,
  blob: Blob,
): Promise<SyncFile> {
  const res = await fetch(`${APP_ROOT}:/${encodeURIComponent(name)}:/content`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token.accessToken}`,
      "Content-Type": "text/markdown",
    },
    body: blob,
  });
  const json = await res.json();
  if (!res.ok)
    odvError(
      `Upload failed: ${JSON.stringify((json as { error?: unknown }).error ?? json)}`,
    );

  const parsed = driveItemSchema.safeParse(json);
  if (!parsed.success) odvError("Unexpected upload response", parsed.error);
  return {
    id: parsed.data.id,
    name: parsed.data.name,
    modifiedAt: new Date(parsed.data.lastModifiedDateTime ?? 0),
    size: parsed.data.size,
  };
}

export async function deleteFile(
  token: SyncToken,
  name: string,
): Promise<void> {
  const res = await fetch(`${APP_ROOT}:/${encodeURIComponent(name)}:`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  if (!res.ok && res.status !== 204) {
    const err = await res.json().catch(() => ({}));
    odvError(
      `Delete failed: ${JSON.stringify((err as { error?: unknown }).error ?? err)}`,
    );
  }
}

export async function download(token: SyncToken, name: string): Promise<Blob> {
  const res = await fetch(`${APP_ROOT}:/${encodeURIComponent(name)}:/content`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    odvError(
      `Download failed: ${JSON.stringify((err as { error?: unknown }).error ?? err)}`,
    );
  }
  return res.blob();
}

export interface OneDriveAccount {
  displayName: string;
  email: string;
}

export async function getCurrentAccount(
  token: SyncToken,
): Promise<OneDriveAccount> {
  const res = await fetch(`${GRAPH_URL}/me`, {
    headers: { Authorization: `Bearer ${token.accessToken}` },
  });
  const json = await res.json();
  if (!res.ok) odvError(`Get account failed`);

  const parsed = meResponseSchema.safeParse(json);
  if (!parsed.success) odvError("Unexpected account response", parsed.error);
  return {
    displayName: parsed.data.displayName ?? "",
    email: parsed.data.mail ?? parsed.data.userPrincipalName ?? "",
  };
}

type TokenParsed = z.infer<typeof tokenResponseSchema>;

function tokenFromParsed(d: TokenParsed): SyncToken {
  return {
    accessToken: d.access_token,
    refreshToken: d.refresh_token,
    expiresAt: Date.now() + (d.expires_in ?? 3600) * 1000,
  };
}

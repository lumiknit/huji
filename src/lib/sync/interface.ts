import { z } from "zod/mini";

export const syncTokenSchema = z.object({
  accessToken: z.string(),
  refreshToken: z.optional(z.string()),
  expiresAt: z.number(),
});

export type SyncToken = z.infer<typeof syncTokenSchema>;

export const persistedTokenSchema = z.object({
  refreshToken: z.string(),
  displayName: z.optional(z.string()),
  email: z.optional(z.string()),
});

export type PersistedToken = z.infer<typeof persistedTokenSchema>;

export const pkceStateSchema = z.object({
  codeVerifier: z.string(),
});

export type SyncProviderName = "dropbox" | "onedrive";

export const PENDING_PROVIDER_KEY = "sync_pending_provider";
export const ACTIVE_PROVIDER_KEY = "sync_active_provider";

export interface SyncProvider {
  name: SyncProviderName;
  isAvailable(): boolean;
  loadToken(): PersistedToken | null;
  clearToken(): void;
  ensureToken(): Promise<SyncToken>;
  beginOAuth(): Promise<void>;
  handleCallback(code: string): Promise<void>;
  list(
    token: SyncToken,
    cursor?: string,
  ): Promise<{ files: SyncFile[]; cursor: string; hasMore: boolean }>;
  upload(token: SyncToken, name: string, blob: Blob): Promise<SyncFile>;
  download(token: SyncToken, name: string): Promise<Blob>;
  delete(token: SyncToken, name: string): Promise<void>;
}

export interface SyncFile {
  id: string;
  name: string;
  modifiedAt: Date;
  size?: number;
}

export function generateCodeVerifier(): string {
  const arr = new Uint8Array(48);
  crypto.getRandomValues(arr);
  return base64url(arr);
}

export async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoded = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return base64url(new Uint8Array(digest));
}

function base64url(buf: Uint8Array): string {
  let str = "";
  for (const b of buf) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

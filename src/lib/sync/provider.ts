import {
  ACTIVE_PROVIDER_KEY,
  PENDING_PROVIDER_KEY,
  type SyncProvider,
  type SyncProviderName,
} from "./interface";
import { getDropboxClientId } from "./dropbox_auth";
import * as dropboxAuth from "./dropbox_auth";
import * as dropbox from "./dropbox";
import { getOneDriveClientId } from "./onedrive_auth";
import * as onedriveAuth from "./onedrive_auth";
import * as onedrive from "./onedrive";

const dropboxProvider: SyncProvider = {
  name: "dropbox",
  isAvailable: () => !!getDropboxClientId(),
  loadToken: dropboxAuth.loadToken,
  clearToken: dropboxAuth.clearToken,
  ensureToken: dropboxAuth.ensureToken,
  beginOAuth: async () => {
    localStorage.setItem(PENDING_PROVIDER_KEY, "dropbox");
    await dropboxAuth.beginOAuth();
  },
  handleCallback: dropboxAuth.handleCallback,
  list: dropbox.list,
  upload: dropbox.upload,
  download: dropbox.download,
  delete: dropbox.deleteFile,
};

const onedriveProvider: SyncProvider = {
  name: "onedrive",
  isAvailable: () => !!getOneDriveClientId(),
  loadToken: onedriveAuth.loadToken,
  clearToken: onedriveAuth.clearToken,
  ensureToken: onedriveAuth.ensureToken,
  beginOAuth: async () => {
    localStorage.setItem(PENDING_PROVIDER_KEY, "onedrive");
    await onedriveAuth.beginOAuth();
  },
  handleCallback: onedriveAuth.handleCallback,
  list: onedrive.list,
  upload: onedrive.upload,
  download: onedrive.download,
  delete: onedrive.deleteFile,
};

const providers: Record<SyncProviderName, SyncProvider> = {
  dropbox: dropboxProvider,
  onedrive: onedriveProvider,
};

export const availableProviders = (): SyncProvider[] =>
  Object.values(providers).filter((p) => p.isAvailable());

export function getProvider(name: SyncProviderName): SyncProvider {
  return providers[name];
}

export function getActiveProvider(): SyncProvider | null {
  const name = localStorage.getItem(
    ACTIVE_PROVIDER_KEY,
  ) as SyncProviderName | null;
  if (!name || !providers[name]) return null;
  return providers[name];
}

export function setActiveProvider(name: SyncProviderName): void {
  localStorage.setItem(ACTIVE_PROVIDER_KEY, name);
}

export function clearActiveProvider(): void {
  localStorage.removeItem(ACTIVE_PROVIDER_KEY);
}

export function resolveCallbackProvider(): SyncProvider | null {
  const pending = localStorage.getItem(
    PENDING_PROVIDER_KEY,
  ) as SyncProviderName | null;
  if (!pending || !providers[pending]) return null;
  localStorage.removeItem(PENDING_PROVIDER_KEY);
  setActiveProvider(pending);
  return providers[pending];
}

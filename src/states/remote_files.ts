import { createSignal } from "solid-js";
import type { SyncFile, SyncProviderName } from "../lib/sync/interface";

// In-memory only (not persisted): the point is to survive SPA navigation
// away from and back to the file list, not a full page reload — after a
// reload, re-fetching from the provider is the correct/expected behavior.
export type RemoteFilesState = {
  provider: SyncProviderName;
  files: SyncFile[];
  cursor?: string;
  hasMore: boolean;
  fetchedAt: number;
};

const [remoteFiles, setRemoteFiles] = createSignal<RemoteFilesState | null>(
  null,
);
export { remoteFiles };

/** Replace (or, if `append`, extend) the cached list for `provider`. */
export const setRemoteFilesResult = (
  provider: SyncProviderName,
  files: SyncFile[],
  cursor: string | undefined,
  hasMore: boolean,
  append: boolean,
) => {
  setRemoteFiles((prev) => ({
    provider,
    files:
      append && prev && prev.provider === provider
        ? [...prev.files, ...files]
        : files,
    cursor,
    hasMore,
    fetchedAt: Date.now(),
  }));
};

export const removeRemoteFile = (provider: SyncProviderName, name: string) => {
  setRemoteFiles((prev) =>
    prev && prev.provider === provider
      ? { ...prev, files: prev.files.filter((f) => f.name !== name) }
      : prev,
  );
};

export const clearRemoteFiles = () => setRemoteFiles(null);

const STALE_MS = 5 * 60_000;

/** True if there's no cached list for `provider`, or it's old enough that
 *  the user likely reconnected/changed things elsewhere since it was fetched. */
export const isRemoteFilesStale = (provider: SyncProviderName): boolean => {
  const s = remoteFiles();
  return !s || s.provider !== provider || Date.now() - s.fetchedAt > STALE_MS;
};

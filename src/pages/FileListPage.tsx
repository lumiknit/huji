import {
  type Component,
  createSignal,
  createMemo,
  createResource,
  onMount,
  For,
  Show,
  Switch,
  Match,
} from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import {
  TbOutlineFilePlus,
  TbOutlineTrash,
  TbOutlineUpload,
  TbOutlineSettings,
  TbOutlineRefresh,
  TbOutlineCloudDownload,
  TbOutlineLogout,
  TbFillCloud,
} from "solid-icons/tb";
import toast from "solid-toast";

import { getDB } from "../lib/db/index";
import { putMeta } from "../lib/db/meta";
import { putContent, getContents } from "../lib/db/content";
import { parseFrontmatterDataLoose } from "../lib/md/frontmatter";
import { genId } from "../lib/utils/id";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { ensureRenderRules } from "../lib/db/defaults";
import FileDrop from "../components/FileDrop";
import { aprompt } from "../components/CommonDialog";
import FileList from "../components/FileList";
import DeletePreview from "../components/DeletePreview";
import TrashList from "../components/TrashList";
import { type FileSummary, formatRelativeTime } from "../components/file_list";
import { importMarkdownText } from "../states/editor";
import {
  SyncAuthError,
  type SyncFile,
  type SyncProviderName,
} from "../lib/sync/interface";
import {
  availableProviders,
  getActiveProvider,
  setActiveProvider,
  clearActiveProvider,
  resolveCallbackProvider,
} from "../lib/sync/provider";
import { unpackBackupName } from "../lib/path";
import { unpackMDBlob } from "../lib/export";
import { setDefaultRemoteProvider } from "../states/settings";
import {
  remoteFiles,
  setRemoteFilesResult,
  removeRemoteFile,
  clearRemoteFiles,
  isRemoteFilesStale,
} from "../states/remote_files";
import Toolbar from "../components/Toolbar";

const PROVIDER_LABELS: Record<SyncProviderName, string> = {
  dropbox: "Dropbox",
  onedrive: "OneDrive",
};

const loadFileList = async (): Promise<FileSummary[]> => {
  const db = await getDB();
  const all = await db.getAll("meta");
  const frontmatters = all.filter((m) => m.level === -1);
  const contents = await getContents(frontmatters.map((fm) => fm.id));

  const summaries = await Promise.all(
    frontmatters.map(async (fm) => {
      const content = contents.get(fm.id);
      let filename = fm.fileId;
      let lastUsedAt = fm.updatedAt;
      let tags: string[] = [];
      let docId: string | undefined;
      let deletedAt: string | undefined;
      if (content) {
        try {
          // Legacy rows not yet migrated to compact JSON are read here
          // read-only — migration happens when the file is opened.
          const parsed = await parseFrontmatterDataLoose(content);
          if (parsed) {
            const { data } = parsed;
            if (typeof data._filename === "string") filename = data._filename;
            if (typeof data._last_used_at === "string")
              lastUsedAt = data._last_used_at;
            if (typeof data._id === "string" && data._id) docId = data._id;
            if (Array.isArray(data._tags))
              tags = data._tags.filter(
                (t): t is string => typeof t === "string",
              );
            if (typeof data._deleted_at === "string")
              deletedAt = data._deleted_at;
          }
        } catch {
          /* ignore */
        }
      }
      return {
        fileId: fm.fileId,
        docId,
        filename,
        lastUsedAt,
        tags,
        deletedAt,
      };
    }),
  );

  return summaries.sort(
    (a, b) =>
      new Date(b.lastUsedAt).getTime() - new Date(a.lastUsedAt).getTime(),
  );
};

const createNewFile = async (filename: string): Promise<string> => {
  const fileId = genId();
  const now = new Date().toISOString();
  const fmId = genId();
  const fmData: Record<string, unknown> = {
    _id: genId(),
    _filename: filename || "Untitled",
    _last_used_at: now,
  };
  ensureRenderRules(fmData);

  await putMeta({
    id: fmId,
    fileId,
    fracIndex: 0,
    level: -1,
    heading: "json",
    updatedAt: now,
  });
  await putContent({
    id: fmId,
    content: JSON.stringify(fmData),
    updatedAt: now,
  });

  const sectionId = genId();
  await putMeta({
    id: sectionId,
    fileId,
    fracIndex: FRAC_GAP,
    level: 0,
    heading: "",
    updatedAt: now,
  });
  await putContent({ id: sectionId, content: "", updatedAt: now });

  return fileId;
};

export const importMarkdownFile = async (file: File): Promise<string> => {
  const text = await unpackMDBlob(file);
  const unpacked = unpackBackupName(file.name);
  const filename = unpacked
    ? unpacked.title
    : file.name.replace(/\.(md\.gz|md|markdown|txt)$/i, "");
  return importMarkdownText(text, filename);
};

const FileListPage: Component = () => {
  const navigate = useNavigate();
  const [files, { refetch }] = createResource(loadFileList);
  const activeFiles = createMemo(() =>
    (files() ?? []).filter((f) => !f.deletedAt),
  );
  const trashedFiles = createMemo(() =>
    (files() ?? []).filter((f) => f.deletedAt),
  );
  const [search, setSearch] = createSignal("");
  const [showDeletePreview, setShowDeletePreview] = createSignal(false);
  const [showTrash, setShowTrash] = createSignal(false);

  const providers = availableProviders();
  const hasCloud = providers.length > 0;

  const [cloudToken, setCloudToken] = createSignal(
    getActiveProvider()?.loadToken() ?? null,
  );
  const [activeProvider, setActive] = createSignal(getActiveProvider());
  // Cached across SPA navigation in states/remote_files.ts; only the slice
  // for the currently-active provider is relevant here.
  const currentRemote = createMemo(() => {
    const s = remoteFiles();
    const p = activeProvider();
    return s && p && s.provider === p.name ? s : null;
  });
  const cloudFiles = () => currentRemote()?.files ?? null;
  const cloudCursor = () => currentRemote()?.cursor;
  const cloudHasMore = () => currentRemote()?.hasMore ?? false;
  const cloudStale = () => {
    const p = activeProvider();
    return !!p && !!currentRemote() && isRemoteFilesStale(p.name);
  };
  // Snapshotted once per mount — this is a "how long ago" label, not a live
  // clock, so no need to re-diff against the current time on every render.
  const pageEnteredAt = Date.now();
  const cloudFetchedLabel = () => {
    const s = currentRemote();
    return s ? formatRelativeTime(pageEnteredAt - s.fetchedAt) : null;
  };
  const [cloudLoading, setCloudLoading] = createSignal(false);
  const [authenticating, setAuthenticating] = createSignal(false);
  const [selectedProvider, setSelectedProvider] =
    createSignal<SyncProviderName>(providers[0]?.name ?? "dropbox");

  let fileInputEl!: HTMLInputElement;

  onMount(async () => {
    const params = new URLSearchParams(location.search);
    const code = params.get("code");
    if (code) {
      const url = new URL(location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("state");
      history.replaceState(null, "", url.toString());
      const provider = resolveCallbackProvider();
      if (!provider) {
        toast.error("Unknown provider callback");
        return;
      }
      setAuthenticating(true);
      try {
        await provider.handleCallback(code);
        setActive(provider);
        setCloudToken(provider.loadToken());
        toast.success(`${PROVIDER_LABELS[provider.name]} connected`);
      } catch (e) {
        toast.error(
          `${PROVIDER_LABELS[provider.name]} connection failed: ${(e as Error).message}`,
        );
      } finally {
        setAuthenticating(false);
      }
    }
  });

  const handleNew = async () => {
    const title = await aprompt("New file title");
    if (title === null) return;
    const fileId = await createNewFile(title.trim());
    navigate(`/edit/${fileId}`);
  };

  const handleFileInput = async (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    const fileId = await importMarkdownFile(file);
    navigate(`/edit/${fileId}`);
  };

  const handleDrop = async (file: File) => {
    const fileId = await importMarkdownFile(file);
    navigate(`/edit/${fileId}`);
  };

  const loadCloudFiles = (cursor?: string) => {
    const provider = activeProvider();
    if (!provider) return;
    if (!cursor) setDefaultRemoteProvider(provider.name);
    const label = cursor
      ? "Loading more…"
      : `Loading ${PROVIDER_LABELS[provider.name]} files…`;
    const p = (async () => {
      setCloudLoading(true);
      try {
        const token = await provider.ensureToken();
        const result = await provider.list(token, cursor);
        setRemoteFilesResult(
          provider.name,
          result.files,
          result.cursor || undefined,
          result.hasMore,
          !!cursor,
        );
        return result.files.length;
      } catch (e) {
        if (e instanceof SyncAuthError) handleDisconnect();
        throw e;
      } finally {
        setCloudLoading(false);
      }
    })();
    toast.promise(p, {
      loading: label,
      success: (n) => `${n} file(s) loaded`,
      error: (e) =>
        e instanceof SyncAuthError
          ? `${PROVIDER_LABELS[provider.name]} session expired — please reconnect`
          : `${PROVIDER_LABELS[provider.name]} error: ${(e as Error).message}`,
    });
  };

  const handleConnect = async () => {
    const name = selectedProvider();
    const provider = providers.find((p) => p.name === name);
    if (!provider) return;
    try {
      setActiveProvider(name);
      await provider.beginOAuth();
    } catch (e) {
      toast.error(
        `${PROVIDER_LABELS[name]} connection failed: ${(e as Error).message}`,
      );
    }
  };

  const handleDisconnect = () => {
    const provider = activeProvider();
    if (!provider) return;
    provider.clearToken();
    clearActiveProvider();
    setActive(null);
    setCloudToken(null);
    clearRemoteFiles();
  };

  const handleCloudDelete = (f: SyncFile) => {
    const provider = activeProvider();
    if (!provider) return;
    const p = (async () => {
      try {
        const token = await provider.ensureToken();
        await provider.delete(token, f.name);
        removeRemoteFile(provider.name, f.name);
      } catch (e) {
        if (e instanceof SyncAuthError) handleDisconnect();
        throw e;
      }
    })();
    toast.promise(p, {
      loading: `Deleting ${f.name}…`,
      success: "Deleted",
      error: (e) =>
        e instanceof SyncAuthError
          ? `${PROVIDER_LABELS[provider.name]} session expired — please reconnect`
          : `Delete failed: ${(e as Error).message}`,
    });
  };

  const handleCloudImport = (f: SyncFile) => {
    const provider = activeProvider();
    if (!provider) return;
    const p = (async () => {
      try {
        const token = await provider.ensureToken();
        const blob = await provider.download(token, f.name);
        const file = new File([blob], f.name, { type: "text/markdown" });
        return await importMarkdownFile(file);
      } catch (e) {
        if (e instanceof SyncAuthError) handleDisconnect();
        throw e;
      }
    })();
    toast.promise(p, {
      loading: `Downloading ${f.name}…`,
      success: "Imported",
      error: (e) =>
        e instanceof SyncAuthError
          ? `${PROVIDER_LABELS[provider.name]} session expired — please reconnect`
          : `Download failed: ${(e as Error).message}`,
    });
    p.then((fileId) => navigate(`/edit/${fileId}`)).catch(() => {});
  };

  const handleDeleteDone = () => {
    setShowDeletePreview(false);
    refetch();
  };

  return (
    <main>
      <FileDrop onDrop={handleDrop} label="Import file" />
      <Toolbar title="Files">
        <strong class="brand">huji</strong>
        <span class="spacer" />
        <A href="/settings" title="Settings">
          <TbOutlineSettings /> Settings
        </A>
        <div class="toolbar-row">
          <input
            type="search"
            placeholder="Search…"
            value={search()}
            onInput={(e) => setSearch(e.currentTarget.value)}
            class="toolbar-search"
          />
          <button class="primary" onClick={handleNew}>
            <TbOutlineFilePlus /> New
          </button>
          <button onClick={() => fileInputEl.click()}>
            <TbOutlineUpload /> Import
          </button>
          <input
            ref={fileInputEl}
            type="file"
            accept=".md,.md.gz,.gz,.markdown,.txt"
            class="hidden"
            onChange={handleFileInput}
          />
        </div>
      </Toolbar>

      <Show when={hasCloud}>
        <fieldset class="mb-sm">
          <legend>
            <TbFillCloud class="icon-middle" /> Cloud Sync
          </legend>
          <Switch>
            <Match when={authenticating()}>
              <small class="text-muted">Authenticating…</small>
            </Match>
            <Match when={activeProvider() && cloudToken()}>
              <small class="dropbox-account">
                {PROVIDER_LABELS[activeProvider()!.name]}
                {" · "}
                {cloudToken()?.displayName ??
                  cloudToken()?.email ??
                  "Connected"}
              </small>
              <div class="button-row mt-sm">
                <button class="danger mr-auto" onClick={handleDisconnect}>
                  <TbOutlineLogout />
                  Disconnect
                </button>
                <Show
                  when={cloudFiles() !== null}
                  fallback={
                    <button
                      onClick={() => loadCloudFiles()}
                      disabled={cloudLoading()}
                    >
                      <TbOutlineCloudDownload /> Show files
                    </button>
                  }
                >
                  <small class="text-muted">
                    Fetched {cloudFetchedLabel()}
                  </small>
                  <button
                    class={cloudStale() ? "primary" : undefined}
                    title={
                      cloudStale()
                        ? "This list may be out of date — refresh to see recent changes"
                        : undefined
                    }
                    onClick={() => loadCloudFiles()}
                    disabled={cloudLoading()}
                  >
                    <TbOutlineRefresh /> Refresh
                  </button>
                  <Show when={cloudHasMore()}>
                    <button
                      onClick={() => loadCloudFiles(cloudCursor())}
                      disabled={cloudLoading()}
                    >
                      <TbOutlineCloudDownload /> Load more
                    </button>
                  </Show>
                </Show>
              </div>
            </Match>
            <Match when={true}>
              <div class="button-row">
                <Show when={providers.length > 1}>
                  <select
                    value={selectedProvider()}
                    onChange={(e) =>
                      setSelectedProvider(
                        e.currentTarget.value as SyncProviderName,
                      )
                    }
                  >
                    <For each={providers}>
                      {(p) => (
                        <option value={p.name}>
                          {PROVIDER_LABELS[p.name]}
                        </option>
                      )}
                    </For>
                  </select>
                </Show>
                <button onClick={handleConnect}>
                  Connect{" "}
                  {providers.length === 1
                    ? PROVIDER_LABELS[providers[0].name]
                    : ""}
                </button>
              </div>
            </Match>
          </Switch>
        </fieldset>
      </Show>

      <Switch>
        <Match when={files.loading}>
          <p>
            <small>Loading…</small>
          </p>
        </Match>
        <Match when={showDeletePreview()}>
          <DeletePreview
            localItems={activeFiles()}
            cloudItems={cloudFiles() ?? []}
            provider={activeProvider()}
            onDone={handleDeleteDone}
          />
        </Match>
        <Match when={showTrash()}>
          <div class="button-row mb-md">
            <button onClick={() => setShowTrash(false)}>Back</button>
          </div>
          <TrashList items={trashedFiles()} onRefetch={refetch} />
        </Match>
        <Match when={true}>
          <div class="button-row mb-md">
            <button
              class="danger"
              onClick={() => setShowDeletePreview(true)}
              title="Remove all but the latest local/remote version per group"
            >
              <TbOutlineTrash /> Clean old versions
            </button>
            <button onClick={() => setShowTrash(true)}>
              <TbOutlineTrash /> Trash
              <Show when={trashedFiles().length > 0}>
                {" "}
                ({trashedFiles().length})
              </Show>
            </button>
          </div>

          <FileList
            localItems={activeFiles()}
            cloudItems={cloudFiles() ?? []}
            cloudLoading={cloudLoading()}
            search={search()}
            onRefetch={refetch}
            onCloudImport={handleCloudImport}
            onCloudDelete={handleCloudDelete}
          />
        </Match>
      </Switch>

      <p class="about-link">
        <A href="/about" class="text-xs text-muted">
          About
        </A>
      </p>
    </main>
  );
};

export default FileListPage;

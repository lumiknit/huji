import {
  type Component,
  createSignal,
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
import { putContent } from "../lib/db/content";
import { parseFrontmatterDataLoose } from "../lib/md/frontmatter";
import { genId } from "../lib/utils/id";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { ensureRenderRules } from "../lib/db/defaults";
import FileDrop from "../components/FileDrop";
import { aprompt } from "../components/CommonDialog";
import FileList from "../components/FileList";
import DeletePreview from "../components/DeletePreview";
import { type FileSummary } from "../components/file_list";
import { importMarkdownText } from "../states/editor";
import type { SyncFile, SyncProviderName } from "../lib/sync/interface";
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
import Toolbar from "../components/Toolbar";

const PROVIDER_LABELS: Record<SyncProviderName, string> = {
  dropbox: "Dropbox",
  onedrive: "OneDrive",
};

const loadFileList = async (): Promise<FileSummary[]> => {
  const db = await getDB();
  const all = await db.getAll("meta");
  const frontmatters = all.filter((m) => m.level === -1);

  const summaries = await Promise.all(
    frontmatters.map(async (fm) => {
      const content = await db.get("content", fm.id);
      let filename = fm.fileId;
      let lastUsedAt = fm.updatedAt;
      let tags: string[] = [];
      let docId: string | undefined;
      if (content) {
        try {
          // Legacy rows not yet migrated to compact JSON are read here
          // read-only — migration happens when the file is opened.
          const parsed = await parseFrontmatterDataLoose(content.content);
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
          }
        } catch {
          /* ignore */
        }
      }
      return { fileId: fm.fileId, docId, filename, lastUsedAt, tags };
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
  const [search, setSearch] = createSignal("");
  const [showDeletePreview, setShowDeletePreview] = createSignal(false);

  const providers = availableProviders();
  const hasCloud = providers.length > 0;

  const [cloudToken, setCloudToken] = createSignal(
    getActiveProvider()?.loadToken() ?? null,
  );
  const [activeProvider, setActive] = createSignal(getActiveProvider());
  const [cloudFiles, setCloudFiles] = createSignal<SyncFile[] | null>(null);
  const [cloudCursor, setCloudCursor] = createSignal<string | undefined>(
    undefined,
  );
  const [cloudHasMore, setCloudHasMore] = createSignal(false);
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
        if (cursor) {
          setCloudFiles((prev) => [...(prev ?? []), ...result.files]);
        } else {
          setCloudFiles(result.files);
        }
        setCloudCursor(result.cursor || undefined);
        setCloudHasMore(result.hasMore);
        return result.files.length;
      } finally {
        setCloudLoading(false);
      }
    })();
    toast.promise(p, {
      loading: label,
      success: (n) => `${n} file(s) loaded`,
      error: (e) =>
        `${PROVIDER_LABELS[provider.name]} error: ${(e as Error).message}`,
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
    setCloudFiles(null);
    setCloudCursor(undefined);
  };

  const handleCloudDelete = (f: SyncFile) => {
    const provider = activeProvider();
    if (!provider) return;
    const p = (async () => {
      const token = await provider.ensureToken();
      await provider.delete(token, f.name);
      setCloudFiles((prev) => prev?.filter((c) => c.name !== f.name) ?? null);
    })();
    toast.promise(p, {
      loading: `Deleting ${f.name}…`,
      success: "Deleted",
      error: (e) => `Delete failed: ${(e as Error).message}`,
    });
  };

  const handleCloudImport = (f: SyncFile) => {
    const provider = activeProvider();
    if (!provider) return;
    const p = (async () => {
      const token = await provider.ensureToken();
      const blob = await provider.download(token, f.name);
      const file = new File([blob], f.name, { type: "text/markdown" });
      return importMarkdownFile(file);
    })();
    toast.promise(p, {
      loading: `Downloading ${f.name}…`,
      success: "Imported",
      error: (e) => `Download failed: ${(e as Error).message}`,
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
            accept=".md,.md.gz,.markdown,.txt"
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
                  <button
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
            localItems={files() ?? []}
            cloudItems={cloudFiles() ?? []}
            provider={activeProvider()}
            onDone={handleDeleteDone}
          />
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
          </div>

          <FileList
            localItems={files() ?? []}
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

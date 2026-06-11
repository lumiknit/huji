import {
  type Component,
  createSignal,
  createResource,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import {
  TbOutlineFilePlus,
  TbOutlineTrash,
  TbOutlineUpload,
  TbOutlineSettings,
  TbOutlineRefresh,
  TbOutlineCloudDown,
  TbFillCloud,
  TbOutlineChevronDown,
  TbOutlineChevronRight,
  TbOutlineDots,
  TbOutlineGitBranch,
} from "solid-icons/tb";
import toast from "solid-toast";

import { getDB } from "../lib/db/index";
import { getFileMetas, deleteFileAllMeta } from "../lib/db/meta";
import { deleteContents } from "../lib/db/content";
import {
  extractFrontmatter,
  serializeFrontmatter,
  parseDocument,
} from "../lib/md/frontmatter";
import { genId } from "../lib/utils/id";
import { putMeta } from "../lib/db/meta";
import { putContent } from "../lib/db/content";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { ensureRenderRules } from "../lib/db/defaults";
import FileDrop from "../components/FileDrop";
import { importMarkdownText } from "../states/editor";
import { loadRawMarkdown } from "../lib/export";
import type { SyncFile, SyncProviderName } from "../lib/sync/interface";
import {
  availableProviders,
  getActiveProvider,
  setActiveProvider,
  clearActiveProvider,
  resolveCallbackProvider,
} from "../lib/sync/provider";
import { unpackBackupName } from "../lib/path";
import { setDefaultRemoteProvider } from "../states/settings";
import { fuzzyMatch } from "../lib/re";
import Toolbar from "../components/Toolbar";

const tagColorCache = new Map<string, string>();
const tagColor = (tag: string): string => {
  const cached = tagColorCache.get(tag);
  if (cached) return cached;
  let h = 0;
  for (let i = 0; i < tag.length; i++)
    h = (h * 31 + tag.charCodeAt(i)) & 0xffff;
  const hue = ((h % 360) + 360) % 360;
  const sat = 55 + (h % 20);
  const color = `hsl(${hue}, ${sat}%, var(--badge-l))`;
  tagColorCache.set(tag, color);
  return color;
};

type FileSummary = {
  fileId: string;
  docId?: string;
  filename: string;
  lastUsedAt: string;
  tags: string[];
};

type LocalListItem = {
  kind: "local";
  fileId: string;
  docId?: string;
  filename: string;
  sortAt: number;
  lastUsedAt: string;
  tags: string[];
};

type CloudListItem = {
  kind: "cloud";
  file: SyncFile;
  displayName: string;
  sortAt: number;
};

type ListItem = LocalListItem | CloudListItem;

type ItemGroup = {
  groupKey: string;
  docId: string | null;
  items: ListItem[];
};

function formatDateTime(date: Date): string {
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

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
          const info = await extractFrontmatter(content.content);
          if (info) {
            if (typeof info.data._filename === "string")
              filename = info.data._filename;
            if (typeof info.data._last_used_at === "string")
              lastUsedAt = info.data._last_used_at;
            if (typeof info.data._id === "string" && info.data._id)
              docId = info.data._id;
            if (Array.isArray(info.data._tags))
              tags = (info.data._tags as unknown[]).filter(
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

const createNewFile = async (): Promise<string> => {
  const fileId = genId();
  const now = new Date().toISOString();
  const fmId = genId();
  const fmData: Record<string, unknown> = {
    _id: genId(),
    _filename: "Untitled",
    _last_used_at: now,
  };
  ensureRenderRules(fmData);

  await putMeta({
    id: fmId,
    fileId,
    fracIndex: 0,
    level: -1,
    heading: "yaml",
    updatedAt: now,
  });
  await putContent({
    id: fmId,
    content: await serializeFrontmatter("yaml", fmData),
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
  const text = await file.text();
  const unpacked = unpackBackupName(file.name);
  const filename = unpacked
    ? unpacked.title
    : file.name.replace(/\.(md|markdown|txt)$/i, "");
  return importMarkdownText(text, filename);
};

const deleteLocalFile = async (fileId: string) => {
  const metas = await getFileMetas(fileId);
  const ids = metas.map((m) => m.id);
  await deleteFileAllMeta(fileId);
  await deleteContents(ids);
};

type MergedListProps = {
  localItems: FileSummary[];
  cloudItems: SyncFile[];
  dbxLoading: boolean;
  search: string;
  onRefetch: () => void;
  onDbxImport: (f: SyncFile) => void;
};

const MergedList: Component<MergedListProps> = (props) => {
  const navigate = useNavigate();
  const [debouncedSearch, setDebouncedSearch] = createSignal(props.search);
  const [filtering, setFiltering] = createSignal(false);
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const [openMenu, setOpenMenu] = createSignal<string | null>(null);

  createEffect(() => {
    const q = props.search;
    if (q === debouncedSearch()) return;
    setFiltering(true);
    const id = setTimeout(() => {
      setDebouncedSearch(q);
      setFiltering(false);
    }, 500);
    onCleanup(() => clearTimeout(id));
  });

  const merged = (): ListItem[] => {
    const q = debouncedSearch();
    const locals: ListItem[] = props.localItems
      .filter(
        (f) =>
          fuzzyMatch(q, f.filename) || f.tags.some((t) => fuzzyMatch(q, t)),
      )
      .map((f) => ({
        kind: "local" as const,
        fileId: f.fileId,
        docId: f.docId,
        filename: f.filename,
        sortAt: new Date(f.lastUsedAt).getTime(),
        lastUsedAt: f.lastUsedAt,
        tags: f.tags,
      }));
    const clouds: ListItem[] = props.cloudItems
      .filter((f) => {
        const title =
          unpackBackupName(f.name)?.title ??
          f.name.replace(/\.(md|markdown|txt)$/i, "");
        return fuzzyMatch(q, title);
      })
      .map((f) => {
        const title =
          unpackBackupName(f.name)?.title ??
          f.name.replace(/\.(md|markdown|txt)$/i, "");
        return {
          kind: "cloud" as const,
          file: f,
          displayName: title,
          sortAt: f.modifiedAt.getTime(),
        };
      });
    return [...locals, ...clouds].sort((a, b) => b.sortAt - a.sortAt);
  };

  const grouped = (): ItemGroup[] => {
    const items = merged();
    const groupMap = new Map<string, ListItem[]>();
    const singletons: ItemGroup[] = [];

    for (const item of items) {
      const docId =
        item.kind === "local"
          ? item.docId
          : unpackBackupName(item.file.name)?.id || undefined;
      if (docId) {
        if (!groupMap.has(docId)) groupMap.set(docId, []);
        groupMap.get(docId)!.push(item);
      } else {
        const key =
          item.kind === "local"
            ? `file:${item.fileId}`
            : `cloud:${item.file.name}`;
        singletons.push({ groupKey: key, docId: null, items: [item] });
      }
    }

    const docGroups: ItemGroup[] = [...groupMap.entries()].map(
      ([docId, its]) => ({ groupKey: docId, docId, items: its }),
    );

    return [...docGroups, ...singletons].sort(
      (a, b) => (b.items[0]?.sortAt ?? 0) - (a.items[0]?.sortAt ?? 0),
    );
  };

  const toggleExpand = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDelete = async (fileId: string) => {
    if (!confirm("Delete this file?")) return;
    await deleteLocalFile(fileId);
    props.onRefetch();
    toast.success("Deleted");
  };

  const handleFork = async (item: LocalListItem) => {
    const p = (async () => {
      const { md } = await loadRawMarkdown(item.fileId);
      const doc = await parseDocument(md);
      const fmData: Record<string, unknown> = {
        ...(doc.frontmatter?.data ?? {}),
        _id: genId(),
      };
      const fmType = doc.frontmatter?.type ?? "yaml";
      const newFm = await serializeFrontmatter(fmType, fmData);
      const newText = doc.body ? newFm + "\n" + doc.body : newFm;
      const newFileId = await importMarkdownText(newText, item.filename);
      navigate(`/edit/${newFileId}`);
      return item.filename;
    })();
    toast.promise(p, {
      loading: "Forking…",
      success: (name) => `Forked '${name}' as a new document`,
      error: (e) => `Fork failed: ${(e as Error).message}`,
    });
  };

  const total = () => props.localItems.length + props.cloudItems.length;

  const DropdownMenu = (p: {
    id: string;
    onFork: () => void;
    onDelete: () => void;
  }) => (
    <div class="file-menu-anchor">
      <button
        title="Menu"
        onClick={() => setOpenMenu((prev) => (prev === p.id ? null : p.id))}
      >
        <TbOutlineDots />
      </button>
      <Show when={openMenu() === p.id}>
        <div class="file-dropdown">
          <div
            class="file-dropdown-item"
            onClick={() => {
              setOpenMenu(null);
              p.onFork();
            }}
          >
            <TbOutlineGitBranch /> Fork
          </div>
          <div
            class="file-dropdown-item danger"
            onClick={() => {
              setOpenMenu(null);
              p.onDelete();
            }}
          >
            <TbOutlineTrash /> Delete
          </div>
        </div>
      </Show>
    </div>
  );

  const ChevronSlot = (p: { groupKey: string; hasExtras: boolean }) => (
    <span
      class={`file-chevron${p.hasExtras ? " clickable" : ""}`}
      onClick={() => p.hasExtras && toggleExpand(p.groupKey)}
      title={
        p.hasExtras
          ? expanded().has(p.groupKey)
            ? "Collapse"
            : "Show older versions"
          : undefined
      }
    >
      <Show when={p.hasExtras}>
        {expanded().has(p.groupKey) ? (
          <TbOutlineChevronDown />
        ) : (
          <TbOutlineChevronRight />
        )}
      </Show>
    </span>
  );

  const CloudFileInfo = (p: { item: CloudListItem; onClick: () => void }) => (
    <a
      class="file-info"
      href="#"
      onClick={(e) => {
        e.preventDefault();
        p.onClick();
      }}
    >
      <span>
        <TbFillCloud class="file-cloud-icon" /> {p.item.displayName}
      </span>
      <small>
        {formatDateTime(p.item.file.modifiedAt)}
        <Show when={p.item.file.size !== undefined}>
          {" · "}
          {formatSize(p.item.file.size!)}
        </Show>
      </small>
    </a>
  );

  return (
    <Show
      when={grouped().length > 0 || props.dbxLoading}
      fallback={
        <p>
          <small>No files. Create a new one or drop a text file here.</small>
        </p>
      }
    >
      <ul class="files">
        <Show when={props.dbxLoading}>
          <li>
            <small>Loading from cloud…</small>
          </li>
        </Show>
        <Show when={props.search}>
          <li class="files-search-count">
            <small>
              {filtering()
                ? "Filtering…"
                : `${merged().length} / ${total()} files`}
            </small>
          </li>
        </Show>
        <For each={grouped()}>
          {(group) => {
            const head = group.items[0];
            const extras = () => group.items.slice(1);
            return (
              <>
                <li>
                  <ChevronSlot
                    groupKey={group.groupKey}
                    hasExtras={extras().length > 0}
                  />
                  {head.kind === "local" ? (
                    <>
                      <A href={`/edit/${head.fileId}`} class="file-info">
                        <span>{head.filename}</span>
                        <Show when={head.tags.length > 0}>
                          <div class="file-tags">
                            <For each={head.tags}>
                              {(tag) => (
                                <span
                                  class="badge"
                                  style={{ background: tagColor(tag) }}
                                >
                                  {tag}
                                </span>
                              )}
                            </For>
                          </div>
                        </Show>
                        <small>
                          {formatDateTime(new Date(head.lastUsedAt))}
                        </small>
                      </A>
                      <DropdownMenu
                        id={head.fileId}
                        onFork={() => void handleFork(head as LocalListItem)}
                        onDelete={() => void handleDelete(head.fileId)}
                      />
                    </>
                  ) : (
                    <CloudFileInfo
                      item={head as CloudListItem}
                      onClick={() =>
                        props.onDbxImport((head as CloudListItem).file)
                      }
                    />
                  )}
                </li>

                <Show when={expanded().has(group.groupKey)}>
                  <For each={extras()}>
                    {(item) => (
                      <li class="version-item">
                        <ChevronSlot
                          groupKey={group.groupKey}
                          hasExtras={false}
                        />
                        {item.kind === "local" ? (
                          <>
                            <A href={`/edit/${item.fileId}`} class="file-info">
                              <span>{item.filename}</span>
                              <small>
                                {formatDateTime(new Date(item.lastUsedAt))}
                              </small>
                            </A>
                            <DropdownMenu
                              id={item.fileId}
                              onFork={() =>
                                void handleFork(item as LocalListItem)
                              }
                              onDelete={() => void handleDelete(item.fileId)}
                            />
                          </>
                        ) : (
                          <CloudFileInfo
                            item={item as CloudListItem}
                            onClick={() =>
                              props.onDbxImport((item as CloudListItem).file)
                            }
                          />
                        )}
                      </li>
                    )}
                  </For>
                </Show>
              </>
            );
          }}
        </For>
      </ul>
    </Show>
  );
};

const PROVIDER_LABELS: Record<SyncProviderName, string> = {
  dropbox: "Dropbox",
  onedrive: "OneDrive",
};

const FileListPage: Component = () => {
  const navigate = useNavigate();
  const [files, { refetch }] = createResource(loadFileList);
  const [search, setSearch] = createSignal("");

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
    const fileId = await createNewFile();
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

  const handleCleanOldVersions = async () => {
    const localItems = files() ?? [];

    // Group by docId
    const groupMap = new Map<string, string[]>(); // docId -> fileIds
    for (const f of localItems) {
      if (f.docId) {
        if (!groupMap.has(f.docId)) groupMap.set(f.docId, []);
        groupMap.get(f.docId)!.push(f.fileId);
      }
    }

    const toDelete: string[] = [];
    for (const [, fileIds] of groupMap) {
      if (fileIds.length > 1) {
        // Keep first (most recent, list is already sorted), delete rest
        toDelete.push(...fileIds.slice(1));
      }
    }

    if (toDelete.length === 0) {
      toast("No old versions to clean up");
      return;
    }

    if (
      !confirm(
        `Delete ${toDelete.length} old version(s)?\nOnly the most recent local copy of each group will be kept.`,
      )
    )
      return;

    await Promise.all(toDelete.map(deleteLocalFile));
    refetch();
    toast.success(`Cleaned up ${toDelete.length} old version(s)`);
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
            accept="text/*"
            class="hidden"
            onChange={handleFileInput}
          />
        </div>
      </Toolbar>

      <Show when={hasCloud}>
        <fieldset class="mb-sm">
          <legend>
            <TbFillCloud style={{ "vertical-align": "middle" }} /> Cloud Sync
          </legend>
          <Show when={authenticating()}>
            <small style={{ color: "var(--c-muted)" }}>Authenticating…</small>
          </Show>
          <Show
            when={!authenticating() && activeProvider() && cloudToken()}
            fallback={
              <Show when={!authenticating()}>
                <div
                  class="flex-row"
                  style={{ gap: "0.4rem", "align-items": "center" }}
                >
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
              </Show>
            }
          >
            <small class="dropbox-account">
              {PROVIDER_LABELS[activeProvider()!.name]}
              {" · "}
              {cloudToken()?.displayName ?? cloudToken()?.email ?? "Connected"}
            </small>
            <div
              class="flex-row"
              style={{
                "flex-wrap": "wrap",
                gap: "0.4rem",
                "margin-top": "0.4rem",
              }}
            >
              <Show
                when={cloudFiles() !== null}
                fallback={
                  <button
                    onClick={() => loadCloudFiles()}
                    disabled={cloudLoading()}
                  >
                    <TbFillCloud /> Show files
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
                    <TbOutlineCloudDown /> Load more
                  </button>
                </Show>
              </Show>
              <button
                class="danger"
                onClick={handleDisconnect}
                style={{ "margin-left": "auto" }}
              >
                Disconnect
              </button>
            </div>
          </Show>
        </fieldset>
      </Show>

      <Show when={!files.loading}>
        <div
          class="flex-row"
          style={{ gap: "0.4rem", "margin-bottom": "0.5rem" }}
        >
          <button
            onClick={handleCleanOldVersions}
            title="Remove all but the latest local version per group"
          >
            <TbOutlineTrash /> Clean old versions
          </button>
        </div>
      </Show>

      <Show when={files.loading}>
        <p>
          <small>Loading…</small>
        </p>
      </Show>

      <Show when={!files.loading}>
        <MergedList
          localItems={files() ?? []}
          cloudItems={cloudFiles() ?? []}
          dbxLoading={cloudLoading()}
          search={search()}
          onRefetch={refetch}
          onDbxImport={handleCloudImport}
        />
      </Show>

      <p style="margin-top: 2rem; text-align: center;">
        <A href="/about" style="font-size: 0.75rem; color: var(--c-muted);">
          About
        </A>
      </p>
    </main>
  );
};

export default FileListPage;

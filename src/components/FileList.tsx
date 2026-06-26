import {
  type Component,
  type Accessor,
  type Setter,
  createSignal,
  createMemo,
  createEffect,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { useNavigate, A } from "@solidjs/router";
import {
  TbOutlineTrash,
  TbFillCloud,
  TbOutlineChevronDown,
  TbOutlineChevronRight,
  TbOutlineDots,
  TbOutlineGitBranch,
  TbOutlineGitFork,
} from "solid-icons/tb";
import toast from "solid-toast";

import { serializeFrontmatter, parseDocument } from "../lib/md/frontmatter";
import { genId } from "../lib/utils/id";
import { createDebouncedSignal } from "../lib/utils/debounce";
import { loadRawMarkdown } from "../lib/export";
import { importMarkdownText } from "../states/editor";
import type { SyncFile } from "../lib/sync/interface";
import {
  type FileSummary,
  type LocalListItem,
  type CloudListItem,
  type ListItem,
  buildGroups,
  deleteLocalFile,
  formatDateTime,
  formatSize,
  tagColor,
} from "./file_list";

// ── Sub-components (module-level) ────────────────────────────────────────────

type DropdownMenuProps = {
  id: string;
  openMenu: Accessor<string | null>;
  setOpenMenu: Setter<string | null>;
  onRevise: () => void;
  onFork: () => void;
  onDelete: () => void;
};

const DropdownMenu: Component<DropdownMenuProps> = (props) => {
  let anchorEl: HTMLDivElement | undefined;

  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (
        props.openMenu() === props.id &&
        anchorEl &&
        !anchorEl.contains(e.target as Node)
      ) {
        props.setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    onCleanup(() => document.removeEventListener("mousedown", handler));
  });

  return (
    <div class="file-menu-anchor" ref={anchorEl}>
      <button
        title="Menu"
        onClick={() =>
          props.setOpenMenu((prev) => (prev === props.id ? null : props.id))
        }
      >
        <TbOutlineDots />
      </button>
      <Show when={props.openMenu() === props.id}>
        <div class="file-dropdown">
          <div
            class="file-dropdown-item"
            onClick={() => {
              props.setOpenMenu(null);
              props.onRevise();
            }}
          >
            <TbOutlineGitBranch /> Revise
          </div>
          <div
            class="file-dropdown-item"
            onClick={() => {
              props.setOpenMenu(null);
              props.onFork();
            }}
          >
            <TbOutlineGitFork /> Fork
          </div>
          <div
            class="file-dropdown-item danger"
            onClick={() => {
              props.setOpenMenu(null);
              props.onDelete();
            }}
          >
            <TbOutlineTrash /> Delete
          </div>
        </div>
      </Show>
    </div>
  );
};

type ChevronSlotProps = {
  groupKey: string;
  hasExtras: boolean;
  expanded: Accessor<Set<string>>;
  onToggle: (key: string) => void;
};

const ChevronSlot: Component<ChevronSlotProps> = (props) => (
  <span
    class={`file-chevron${props.hasExtras ? " clickable" : ""}`}
    onClick={() => props.hasExtras && props.onToggle(props.groupKey)}
    title={
      props.hasExtras
        ? props.expanded().has(props.groupKey)
          ? "Collapse"
          : "Show older versions"
        : undefined
    }
  >
    <Show when={props.hasExtras}>
      {props.expanded().has(props.groupKey) ? (
        <TbOutlineChevronDown />
      ) : (
        <TbOutlineChevronRight />
      )}
    </Show>
  </span>
);

type CloudFileInfoProps = {
  item: CloudListItem;
  openMenu: Accessor<string | null>;
  setOpenMenu: Setter<string | null>;
  onClick: () => void;
  onDelete: () => void;
};

const CloudFileInfo: Component<CloudFileInfoProps> = (props) => {
  let anchorEl: HTMLDivElement | undefined;

  onMount(() => {
    const handler = (e: MouseEvent) => {
      if (
        props.openMenu() === props.item.file.name &&
        anchorEl &&
        !anchorEl.contains(e.target as Node)
      ) {
        props.setOpenMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    onCleanup(() => document.removeEventListener("mousedown", handler));
  });

  return (
    <>
      <a
        class="file-info"
        href="#"
        onClick={(e) => {
          e.preventDefault();
          props.onClick();
        }}
      >
        <span>
          <TbFillCloud class="file-cloud-icon" /> {props.item.displayName}
        </span>
        <small>
          {formatDateTime(props.item.file.modifiedAt)}
          <Show when={props.item.file.size !== undefined}>
            {" · "}
            {formatSize(props.item.file.size!)}
          </Show>
        </small>
      </a>
      <div class="file-menu-anchor" ref={anchorEl}>
        <button
          title="Menu"
          onClick={() =>
            props.setOpenMenu((prev) =>
              prev === props.item.file.name ? null : props.item.file.name,
            )
          }
        >
          <TbOutlineDots />
        </button>
        <Show when={props.openMenu() === props.item.file.name}>
          <div class="file-dropdown">
            <div
              class="file-dropdown-item danger"
              onClick={() => {
                props.setOpenMenu(null);
                props.onDelete();
              }}
            >
              <TbOutlineTrash /> Delete
            </div>
          </div>
        </Show>
      </div>
    </>
  );
};

// ── FileList ─────────────────────────────────────────────────────────────────

type FileListProps = {
  localItems: FileSummary[];
  cloudItems: SyncFile[];
  cloudLoading: boolean;
  search: string;
  onRefetch: () => void;
  onCloudImport: (f: SyncFile) => void;
  onCloudDelete: (f: SyncFile) => void;
};

const FileList: Component<FileListProps> = (props) => {
  const navigate = useNavigate();
  const [debouncedSearch, setDebouncedSearch] = createDebouncedSignal(
    props.search,
    500,
  );
  const [expanded, setExpanded] = createSignal(new Set<string>());
  const [openMenu, setOpenMenu] = createSignal<string | null>(null);

  createEffect(() => setDebouncedSearch(props.search));
  const filtering = createMemo(() => props.search !== debouncedSearch());

  const grouped = createMemo(() =>
    buildGroups(props.localItems, props.cloudItems, debouncedSearch()),
  );

  const filteredCount = createMemo(() =>
    grouped().reduce((n, g) => n + g.items.length, 0),
  );

  const total = () => props.localItems.length + props.cloudItems.length;

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

  const forkOrRevise = async (
    item: LocalListItem,
    newId: boolean,
  ): Promise<string> => {
    const { md } = await loadRawMarkdown(item.fileId);
    const doc = await parseDocument(md);
    const fmData: Record<string, unknown> = {
      ...(doc.frontmatter?.data ?? {}),
      ...(newId ? { _id: genId() } : {}),
    };
    const fmType = doc.frontmatter?.type ?? "yaml";
    const newFm = await serializeFrontmatter(fmType, fmData);
    const newText = doc.body ? newFm + "\n" + doc.body : newFm;
    const newFileId = await importMarkdownText(newText, item.filename);
    navigate(`/edit/${newFileId}`);
    return item.filename;
  };

  const handleRevise = (item: LocalListItem) => {
    const p = forkOrRevise(item, false);
    toast.promise(p, {
      loading: "Revising…",
      success: (name) => `Revising '${name}'`,
      error: (e) => `Revise failed: ${(e as Error).message}`,
    });
  };

  const handleFork = (item: LocalListItem) => {
    const p = forkOrRevise(item, true);
    toast.promise(p, {
      loading: "Forking…",
      success: (name) => `Forked '${name}' as a new document`,
      error: (e) => `Fork failed: ${(e as Error).message}`,
    });
  };

  const renderItem = (item: ListItem) => {
    if (item.kind === "local") {
      return (
        <>
          <A href={`/edit/${item.fileId}`} class="file-info">
            <span>{item.filename}</span>
            <Show when={item.tags.length > 0}>
              <div class="file-tags">
                <For each={item.tags}>
                  {(tag) => (
                    <span class="badge" style={{ background: tagColor(tag) }}>
                      {tag}
                    </span>
                  )}
                </For>
              </div>
            </Show>
            <small>{formatDateTime(new Date(item.lastUsedAt))}</small>
          </A>
          <DropdownMenu
            id={item.fileId}
            openMenu={openMenu}
            setOpenMenu={setOpenMenu}
            onRevise={() => handleRevise(item)}
            onFork={() => handleFork(item)}
            onDelete={() => void handleDelete(item.fileId)}
          />
        </>
      );
    }
    return (
      <CloudFileInfo
        item={item}
        openMenu={openMenu}
        setOpenMenu={setOpenMenu}
        onClick={() => props.onCloudImport(item.file)}
        onDelete={() => props.onCloudDelete(item.file)}
      />
    );
  };

  return (
    <Show
      when={grouped().length > 0 || props.cloudLoading}
      fallback={
        <p>
          <small>No files. Create a new one or drop a text file here.</small>
        </p>
      }
    >
      <ul class="files">
        <Show when={props.cloudLoading}>
          <li>
            <small>Loading from cloud…</small>
          </li>
        </Show>
        <Show when={props.search}>
          <li class="files-search-count">
            <small>
              {filtering()
                ? "Filtering…"
                : `${filteredCount()} / ${total()} files`}
            </small>
          </li>
        </Show>
        <For each={grouped()}>
          {(group) => {
            const head = group.items[0];
            const extras = group.items.slice(1);
            return (
              <>
                <li>
                  <ChevronSlot
                    groupKey={group.groupKey}
                    hasExtras={extras.length > 0}
                    expanded={expanded}
                    onToggle={toggleExpand}
                  />
                  {renderItem(head)}
                </li>
                <Show when={expanded().has(group.groupKey)}>
                  <For each={extras}>
                    {(item) => (
                      <li class="version-item">
                        <ChevronSlot
                          groupKey={group.groupKey}
                          hasExtras={false}
                          expanded={expanded}
                          onToggle={toggleExpand}
                        />
                        {renderItem(item)}
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

export default FileList;

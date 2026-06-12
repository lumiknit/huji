import {
  type Component,
  type Accessor,
  type Setter,
  createSignal,
  createMemo,
  createEffect,
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
} from "solid-icons/tb";
import toast from "solid-toast";

import {
  serializeFrontmatter,
  parseDocument,
} from "../lib/md/frontmatter";
import { genId } from "../lib/utils/id";
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
  onFork: () => void;
  onDelete: () => void;
};

const DropdownMenu: Component<DropdownMenuProps> = (props) => (
  <div class="file-menu-anchor">
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
            props.onFork();
          }}
        >
          <TbOutlineGitBranch /> Fork
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
  onClick: () => void;
};

const CloudFileInfo: Component<CloudFileInfoProps> = (props) => (
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
);

// ── FileList ─────────────────────────────────────────────────────────────────

type FileListProps = {
  localItems: FileSummary[];
  cloudItems: SyncFile[];
  cloudLoading: boolean;
  search: string;
  onRefetch: () => void;
  onCloudImport: (f: SyncFile) => void;
};

const FileList: Component<FileListProps> = (props) => {
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

  const handleFork = (item: LocalListItem) => {
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
            onFork={() => handleFork(item)}
            onDelete={() => void handleDelete(item.fileId)}
          />
        </>
      );
    }
    return (
      <CloudFileInfo
        item={item}
        onClick={() => props.onCloudImport(item.file)}
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

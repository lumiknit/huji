import {
  type Component,
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  untrack,
  For,
  Show,
} from "solid-js";
import { useParams, useNavigate, useSearchParams, A } from "@solidjs/router";
import {
  TbOutlineDeviceFloppy,
  TbOutlineEye,
  TbOutlineRotate,
  TbOutlineRotateClockwise,
  TbOutlineSearch,
  TbOutlinePlus,
  TbOutlineTrash,
  TbOutlineWand,
  TbOutlineHome,
  TbOutlineDownload,
  TbOutlinePaperclip,
  TbOutlineShare,
  TbOutlineCursorText,
  TbOutlineCloud,
  TbOutlineCopy,
} from "solid-icons/tb";
import toast from "solid-toast";

import {
  editorState,
  loadFile,
  switchSection,
  notifyEdit,
  flushSave,
  setTextareaRef,
  setActiveSectionId,
  loadSectionContent,
  loadAllContent,
  saveWholeContent,
  addSection,
  addSectionBefore,
  deleteSection,
  disposeEditor,
  popSectionSelection,
  popPendingJump,
  setSectionSelection,
  getCurrentDocId,
} from "../states/editor";
import { settingsSignals, defaultRemoteProvider } from "../states/settings";
import { buildSectionLabel } from "../lib/md/section";
import {
  extractFrontmatter,
  serializeFrontmatter,
} from "../lib/md/frontmatter";
import { loadRawMarkdown, downloadBlob } from "../lib/export";
import { importMarkdownText } from "../states/editor";
import { sanitizeFilename, packBackupName } from "../lib/path";
import { getProvider } from "../lib/sync/provider";
import type { SyncProviderName } from "../lib/sync/interface";
import ToggleMenu from "../components/ToggleMenu";
import MarkdownView from "../components/MarkdownView";
import FileDrop from "../components/FileDrop";
import Toolbar from "../components/Toolbar";
import type { SectionMeta } from "../lib/db/schema";

const ALL_ID = "__all__";

type SaveOrBackupButtonProps = {
  status: () => string;
  onSave: () => void;
  onBackup: () => void;
  canBackup: () => boolean;
};

const SaveOrBackupButton: Component<SaveOrBackupButtonProps> = (props) => {
  const isSaved = () => props.status() === "saved";
  return (
    <Show
      when={isSaved()}
      fallback={
        <button
          class="primary"
          disabled={props.status() === "saving"}
          onClick={props.onSave}
          title="Save"
        >
          <TbOutlineDeviceFloppy />
        </button>
      }
    >
      <button
        disabled={!props.canBackup()}
        onClick={props.onBackup}
        title="Backup to cloud"
      >
        <TbOutlineCloud />
      </button>
    </Show>
  );
};

const EditorPage: Component = () => {
  const params = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReadonly = () => searchParams.readonly !== undefined;

  const [contextContents, setContextContents] = createSignal<
    Record<string, string>
  >({});
  const [fmError, setFmError] = createSignal("");

  let textareaEl: HTMLTextAreaElement | null = null;
  let wholeEl: HTMLTextAreaElement | null = null;
  let textareaContainerEl: HTMLDivElement | null = null;

  const activeMeta = createMemo(() =>
    editorState.metas().find((m) => m.id === editorState.activeSectionId()),
  );
  const isFrontmatter = createMemo(() => activeMeta()?.level === -1);

  const fmMetas = createMemo(() =>
    editorState.metas().filter((m) => m.level === -1),
  );
  const bodyMetas = createMemo(() =>
    editorState.metas().filter((m) => m.level >= 0),
  );

  // Pre-compute labels once per metas change, keyed by section id
  const sectionLabels = createMemo(() => {
    const list = editorState.metas();
    const map = new Map<string, string>();
    list.forEach((_, i) => {
      if (list[i].level >= 0) map.set(list[i].id, buildSectionLabel(list, i));
    });
    return map;
  });

  const activeIdx = createMemo(() => {
    const id = editorState.activeSectionId();
    return editorState.metas().findIndex((m) => m.id === id);
  });

  const prevSection = createMemo(() => {
    const idx = activeIdx();
    if (idx <= 0) return null;
    return editorState.metas()[idx - 1] ?? null;
  });

  const nextSection = createMemo(() => {
    const list = editorState.metas();
    const idx = activeIdx();
    if (idx === -1) return null;
    return list[idx + 1] ?? null;
  });

  const scrollToEditor = () => {
    if (!textareaContainerEl) return;
    const r = textareaContainerEl.getBoundingClientRect();
    if (r.bottom < 0) {
      // textarea is above — scroll down to it, cursor at end
      textareaContainerEl.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
      if (textareaEl) {
        const len = textareaEl.value.length;
        textareaEl.setSelectionRange(len, len);
      }
    } else if (r.top > window.innerHeight) {
      // textarea is below — scroll up to it, cursor at start
      textareaContainerEl.scrollIntoView({ behavior: "smooth", block: "end" });
      if (textareaEl) textareaEl.setSelectionRange(0, 0);
    }
  };

  const prettifyFrontmatter = async () => {
    if (!textareaEl || !isFrontmatter()) return;
    try {
      const info = await extractFrontmatter(textareaEl.value);
      if (!info) {
        setFmError("Invalid frontmatter");
        return;
      }
      const pretty = await serializeFrontmatter(info.type, info.data);
      textareaEl.value = pretty;
      setFmError("");
      notifyEdit();
    } catch (e) {
      setFmError(String(e));
    }
  };

  onMount(async () => {
    await loadFile(params.fileId);
    const list = editorState.metas();
    const jump = popPendingJump();
    if (jump) {
      setSectionSelection(jump.sectionId, {
        start: jump.start,
        end: jump.end,
      });
      await switchSection(jump.sectionId);
    } else {
      const first = list.find((m) => m.level !== -1) ?? list[0];
      if (first) await switchSection(first.id);
    }
  });

  onCleanup(() => disposeEditor());

  onMount(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (editorState.saveStatus() === "dirty") {
        e.preventDefault();
      }
    };
    window.addEventListener("beforeunload", handler);
    onCleanup(() => window.removeEventListener("beforeunload", handler));
  });

  createEffect(async () => {
    const id = editorState.activeSectionId();
    if (!id || id === ALL_ID) return;
    const content = await loadSectionContent(id);
    if (editorState.activeSectionId() !== id) return; // race condition guard
    if (textareaEl) {
      textareaEl.value = content;
      textareaEl.focus();
      const sel = popSectionSelection(id);
      if (sel) {
        const len = content.length;
        textareaEl.setSelectionRange(
          Math.min(sel.start, len),
          Math.min(sel.end, len),
        );
      }
      scrollToEditor();
    }
  });

  createEffect(async () => {
    const id = editorState.activeSectionId();
    const ctx = settingsSignals.contextSections();
    if (!id || id === ALL_ID) return;

    // Drop the active section from cache so it re-fetches after save
    setContextContents((prev) => {
      if (prev[id] === undefined) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });

    const list = editorState.metas();
    const idx = list.findIndex((m) => m.id === id);
    for (
      let i = Math.max(0, idx - ctx);
      i <= Math.min(list.length - 1, idx + ctx);
      i++
    ) {
      const sid = list[i].id;
      if (sid !== id && untrack(() => contextContents()[sid]) === undefined) {
        const content = await loadSectionContent(sid);
        setContextContents((prev) => ({ ...prev, [sid]: content }));
      }
    }
  });

  const handleSectionChange = async (e: Event) => {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === "__outline__") {
      navigate(`/reorder/${params.fileId}`);
      return;
    }
    if (id === ALL_ID) {
      await switchSection(null);
      setActiveSectionId(ALL_ID);
    } else {
      await switchSection(id);
    }
  };

  const handleKeyDown = (
    e: KeyboardEvent & { currentTarget: HTMLTextAreaElement },
  ) => {
    if (
      e.key === "ArrowUp" &&
      e.currentTarget.selectionStart === 0 &&
      e.currentTarget.selectionEnd === 0
    ) {
      e.preventDefault();
      const prev = prevSection();
      if (prev) {
        setSectionSelection(prev.id, { start: Infinity, end: Infinity });
        switchSection(prev.id);
      }
    }
    if (
      e.key === "ArrowDown" &&
      e.currentTarget.selectionStart === e.currentTarget.value.length
    ) {
      e.preventDefault();
      const next = nextSection();
      if (next) switchSection(next.id);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      navigate(`/find/${params.fileId}`);
    }
  };

  const contextRange = createMemo(() => {
    const ctx = settingsSignals.contextSections();
    const list = editorState.metas();
    const idx = activeIdx();
    if (idx === -1)
      return { before: [] as SectionMeta[], after: [] as SectionMeta[] };
    return {
      before: list.slice(Math.max(0, idx - ctx), idx),
      after: list.slice(idx + 1, idx + 1 + ctx),
    };
  });

  const mode = createMemo(() => {
    const id = editorState.activeSectionId();
    if (id === ALL_ID) return "all";
    if (id) return "single";
    return "none";
  });

  const handleAddSectionBefore = async () => {
    const id = editorState.activeSectionId();
    if (!id || id.startsWith("__")) return;
    try {
      const newId = await addSectionBefore(id);
      if (newId) {
        await switchSection(newId);
        requestAnimationFrame(() => {
          if (!textareaEl) return;
          const val = textareaEl.value;
          const titleStart = val.indexOf("Title here");
          if (titleStart !== -1) {
            textareaEl.setSelectionRange(titleStart, titleStart + 10);
            textareaEl.focus();
          }
        });
      }
    } catch (e) {
      console.error("Failed to add section:", e);
      toast.error("Failed to add section");
    }
  };

  const handleAddSection = async (afterId?: string) => {
    try {
      const id = afterId ?? editorState.activeSectionId();
      const newId = await addSection(
        id && !id.startsWith("__") ? id : undefined,
      );
      if (newId) {
        await switchSection(newId);
        // Select "Title here" in the new section's textarea for immediate editing
        requestAnimationFrame(() => {
          if (!textareaEl) return;
          const val = textareaEl.value;
          const titleStart = val.indexOf("Title here");
          if (titleStart !== -1) {
            textareaEl.setSelectionRange(titleStart, titleStart + 10);
            textareaEl.focus();
          }
        });
      }
    } catch (e) {
      console.error("Failed to add section:", e);
      toast.error("Failed to add section");
    }
  };

  const handleDuplicate = () => {
    const p = (async () => {
      const { md, filename } = await loadRawMarkdown(params.fileId);
      const newName = `${sanitizeFilename(filename.replace(/\.[^.]+$/, ""))} (copy)`;
      const newId = await importMarkdownText(md, newName);
      navigate(`/edit/${newId}`);
      return newName;
    })();
    toast.promise(p, {
      loading: "Duplicating…",
      success: (name) => `Duplicated: ${name}`,
      error: () => "Duplicate failed",
    });
  };

  const handleDownload = async () => {
    try {
      const { md, filename } = await loadRawMarkdown(params.fileId);
      const base = sanitizeFilename(filename.replace(/\.[^.]+$/, ""));
      downloadBlob(md, "text/markdown", `${base}.md`);
    } catch (e) {
      console.error("Download failed:", e);
      toast.error("Download failed");
    }
  };

  const handleShare = async () => {
    try {
      const { md, filename } = await loadRawMarkdown(params.fileId);
      const base = sanitizeFilename(filename.replace(/\.[^.]+$/, ""));
      const file = new File([md], `${base}.md`, { type: "text/markdown" });
      if (!navigator.share) {
        toast.error("Share is not supported in this browser");
        return;
      }
      await navigator.share({ files: [file], title: base });
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      console.error("Share failed:", e);
      toast.error("Share failed");
    }
  };

  const canBackup = () => {
    const name = defaultRemoteProvider();
    if (!name) return false;
    const provider = getProvider(name as SyncProviderName);
    return !!provider?.loadToken();
  };

  const handleBackup = (providerName?: string) => {
    const name = providerName ?? defaultRemoteProvider();
    if (!name) {
      toast.error("No default backup provider set");
      return;
    }
    const provider = getProvider(name as SyncProviderName);
    if (!provider) {
      toast.error(`Unknown provider: ${name}`);
      return;
    }
    const p = (async () => {
      const { md, filename } = await loadRawMarkdown(params.fileId);
      const base = sanitizeFilename(filename.replace(/\.[^.]+$/, ""));
      const backupName = `${packBackupName(base, getCurrentDocId() ?? "")}.md`;
      const token = await provider.ensureToken();
      await provider.upload(
        token,
        backupName,
        new Blob([md], { type: "text/markdown" }),
      );
      return backupName;
    })();
    toast.promise(p, {
      loading: `Backing up to ${name}…`,
      success: (n) => `Saved: ${n}`,
      error: (e) => `Backup failed: ${(e as Error).message}`,
    });
  };

  const handleDeleteSection = async () => {
    const id = editorState.activeSectionId();
    if (!id || id.startsWith("__")) return;
    if (!confirm("Delete this section?")) return;
    try {
      const list = editorState.metas();
      const idx = list.findIndex((m) => m.id === id);
      await deleteSection(id);
      const updated = editorState.metas();
      const next = updated[Math.min(idx, updated.length - 1)];
      if (next) await switchSection(next.id);
    } catch (e) {
      console.error("Failed to delete section:", e);
      toast.error("Failed to delete section");
    }
  };

  const handleWholeSave = async () => {
    if (!wholeEl) return;
    try {
      await saveWholeContent(wholeEl.value);
    } catch (e) {
      console.error("Failed to save:", e);
      toast.error("Failed to save");
    }
  };

  let fileInsertEl: HTMLInputElement | undefined;

  const handleFileInsert = (e: Event) => {
    const input = e.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    input.value = "";
    handleFileDrop(file);
  };

  const handleSave = () => {
    if (mode() === "all") handleWholeSave();
    else flushSave();
  };

  const handleFileDrop = (file: File) => {
    if (!textareaEl) return;
    file.text().then((text) => {
      const start = textareaEl!.selectionStart;
      const end = textareaEl!.selectionEnd;
      const prev = textareaEl!.value;
      textareaEl!.value = prev.slice(0, start) + text + prev.slice(end);
      textareaEl!.selectionStart = textareaEl!.selectionEnd =
        start + text.length;
      notifyEdit();
    });
  };

  return (
    <main>
      <FileDrop onDrop={handleFileDrop} label="Insert as raw text" />
      <Toolbar title={`Edit — ${editorState.filename()}`}>
        <A href="/" title="File list">
          <TbOutlineHome />
        </A>
        <ToggleMenu label="File">
          <Show when={!isReadonly()}>
            <button
              onClick={() =>
                window.open(
                  `${window.location.href.split("?")[0]}?readonly`,
                  "_blank",
                  "width=800,height=600",
                )
              }
            >
              <TbOutlineEye /> Popup View
            </button>
            <hr />
          </Show>
          <Show when={!isReadonly()}>
            <button onClick={handleDuplicate}>
              <TbOutlineCopy /> Duplicate
            </button>
            <hr />
          </Show>
          <button onClick={handleDownload}>
            <TbOutlineDownload /> Download (.md)
          </button>
          <button onClick={handleShare}>
            <TbOutlineShare /> Share
          </button>
          <Show when={canBackup()}>
            <button onClick={() => handleBackup()}>
              <TbOutlineCloud /> Backup to {defaultRemoteProvider() || "cloud"}
            </button>
          </Show>
        </ToggleMenu>

        <Show when={!isReadonly()}>
          <ToggleMenu label="Edit">
            <button
              onClick={() =>
                textareaEl?.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "z",
                    ctrlKey: true,
                    bubbles: true,
                  }),
                )
              }
            >
              <TbOutlineRotate /> Undo
            </button>
            <button
              onClick={() =>
                textareaEl?.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "z",
                    ctrlKey: true,
                    shiftKey: true,
                    bubbles: true,
                  }),
                )
              }
            >
              <TbOutlineRotateClockwise /> Redo
            </button>
            <hr />
            <button onClick={() => navigate(`/find/${params.fileId}`)}>
              <TbOutlineSearch /> Find / Replace
            </button>
            <Show when={isFrontmatter()}>
              <hr />
              <button onClick={prettifyFrontmatter}>
                <TbOutlineWand /> Prettify
              </button>
            </Show>
            <hr />
            <button onClick={() => handleAddSection()}>
              <TbOutlinePlus /> Add section
            </button>
            <button onClick={handleDeleteSection}>
              <TbOutlineTrash /> Delete section
            </button>
            <hr />
            <button onClick={() => fileInsertEl?.click()}>
              <TbOutlinePaperclip /> Insert file
            </button>
            <input
              ref={fileInsertEl}
              type="file"
              class="hidden"
              onChange={handleFileInsert}
            />
          </ToggleMenu>
        </Show>

        <span class="spacer" />

        <Show when={mode() === "single"}>
          <button onClick={scrollToEditor} title="Jump to editor">
            <TbOutlineCursorText />
          </button>
        </Show>
        <A href={`/preview/${params.fileId}`} title="Preview">
          <TbOutlineEye />
        </A>
        <Show when={!isReadonly()}>
          <SaveOrBackupButton
            status={editorState.saveStatus}
            onSave={handleSave}
            onBackup={() => handleBackup()}
            canBackup={canBackup}
          />
        </Show>

        {/* Section select — wraps to next line via flex-wrap */}
        <select onChange={handleSectionChange}>
          <optgroup label="Special">
            <option
              value="__outline__"
              selected={editorState.activeSectionId() === "__outline__"}
            >
              Outline / Reorder
            </option>
            <option
              value={ALL_ID}
              selected={editorState.activeSectionId() === ALL_ID}
            >
              Whole file
            </option>
          </optgroup>
          <Show when={fmMetas().length > 0}>
            <optgroup label="FrontMatter">
              <For each={fmMetas()}>
                {(m) => (
                  <option
                    value={m.id}
                    selected={editorState.activeSectionId() === m.id}
                  >
                    [{m.heading}]
                  </option>
                )}
              </For>
            </optgroup>
          </Show>
          <optgroup label="Sections">
            <For each={bodyMetas()}>
              {(m) => (
                <option
                  value={m.id}
                  selected={editorState.activeSectionId() === m.id}
                >
                  {sectionLabels().get(m.id) ?? m.heading}
                </option>
              )}
            </For>
          </optgroup>
        </select>
      </Toolbar>

      <Show when={mode() === "all"}>
        <textarea
          class="edit"
          placeholder="Write here!"
          spellcheck={settingsSignals.spellcheck()}
          readOnly={isReadonly()}
          ref={(el) => {
            wholeEl = el;
            loadAllContent().then((content) => {
              el.value = content;
              el.focus();
            });
          }}
          onInput={() => !isReadonly() && notifyEdit()}
          onBlur={isReadonly() ? undefined : handleWholeSave}
        />
      </Show>

      <Show when={mode() === "single"}>
        <For each={contextRange().before}>
          {(m) => (
            <div class="section-preview">
              <Show
                when={!settingsSignals.contextRaw() && m.level !== -1}
                fallback={
                  <pre class="pre-wrap">{contextContents()[m.id] ?? ""}</pre>
                }
              >
                <MarkdownView
                  sectionId={m.id}
                  content={contextContents()[m.id] ?? ""}
                />
              </Show>
            </div>
          )}
        </For>

        <div class="section-nav">
          <Show when={prevSection()}>
            {(prev) => (
              <button
                onClick={() => {
                  setSectionSelection(prev().id, {
                    start: Infinity,
                    end: Infinity,
                  });
                  switchSection(prev().id);
                }}
              >
                ← Prev section
              </button>
            )}
          </Show>
          <Show when={!isReadonly()}>
            <button onClick={handleAddSectionBefore}>+ Create Prev</button>
          </Show>
        </div>

        <div
          ref={(el) => {
            textareaContainerEl = el;
          }}
        >
          <textarea
            class="edit"
            placeholder="Write here!"
            spellcheck={settingsSignals.spellcheck()}
            readOnly={isReadonly()}
            ref={(el) => {
              textareaEl = el;
              setTextareaRef(el);
            }}
            onInput={() => {
              if (isReadonly()) return;
              notifyEdit();
              setFmError("");
            }}
            onBlur={
              isReadonly()
                ? undefined
                : async () => {
                    try {
                      const err = await flushSave();
                      setFmError(err);
                    } catch (e) {
                      console.error("Failed to save:", e);
                      toast.error("Failed to save");
                    }
                  }
            }
            onKeyDown={handleKeyDown}
          />
          <Show when={fmError()}>
            <p class="error-text">{fmError()}</p>
          </Show>
        </div>

        <div class="section-nav">
          <Show when={nextSection()}>
            {(next) => (
              <button onClick={() => switchSection(next().id)}>
                Next section →
              </button>
            )}
          </Show>
          <Show when={!isReadonly()}>
            <button
              onClick={() =>
                handleAddSection(editorState.activeSectionId() ?? undefined)
              }
            >
              + Create Next
            </button>
          </Show>
        </div>

        <For each={contextRange().after}>
          {(m) => (
            <div class="section-preview">
              <Show
                when={!settingsSignals.contextRaw() && m.level !== -1}
                fallback={
                  <pre class="pre-wrap">{contextContents()[m.id] ?? ""}</pre>
                }
              >
                <MarkdownView
                  sectionId={m.id}
                  content={contextContents()[m.id] ?? ""}
                />
              </Show>
            </div>
          )}
        </For>
      </Show>
    </main>
  );
};

export default EditorPage;

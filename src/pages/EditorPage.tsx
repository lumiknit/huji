import {
  type Component,
  createSignal,
  createEffect,
  createMemo,
  onMount,
  onCleanup,
  For,
  Show,
} from "solid-js";
import { useParams, useNavigate, useSearchParams, A } from "@solidjs/router";
import {
  TbOutlineEye,
  TbOutlineRotate,
  TbOutlineRotateClockwise,
  TbOutlineSearch,
  TbOutlinePlus,
  TbOutlineHome,
  TbOutlineDownload,
  TbOutlinePaperclip,
  TbOutlineShare,
  TbOutlineNote,
  TbOutlineCloudUpload,
  TbOutlineCopy,
  TbOutlineArrowUp,
  TbOutlineArrowDown,
} from "solid-icons/tb";
import toast from "solid-toast";

import {
  editorState,
  loadFile,
  goToSection,
  loadSectionContent,
  addSection,
  addSectionBefore,
  disposeEditor,
  popSectionSelection,
  popPendingJump,
  getCurrentDocId,
  importMarkdownText,
  setSectionCount,
  type GoToSectionOpts,
} from "../states/editor";
import { notifyEdit, flushSave, countText } from "../states/editor_save";
import {
  wakeLock,
  contextSections,
  contextRaw,
  defaultRemoteProvider,
  saveFormat,
  showWords,
  setShowWords,
} from "../states/settings";
import { loadRawMarkdown, downloadBlob, packMDBlob } from "../lib/export";
import { sanitizeFilename, packBackupName } from "../lib/path";
import { getProvider } from "../lib/sync/provider";
import type { SyncProviderName } from "../lib/sync/interface";
import Editor from "../components/editor/Editor";
import { createCommander } from "../components/editor/commander";
import ToggleMenu from "../components/ToggleMenu";
import FileDrop from "../components/FileDrop";
import Toolbar from "../components/Toolbar";
import FindReplaceModal from "../components/FindReplaceModal";
import Sticker from "../components/Sticker";
import { resetFindState, loadFindContents } from "../states/find";
import { stickerOpen, toggleSticker } from "../states/sticker";
import ContextSection from "../components/editor/ContextSection";
import SaveOrBackupButton from "../components/editor/SaveOrBackupButton";
import { scrollSelectionToCenter } from "../lib/utils/dom";
import type { SectionMeta } from "../lib/db/schema";

const EditorPage: Component = () => {
  const params = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReadonly = () => searchParams.readonly !== undefined;

  const [showFind, setShowFind] = createSignal(false);

  const editorCommander = createCommander();

  const openFind = async () => {
    const id = editorState.activeSectionId();
    if (id && !id.startsWith("__")) {
      try {
        await flushSave(id);
      } catch {
        toast.error("Fix invalid frontmatter before continuing");
        return;
      }
    }
    await loadFindContents();
    setShowFind(true);
  };

  // Wraps goToSection to surface a save failure (e.g. invalid frontmatter)
  // instead of silently keeping the current section active.
  const goToSectionSafe = async (
    nextId: string | null,
    opts?: GoToSectionOpts,
  ) => {
    const ok = await goToSection(nextId, opts);
    if (!ok) toast.error("Fix invalid frontmatter before leaving");
    return ok;
  };

  // Sections only — frontmatter is edited on the dedicated special-edit page.
  const bodyMetas = createMemo(() =>
    editorState.metas().filter((m) => m.level >= 0),
  );

  const sectionLabels = editorState.sectionLabels;

  const activeBodyIdx = createMemo(() => {
    const id = editorState.activeSectionId();
    return bodyMetas().findIndex((m) => m.id === id);
  });

  const prevSection = createMemo(() => {
    const idx = activeBodyIdx();
    if (idx <= 0) return null;
    return bodyMetas()[idx - 1] ?? null;
  });

  const nextSection = createMemo(() => {
    const idx = activeBodyIdx();
    if (idx === -1) return null;
    return bodyMetas()[idx + 1] ?? null;
  });

  // Navigates to the special-edit page for reorder/whole-file/frontmatter
  // editing, remembering the current section so "back" can return to it.
  const openSpecialEdit = (target: "reorder" | "all" | "frontmatter") => {
    const returnTo = editorState.activeSectionId();
    const qs = new URLSearchParams({ target });
    if (returnTo) qs.set("return_to", returnTo);
    navigate(`/edit/${params.fileId}/esp?${qs.toString()}`);
  };

  onMount(async () => {
    resetFindState();
    await loadFile(params.fileId);
    document.title = editorState.filename() || "Huji";
    const list = editorState.metas();
    const jump = popPendingJump();
    if (jump) {
      await goToSection(jump.sectionId, {
        selStart: jump.start,
        selEnd: jump.end,
      });
    } else {
      const first = list.find((m) => m.level !== -1) ?? list[0];
      if (first) await goToSection(first.id);
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

  onMount(() => {
    if (!wakeLock() || !("wakeLock" in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (document.visibilityState === "visible") {
        lock = await (
          navigator as Navigator & {
            wakeLock: { request(type: string): Promise<WakeLockSentinel> };
          }
        ).wakeLock
          .request("screen")
          .catch(() => null);
      }
    };
    acquire();
    const onVisible = () => acquire();
    document.addEventListener("visibilitychange", onVisible);
    onCleanup(() => {
      document.removeEventListener("visibilitychange", onVisible);
      lock?.release();
    });
  });

  createEffect(async () => {
    const target = editorState.activeSection(); // { equals: false }: fires on every goToSection
    editorState.activeContentVersion(); // also re-run on external content updates
    const id = target.id;
    if (!id) return;
    const content = await loadSectionContent(id);
    if (editorState.activeSectionId() !== id) return; // race condition guard
    setSectionCount(countText(content));
    const popped = popSectionSelection(id);
    const stored =
      target.selStart !== undefined
        ? { start: target.selStart, end: target.selEnd ?? target.selStart }
        : (popped ?? { start: 0, end: 0 });
    const len = content.length;
    requestAnimationFrame(() => {
      editorCommander.setValue(
        content,
        {
          anchor: Math.min(stored.start, len),
          head: Math.min(stored.end, len),
        },
        { resetHistory: true },
      );
      editorCommander.focus();
    });
  });

  const handleSectionChange = async (e: Event) => {
    const select = e.currentTarget as HTMLSelectElement;
    const id = select.value;
    if (id === "__reorder__" || id === "__all__" || id === "__frontmatter__") {
      const target =
        id === "__reorder__"
          ? "reorder"
          : id === "__all__"
            ? "all"
            : "frontmatter";
      openSpecialEdit(target);
      select.value = editorState.activeSectionId() ?? "";
      return;
    }
    await goToSectionSafe(id);
  };

  const contextRange = createMemo(() => {
    const ctx = contextSections();
    const list = bodyMetas();
    const idx = activeBodyIdx();
    if (idx === -1)
      return { before: [] as SectionMeta[], after: [] as SectionMeta[] };
    return {
      before: list.slice(Math.max(0, idx - ctx), idx),
      after: list.slice(idx + 1, idx + 1 + ctx),
    };
  });

  const mode = createMemo(() =>
    editorState.activeSectionId() ? "single" : "none",
  );

  const selectTitleHere = () => {
    const val = editorCommander.getValue();
    const titleStart = val.indexOf("Title here");
    if (titleStart !== -1) {
      editorCommander.focus();
      editorCommander.setSelection(titleStart, titleStart + 10);
    }
  };

  const handleAddSectionBefore = async () => {
    const id = editorState.activeSectionId();
    if (!id || id.startsWith("__")) return;
    try {
      const newId = await addSectionBefore(id);
      if (newId) {
        await goToSection(newId);
        requestAnimationFrame(selectTitleHere);
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
        await goToSection(newId);
        requestAnimationFrame(selectTitleHere);
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
      const fmt = saveFormat();
      const blob = await packMDBlob(md, { gzip: fmt === "md.gz" });
      downloadBlob(blob, "text/markdown", `${base}.${fmt}`);
    } catch (e) {
      console.error("Download failed:", e);
      toast.error("Download failed");
    }
  };

  const handleShare = async () => {
    try {
      const { md, filename } = await loadRawMarkdown(params.fileId);
      const base = sanitizeFilename(filename.replace(/\.[^.]+$/, ""));
      // Always share as plain .md — recipients may not support .md.gz.
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

  const canBackup = createMemo(() => {
    const name = defaultRemoteProvider();
    if (!name) return false;
    const provider = getProvider(name as SyncProviderName);
    if (!provider) return false;
    return !!provider.loadToken()?.refreshToken;
  });

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
      const fmt = saveFormat();
      const stem = packBackupName(base, getCurrentDocId() ?? "");
      const backupName = `${stem}.${fmt}`;
      const token = await provider.ensureToken();
      const blob = await packMDBlob(md, { gzip: fmt === "md.gz" });
      await provider.upload(token, backupName, blob);
      return backupName;
    })();
    toast.promise(p, {
      loading: `Backing up to ${name}…`,
      success: (n) => `Saved: ${n}`,
      error: (e) => `Backup failed: ${(e as Error).message}`,
    });
  };

  const [scrollPct, setScrollPct] = createSignal(0);
  const [showScrollPct, setShowScrollPct] = createSignal(false);
  let scrollHideTimer: ReturnType<typeof setTimeout> | undefined;

  let scrollRafId: number | null = null;
  const handleScroll = () => {
    if (scrollRafId !== null) return;
    scrollRafId = requestAnimationFrame(() => {
      scrollRafId = null;
      const container = editorCommander.getContainer();
      if (!container || mode() !== "single") return;
      const r = container.getBoundingClientRect();
      const centerY = window.innerHeight / 2;
      const pct = Math.round(
        Math.min(100, Math.max(0, ((centerY - r.top) / r.height) * 100)),
      );
      setScrollPct(pct);
      setShowScrollPct(true);
      clearTimeout(scrollHideTimer);
      scrollHideTimer = setTimeout(() => setShowScrollPct(false), 1000);
    });
  };

  onMount(() =>
    window.addEventListener("scroll", handleScroll, { passive: true }),
  );
  onCleanup(() => {
    window.removeEventListener("scroll", handleScroll);
    if (scrollRafId !== null) cancelAnimationFrame(scrollRafId);
    clearTimeout(scrollHideTimer);
  });

  const countLabel = () => {
    const { chars, words } = editorState.sectionCount();
    const n = showWords() ? words : chars;
    const unit = showWords() ? "w" : "c";
    return `${n.toLocaleString()} ${unit}`;
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
    const p = (async () => {
      const id = editorState.activeSectionId();
      if (id) {
        await flushSave(id);
      }
    })();
    toast.promise(p, {
      loading: "Saving…",
      success: "Saved",
      error: (e) => `Save failed: ${(e as Error).message}`,
    });
  };

  const handleFileDrop = (file: File) => {
    const id = editorState.activeSectionId();
    if (!id) return;
    file.text().then((text) => {
      editorCommander.insertAtCursor(text);
      notifyEdit(id);
    });
  };

  return (
    <main>
      <Show when={mode() === "single"}>
        <button
          class={`scroll-pct-indicator${showScrollPct() ? " visible" : ""}`}
          onClick={scrollSelectionToCenter}
          title="Jump to current selection"
        >
          {scrollPct()}%
        </button>
      </Show>
      <Show when={showFind()}>
        <FindReplaceModal
          fileId={params.fileId}
          onClose={() => setShowFind(false)}
        />
      </Show>
      <Show when={stickerOpen()}>
        <Sticker />
      </Show>
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
              <TbOutlineCloudUpload /> Backup to{" "}
              {defaultRemoteProvider() || "cloud"}
            </button>
          </Show>
        </ToggleMenu>

        <Show when={!isReadonly()}>
          <ToggleMenu label="Edit">
            <button onClick={() => editorCommander.undo()}>
              <TbOutlineRotate /> Undo
            </button>
            <button onClick={() => editorCommander.redo()}>
              <TbOutlineRotateClockwise /> Redo
            </button>
            <hr />
            <button onClick={openFind}>
              <TbOutlineSearch /> Find / Replace
            </button>
            <button onClick={toggleSticker}>
              <TbOutlineNote />{" "}
              {stickerOpen() ? "Hide Sticker" : "Show Sticker"}
            </button>
            <hr />
            <button onClick={() => handleAddSection()}>
              <TbOutlinePlus /> Add section
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

        <Show when={mode() === "single"}>
          <button
            class="count-label"
            classList={{ dim: editorState.saveStatus() !== "saved" }}
            onClick={() => setShowWords((v: boolean) => !v)}
          >
            {countLabel()}
          </button>
        </Show>

        <span class="spacer" />

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

        {/* Sticker toggle button & Section select */}
        <div class="toolbar-group">
          <button
            onClick={toggleSticker}
            title={stickerOpen() ? "Hide Sticker" : "Show Sticker"}
          >
            <TbOutlineNote />
          </button>
          <select onChange={handleSectionChange}>
            <optgroup label="Special">
              <option value="__reorder__">Outline / Reorder</option>
              <option value="__all__">Whole file</option>
              <option value="__frontmatter__">Frontmatter</option>
            </optgroup>
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
        </div>
      </Toolbar>

      <Show when={mode() === "single"}>
        <div class="section-preview-container section-preview-container-before">
          <For each={contextRange().before}>
            {(m) => <ContextSection meta={() => m} raw={contextRaw()} />}
          </For>
        </div>

        <div class="section-nav">
          <Show when={prevSection()}>
            {(prev) => (
              <button
                onClick={() => {
                  goToSectionSafe(prev().id, {
                    selStart: Infinity,
                    selEnd: Infinity,
                  });
                }}
              >
                <TbOutlineArrowUp /> Prev section
              </button>
            )}
          </Show>
          <Show when={!isReadonly()}>
            <button onClick={handleAddSectionBefore}>
              {" "}
              <TbOutlinePlus /> Create Prev
            </button>
          </Show>
        </div>

        <div>
          <Editor
            language="markdown"
            commander={editorCommander}
            readonly={isReadonly()}
            onChange={() => {
              if (isReadonly()) return;
              const id = editorState.activeSectionId();
              if (id) notifyEdit(id);
            }}
            onSave={() => handleSave()}
            onFind={() => openFind()}
            onPrevSection={() => {
              const prev = prevSection();
              if (prev)
                goToSectionSafe(prev.id, {
                  selStart: Infinity,
                  selEnd: Infinity,
                });
            }}
            onNextSection={() => {
              const next = nextSection();
              if (next) goToSectionSafe(next.id, { selStart: 0, selEnd: 0 });
            }}
          />
        </div>

        <div class="section-nav">
          <Show when={nextSection()}>
            {(next) => (
              <button
                onClick={() => {
                  goToSectionSafe(next().id, { selStart: 0, selEnd: 0 });
                }}
              >
                <TbOutlineArrowDown />
                Next section
              </button>
            )}
          </Show>
          <Show when={!isReadonly()}>
            <button
              onClick={() =>
                handleAddSection(editorState.activeSectionId() ?? undefined)
              }
            >
              <TbOutlinePlus /> Create Next
            </button>
          </Show>
        </div>

        <div class="section-preview-container section-preview-container-after">
          <For each={contextRange().after}>
            {(m) => <ContextSection meta={() => m} raw={contextRaw()} />}
          </For>
        </div>
      </Show>
    </main>
  );
};

export default EditorPage;

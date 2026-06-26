import {
  type Component,
  createSignal,
  createEffect,
  createMemo,
  createResource,
  onMount,
  onCleanup,
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
  TbOutlineWand,
  TbOutlineHome,
  TbOutlineDownload,
  TbOutlinePaperclip,
  TbOutlineShare,
  TbOutlineCursorText,
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
  loadAllContent,
  addSection,
  addSectionBefore,
  disposeEditor,
  popSectionSelection,
  popPendingJump,
  getCurrentDocId,
  importMarkdownText,
  setSectionCount,
  registerActiveTextarea,
} from "../states/editor";
import {
  notifyEdit,
  flushSave,
  saveWholeContent,
  countText,
} from "../states/editor_save";
import {
  wakeLock,
  spellcheck,
  autocorrect,
  autocapitalize,
  contextSections,
  contextRaw,
  defaultRemoteProvider,
  saveFormat,
  showWords,
  setShowWords,
  typewriterMode,
} from "../states/settings";
import {
  extractFrontmatter,
  serializeFrontmatter,
} from "../lib/md/frontmatter";
import { loadRawMarkdown, downloadBlob, packMDBlob } from "../lib/export";
import { sanitizeFilename, packBackupName } from "../lib/path";
import { getProvider } from "../lib/sync/provider";
import type { SyncProviderName } from "../lib/sync/interface";
import ToggleMenu from "../components/ToggleMenu";
import MarkdownView from "../components/MarkdownView";
import FileDrop from "../components/FileDrop";
import Toolbar from "../components/Toolbar";
import FindReplaceModal from "../components/FindReplaceModal";
import Sticker from "../components/Sticker";
import { resetFindState, loadFindContents } from "../states/find";
import { stickerOpen, toggleSticker } from "../states/sticker";
import type { SectionMeta } from "../lib/db/schema";

const ALL_ID = "__all__";

const setCaretOffset = (el: HTMLElement, start: number, end: number) => {
  const sel = window.getSelection();
  if (!sel) return;
  const findPos = (offset: number): [Node, number] | null => {
    let remaining = offset;
    const walk = (node: Node): [Node, number] | null => {
      if (node.nodeType === Node.TEXT_NODE) {
        const len = node.textContent?.length ?? 0;
        if (remaining <= len) return [node, remaining];
        remaining -= len;
        return null;
      }
      for (const child of node.childNodes) {
        const r = walk(child);
        if (r) return r;
      }
      return null;
    };
    return walk(el);
  };
  const s = findPos(start) ?? [el, 0];
  const e = findPos(end) ?? s;
  const range = document.createRange();
  range.setStart(s[0], s[1]);
  range.setEnd(e[0], e[1]);
  sel.removeAllRanges();
  sel.addRange(range);
};

type ContextSectionProps = {
  meta: () => SectionMeta;
  raw: boolean;
};

const ContextSection: Component<ContextSectionProps> = (props) => {
  const [content] = createResource(() => props.meta().id, loadSectionContent);
  return (
    <div class="section-preview">
      <Show
        when={!props.raw && props.meta().level !== -1}
        fallback={<pre class="pre-wrap">{content() ?? ""}</pre>}
      >
        <MarkdownView sectionId={props.meta().id} content={content() ?? ""} />
      </Show>
    </div>
  );
};

type SaveOrBackupButtonProps = {
  status: () => string;
  onSave: () => void;
  onBackup: () => void;
  canBackup: () => boolean;
};

const SaveOrBackupButton: Component<SaveOrBackupButtonProps> = (props) => {
  const isSaved = () => props.status() === "saved";
  const handleClick = () => {
    if (isSaved()) {
      props.onBackup();
    } else {
      props.onSave();
    }
  };
  return (
    <button
      class={isSaved() ? undefined : "primary"}
      disabled={isSaved() ? !props.canBackup() : props.status() === "saving"}
      onClick={handleClick}
      title={isSaved() ? "Backup to cloud" : "Save"}
    >
      <Show when={isSaved()} fallback={<TbOutlineDeviceFloppy />}>
        <TbOutlineCloudUpload />
      </Show>
    </button>
  );
};

const EditorPage: Component = () => {
  const params = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isReadonly = () => searchParams.readonly !== undefined;

  const [fmError, setFmError] = createSignal("");
  const [showFind, setShowFind] = createSignal(false);

  const openFind = async () => {
    const id = editorState.activeSectionId();
    if (id && !id.startsWith("__")) await flushSave(id);
    await loadFindContents();
    setShowFind(true);
  };

  let textareaEl: HTMLDivElement | null = null;
  let wholeEl: HTMLDivElement | null = null;

  let typewriterRafId: number | null = null;
  const scheduleTypewriterScroll = () => {
    if (!typewriterMode() || typewriterRafId !== null) return;
    typewriterRafId = requestAnimationFrame(() => {
      typewriterRafId = null;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.height === 0) return;
      const target =
        window.scrollY + rect.top + rect.height / 2 - window.innerHeight / 2;
      if (Math.abs(target - window.scrollY) < 8) return;
      window.scrollTo({ top: target, behavior: "smooth" });
    });
  };

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

  const sectionLabels = editorState.sectionLabels;

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
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    const hh = document.documentElement.clientHeight / 2;
    window.scrollTo({
      top: window.scrollY + rect.top - hh,
      behavior: "smooth",
    });
  };

  const prettifyFrontmatter = async () => {
    if (!textareaEl || !isFrontmatter()) return;
    const id = editorState.activeSectionId();
    if (!id) return;
    try {
      const info = await extractFrontmatter(textareaEl.innerText);
      if (!info) {
        setFmError("Invalid frontmatter");
        return;
      }
      const pretty = await serializeFrontmatter(info.type, info.data);
      textareaEl.textContent = pretty;
      setFmError("");
      notifyEdit(id);
    } catch (e) {
      setFmError(String(e));
    }
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
    if (!id || id === ALL_ID) return;
    const content = await loadSectionContent(id);
    if (editorState.activeSectionId() !== id) return; // race condition guard
    if (textareaEl) {
      textareaEl.textContent = content;
      setSectionCount(countText(content));
      // Explicit jump target takes priority; fall back to saved cursor for back-navigation
      const popped = popSectionSelection(id);
      const stored =
        target.selStart !== undefined
          ? { start: target.selStart, end: target.selEnd ?? target.selStart }
          : (popped ?? { start: 0, end: 0 });
      const len = content.length;
      setTimeout(() => {
        if (!textareaEl) return;
        textareaEl.focus({ preventScroll: true });
        setCaretOffset(
          textareaEl,
          Math.min(stored.start, len),
          Math.min(stored.end, len),
        );
        scrollToEditor();
      }, 50);
    }
  });

  const handleSectionChange = async (e: Event) => {
    const id = (e.currentTarget as HTMLSelectElement).value;
    if (id === "__outline__") {
      navigate(`/reorder/${params.fileId}`);
      return;
    }
    if (id === ALL_ID) {
      await goToSection(ALL_ID);
    } else {
      await goToSection(id);
    }
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    const el = e.currentTarget as HTMLElement;
    const sel = window.getSelection();
    const collapsed = sel?.isCollapsed ?? true;
    if (e.key === "ArrowUp" && collapsed) {
      const range = sel?.getRangeAt(0);
      const pre = range?.cloneRange();
      pre?.selectNodeContents(el);
      pre?.setEnd(range!.startContainer, range!.startOffset);
      if ((pre?.toString().length ?? 1) === 0) {
        e.preventDefault();
        const prev = prevSection();
        if (prev) {
          goToSection(prev.id, { selStart: Infinity, selEnd: Infinity });
        }
      }
    }
    if (e.key === "ArrowDown" && collapsed) {
      const range = sel?.getRangeAt(0);
      const post = range?.cloneRange();
      post?.selectNodeContents(el);
      post?.setStart(range!.endContainer, range!.endOffset);
      if ((post?.toString().length ?? 1) === 0) {
        e.preventDefault();
        const next = nextSection();
        if (next) {
          goToSection(next.id, { selStart: 0, selEnd: 0 });
        }
      }
    }
    if (e.ctrlKey || e.metaKey) {
      switch (e.key) {
        case "f": {
          e.preventDefault();
          openFind();
          return;
        }
        case "s": {
          e.preventDefault();
          handleSave();
          return;
        }
      }
    }
  };

  const contextRange = createMemo(() => {
    const ctx = contextSections();
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
        await goToSection(newId);
        requestAnimationFrame(() => {
          if (!textareaEl) return;
          const val = textareaEl.textContent ?? "";
          const titleStart = val.indexOf("Title here");
          if (titleStart !== -1) {
            textareaEl.focus();
            setCaretOffset(textareaEl, titleStart, titleStart + 10);
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
        await goToSection(newId);
        requestAnimationFrame(() => {
          if (!textareaEl) return;
          const val = textareaEl.textContent ?? "";
          const titleStart = val.indexOf("Title here");
          if (titleStart !== -1) {
            textareaEl.focus();
            setCaretOffset(textareaEl, titleStart, titleStart + 10);
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

  const canBackup = () => {
    const name = defaultRemoteProvider();
    if (!name) return false;
    const provider = getProvider(name as SyncProviderName);
    if (!provider) return false;
    return !!provider.loadToken()?.refreshToken;
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

  const handleScroll = () => {
    if (!textareaEl || mode() !== "single") return;
    const r = textareaEl.getBoundingClientRect();
    const centerY = window.scrollY + window.innerHeight / 2;
    const pct = Math.round(
      Math.min(
        100,
        Math.max(0, ((centerY - (window.scrollY + r.top)) / r.height) * 100),
      ),
    );
    setScrollPct(pct);
    setShowScrollPct(true);
    clearTimeout(scrollHideTimer);
    scrollHideTimer = setTimeout(() => setShowScrollPct(false), 1000);
  };

  onMount(() =>
    window.addEventListener("scroll", handleScroll, { passive: true }),
  );
  onCleanup(() => {
    window.removeEventListener("scroll", handleScroll);
    clearTimeout(scrollHideTimer);
  });

  const countLabel = () => {
    const { chars, words } = editorState.sectionCount();
    const n = showWords() ? words : chars;
    const unit = showWords() ? "w" : "c";
    return `${n.toLocaleString()} ${unit}`;
  };

  const handleWholeSave = async () => {
    if (!wholeEl) return;
    try {
      await saveWholeContent(wholeEl.innerText);
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
    const p = (async () => {
      if (mode() === "all") {
        await handleWholeSave();
      } else {
        const id = editorState.activeSectionId();
        if (id) {
          const err = await flushSave(id);
          if (err) throw new Error(err);
        }
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
    if (!textareaEl || !id) return;
    file.text().then((text) => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) {
        toast.error("No cursor position — click in the editor first");
        return;
      }
      sel.deleteFromDocument();
      const node = document.createTextNode(text);
      const range = sel.getRangeAt(0);
      range.insertNode(node);
      range.setStartAfter(node);
      range.collapse(true);
      sel.removeAllRanges();
      sel.addRange(range);
      notifyEdit(id);
    });
  };

  return (
    <main>
      <Show when={mode() === "single"}>
        <div class={`scroll-pct-indicator${showScrollPct() ? " visible" : ""}`}>
          {scrollPct()}%
        </div>
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
            <button
              onClick={() => {
                textareaEl?.focus();
                document.execCommand("undo");
              }}
            >
              <TbOutlineRotate /> Undo
            </button>
            <button
              onClick={() => {
                textareaEl?.focus();
                document.execCommand("redo");
              }}
            >
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
        <div
          class="edit"
          contenteditable={isReadonly() ? "false" : "plaintext-only"}
          spellcheck={spellcheck()}
          autocorrect={autocorrect() ? "on" : "off"}
          autocapitalize={autocapitalize()}
          ref={(el) => {
            wholeEl = el;
            loadAllContent().then((content) => {
              el.textContent = content;
              el.focus();
            });
          }}
          onInput={() => !isReadonly() && notifyEdit("__all__")}
          onBlur={isReadonly() ? undefined : handleWholeSave}
        />
      </Show>

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
                  goToSection(prev().id, {
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
          <div
            class="edit"
            contenteditable={isReadonly() ? "false" : "plaintext-only"}
            spellcheck={spellcheck()}
            autocorrect={autocorrect() ? "on" : "off"}
            autocapitalize={autocapitalize()}
            ref={(el) => {
              textareaEl = el;
              registerActiveTextarea(el);
            }}
            onInput={() => {
              if (isReadonly()) return;
              const id = editorState.activeSectionId();
              if (id) notifyEdit(id);
              scheduleTypewriterScroll();
            }}
            onBlur={
              isReadonly()
                ? undefined
                : async () => {
                    const id = editorState.activeSectionId();
                    if (!id) return;
                    try {
                      const err = await flushSave(id);
                      setFmError(err);
                    } catch (err) {
                      console.error("Failed to save:", err);
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
              <button
                onClick={() => {
                  goToSection(next().id, { selStart: 0, selEnd: 0 });
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

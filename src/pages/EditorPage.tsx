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
  TbOutlineCloudUpload,
  TbOutlineCopy,
  TbOutlineArrowUp,
  TbOutlineArrowDown,
} from "solid-icons/tb";
import toast from "solid-toast";

import {
  editorState,
  loadFile,
  switchSection,
  setActiveSectionId,
  loadSectionContent,
  loadAllContent,
  addSection,
  addSectionBefore,
  disposeEditor,
  popSectionSelection,
  popPendingJump,
  setSectionSelection,
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
  settingsSignals,
  defaultRemoteProvider,
  showWords,
  setShowWords,
} from "../states/settings";
import { buildSectionLabel } from "../lib/md/section";
import {
  extractFrontmatter,
  serializeFrontmatter,
} from "../lib/md/frontmatter";
import { loadRawMarkdown, downloadBlob } from "../lib/export";
import { sanitizeFilename, packBackupName } from "../lib/path";
import { getProvider } from "../lib/sync/provider";
import type { SyncProviderName } from "../lib/sync/interface";
import ToggleMenu from "../components/ToggleMenu";
import MarkdownView from "../components/MarkdownView";
import FileDrop from "../components/FileDrop";
import Toolbar from "../components/Toolbar";
import FindReplaceModal from "../components/FindReplaceModal";
import { resetFindState, loadFindContents } from "../states/find";
import type { SectionMeta } from "../lib/db/schema";

const ALL_ID = "__all__";

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

  let textareaEl: HTMLTextAreaElement | null = null;
  let wholeEl: HTMLTextAreaElement | null = null;
  let mirrorEl: HTMLDivElement | undefined;

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
    if (!textareaEl || !mirrorEl) return;
    const r = textareaEl.getBoundingClientRect();
    const hh = document.documentElement.clientHeight / 2;

    mirrorEl.style.width = `${textareaEl.clientWidth}px`;
    const position = textareaEl.selectionStart;
    mirrorEl.textContent = textareaEl.value.slice(0, position);

    const span = document.createElement("span");
    span.textContent = ".";
    mirrorEl.appendChild(span);

    const spanTop = span.offsetTop;

    // Clear mirror content
    mirrorEl.textContent = "";

    const absoluteCursorY = window.scrollY + r.top + spanTop;
    window.scrollTo({
      top: absoluteCursorY - hh,
      behavior: "smooth",
    });
  };

  const prettifyFrontmatter = async () => {
    if (!textareaEl || !isFrontmatter()) return;
    const id = editorState.activeSectionId();
    if (!id) return;
    try {
      const info = await extractFrontmatter(textareaEl.value);
      if (!info) {
        setFmError("Invalid frontmatter");
        return;
      }
      const pretty = await serializeFrontmatter(info.type, info.data);
      textareaEl.value = pretty;
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

  onMount(() => {
    if (!settingsSignals.wakeLock() || !("wakeLock" in navigator)) return;
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
    const id = editorState.activeSectionId();
    editorState.activeContentVersion(); // reactive dep: re-run when content is externally updated
    if (!id || id === ALL_ID) return;
    const content = await loadSectionContent(id);
    if (editorState.activeSectionId() !== id) return; // race condition guard
    if (textareaEl) {
      textareaEl.value = content;
      setSectionCount(countText(content));
      const sel = popSectionSelection(id) || { start: 0, end: 0 };
      const len = content.length;
      textareaEl.setSelectionRange(
        Math.min(sel.start, len),
        Math.min(sel.end, len),
      );
      setTimeout(() => {
        if (!textareaEl) return;
        textareaEl.focus();
        scrollToEditor();
      }, 16);
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
      if (next) {
        setSectionSelection(next.id, { start: 0, end: 0 });
        switchSection(next.id);
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === "f") {
      e.preventDefault();
      openFind();
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
    const el = textareaEl;
    file.text().then((text) => {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      el.value = el.value.slice(0, start) + text + el.value.slice(end);
      el.selectionStart = el.selectionEnd = start + text.length;
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
      <div
        ref={mirrorEl}
        class="edit-mirror"
        style="position: absolute; visibility: hidden; top: 0; left: -9999px; height: 0; overflow: hidden;"
      />
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
              onClick={() =>
                textareaEl?.dispatchEvent(
                  new KeyboardEvent("keydown", {
                    key: "z",
                    ctrlKey: true,
                    metaKey: true,
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
                    metaKey: true,
                    shiftKey: true,
                    bubbles: true,
                  }),
                )
              }
            >
              <TbOutlineRotateClockwise /> Redo
            </button>
            <hr />
            <button onClick={openFind}>
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
        <textarea
          class="edit"
          placeholder="Write here!"
          spellcheck={settingsSignals.spellcheck()}
          autocorrect={settingsSignals.autocorrect() ? "on" : "off"}
          autocapitalize={settingsSignals.autocapitalize()}
          readOnly={isReadonly()}
          ref={(el) => {
            wholeEl = el;
            loadAllContent().then((content) => {
              el.value = content;
              el.focus();
            });
          }}
          onInput={() => !isReadonly() && notifyEdit("__all__")}
          onBlur={isReadonly() ? undefined : handleWholeSave}
        />
      </Show>

      <Show when={mode() === "single"}>
        <For each={contextRange().before}>
          {(m) => (
            <ContextSection meta={() => m} raw={settingsSignals.contextRaw()} />
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
          <textarea
            class="edit"
            placeholder="Write here!"
            spellcheck={settingsSignals.spellcheck()}
            autocorrect={settingsSignals.autocorrect() ? "on" : "off"}
            autocapitalize={settingsSignals.autocapitalize()}
            readOnly={isReadonly()}
            ref={(el) => {
              textareaEl = el;
              registerActiveTextarea(el);
            }}
            onInput={() => {
              if (isReadonly()) return;
              const id = editorState.activeSectionId();
              if (id) notifyEdit(id);
              setFmError("");
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
                  setSectionSelection(next().id, {
                    start: 0,
                    end: 0,
                  });
                  switchSection(next().id);
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

        <For each={contextRange().after}>
          {(m) => (
            <ContextSection meta={() => m} raw={settingsSignals.contextRaw()} />
          )}
        </For>
      </Show>
    </main>
  );
};

export default EditorPage;

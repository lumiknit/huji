import {
  type Component,
  createResource,
  createSignal,
  createEffect,
  For,
  Show,
  onMount,
  onCleanup,
  createMemo,
} from "solid-js";
import { useParams, A } from "@solidjs/router";
import {
  TbOutlineArrowLeft,
  TbOutlineDownload,
  TbOutlineCopy,
  TbOutlineAdjustments,
  TbOutlineList,
  TbOutlineExternalLink,
  TbOutlineShare,
  TbOutlineChevronDown,
} from "solid-icons/tb";
import ToggleMenu from "../components/ToggleMenu";
import toast from "solid-toast";

import { getFileMetas } from "../lib/db/meta";
import { getContent } from "../lib/db/content";
import { extractFrontmatter } from "../lib/md/frontmatter";
import { htmlToText } from "../lib/md/render";
import {
  buildMarkdown,
  buildHtml as libBuildHtml,
  buildPlainText,
  buildDocx,
  downloadBlob,
  normalizeNewlines,
  buildHiddenIds,
  type FmMode,
} from "../lib/export";
import type { SectionMeta } from "../lib/db/schema";
import type { FrontmatterType } from "../lib/md/frontmatter";
import MarkdownView from "../components/MarkdownView";
import Toolbar from "../components/Toolbar";

type RenderRule = { excludeAll?: string; excludeTitle?: string };
type SectionEntry = { meta: SectionMeta; content: string };
type PreviewData = {
  entries: SectionEntry[];
  filename: string;
  fmRaw: string | null;
  fmType: FrontmatterType | null;
  fmData: Record<string, unknown>;
  renderRules: Record<string, RenderRule>;
};

const loadPreviewData = async (fileId: string): Promise<PreviewData> => {
  const metas = await getFileMetas(fileId);
  const entries: SectionEntry[] = [];
  let fmRaw: string | null = null;
  let fmType: FrontmatterType | null = null;
  let fmData: Record<string, unknown> = {};
  let filename = fileId;

  for (const m of metas) {
    const row = await getContent(m.id);
    const content = row?.content ?? "";

    if (m.level === -1) {
      try {
        const info = await extractFrontmatter(content);
        if (info) {
          fmRaw = content;
          fmType = info.type;
          fmData = info.data;
          if (typeof fmData._filename === "string") filename = fmData._filename;
        }
      } catch {
        /* ignore */
      }
      continue;
    }

    entries.push({ meta: m, content });
  }

  const renderRules: Record<string, RenderRule> = {};
  if (fmData._render && typeof fmData._render === "object") {
    for (const [k, v] of Object.entries(
      fmData._render as Record<string, unknown>,
    )) {
      if (v && typeof v === "object") {
        const r = v as Record<string, unknown>;
        renderRules[k] = {
          excludeAll:
            typeof r.exclude_all === "string" ? r.exclude_all : undefined,
          excludeTitle:
            typeof r.exclude_title === "string" ? r.exclude_title : undefined,
        };
      }
    }
  }

  return { entries, filename, fmRaw, fmType, fmData, renderRules };
};

// ── Lazy section preview ──

type SectionPreviewProps = { entry: SectionEntry };

const SectionPreview: Component<SectionPreviewProps> = (props) => {
  let el!: HTMLDivElement;
  const [vis, setVis] = createSignal(false);
  const [height, setHeight] = createSignal<number | null>(null);

  onMount(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVis(true);
        } else {
          if (vis()) setHeight(el.offsetHeight);
          setVis(false);
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(el);
    onCleanup(() => observer.disconnect());
  });

  return (
    <div
      ref={el}
      style={
        !vis() && height() !== null ? { height: `${height()}px` } : undefined
      }
    >
      <Show when={vis()}>
        <MarkdownView
          sectionId={props.entry.meta.id}
          content={props.entry.content}
        />
      </Show>
    </div>
  );
};

// ── Helpers ──

const stripMdExt = (name: string) => name.replace(/\.(md|markdown)$/i, "");

const applyRenderRule = (
  entries: SectionEntry[],
  rule: RenderRule | null,
): SectionEntry[] => {
  const hiddenIds = buildHiddenIds(
    entries.map((e) => e.meta),
    rule?.excludeAll,
  );
  let excludeTitleRe: RegExp | null = null;
  if (rule?.excludeTitle) {
    try {
      excludeTitleRe = new RegExp(rule.excludeTitle);
    } catch {
      /* ignore invalid regex */
    }
  }
  return entries
    .filter((e) => !hiddenIds.has(e.meta.id))
    .map((e) => {
      if (excludeTitleRe?.test(e.meta.heading)) {
        const lines = e.content.split("\n");
        return { ...e, content: lines.slice(1).join("\n").trimStart() };
      }
      return e;
    });
};

// ── Word count helpers ──

type CountMode = "default" | "ignore-spaces";

const countChars = (text: string, mode: CountMode): number => {
  if (mode === "ignore-spaces") return text.replace(/\s/g, "").length;
  return text.length;
};

const countWords = (text: string): number => {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
};

const plainText = (raw: string): string => {
  // Strip markdown syntax for a rough plain-text representation
  return raw
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_~`]/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "");
};

// ── Outline / word-count component ──

type OutlineProps = {
  entries: SectionEntry[];
  activeRule: RenderRule | null;
};

const OutlineView: Component<OutlineProps> = (props) => {
  const [countMode, setCountMode] = createSignal<CountMode>("default");
  const [checkedIds, setCheckedIds] = createSignal<Set<string>>(new Set());
  let headerCheckRef: HTMLInputElement | undefined;

  const hiddenIds = createMemo(() =>
    buildHiddenIds(
      props.entries.map((e) => e.meta),
      props.activeRule?.excludeAll,
    ),
  );

  const isExcludedEntry = (e: SectionEntry): boolean =>
    hiddenIds().has(e.meta.id);

  createEffect(() => {
    const newSet = new Set<string>();
    for (const e of props.entries) {
      if (!isExcludedEntry(e)) newSet.add(e.meta.id);
    }
    setCheckedIds(newSet);
  });

  const rowTexts = createMemo(() =>
    props.entries.map((e) => {
      const excluded = isExcludedEntry(e);
      const text = excluded ? "" : plainText(e.content);
      const words = excluded ? 0 : countWords(text);
      return { entry: e, excluded, text, words };
    }),
  );

  const rows = createMemo(() => {
    const mode = countMode();
    return rowTexts().map((r) => ({
      entry: r.entry,
      excluded: r.excluded,
      words: r.words,
      chars: r.excluded ? 0 : countChars(r.text, mode),
    }));
  });

  const nonExcludedRows = createMemo(() => rows().filter((r) => !r.excluded));
  const allChecked = createMemo(() => {
    const ne = nonExcludedRows();
    return ne.length > 0 && ne.every((r) => checkedIds().has(r.entry.meta.id));
  });
  const someChecked = createMemo(() =>
    nonExcludedRows().some((r) => checkedIds().has(r.entry.meta.id)),
  );

  createEffect(() => {
    if (headerCheckRef)
      headerCheckRef.indeterminate = someChecked() && !allChecked();
  });

  const toggleAll = () => {
    if (allChecked()) {
      setCheckedIds(new Set<string>());
    } else {
      setCheckedIds(new Set(nonExcludedRows().map((r) => r.entry.meta.id)));
    }
  };

  const toggleRow = (id: string) => {
    setCheckedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const checkedRows = createMemo(() =>
    rows().filter((r) => !r.excluded && checkedIds().has(r.entry.meta.id)),
  );
  const totals = createMemo(() =>
    checkedRows().reduce(
      (acc, r) => ({ chars: acc.chars + r.chars, words: acc.words + r.words }),
      { chars: 0, words: 0 },
    ),
  );
  const checkedCount = createMemo(() => checkedRows().length);

  return (
    <div class="outline-view">
      <div class="outline-controls">
        <label>
          Count mode
          <select
            value={countMode()}
            onChange={(e) => setCountMode(e.currentTarget.value as CountMode)}
          >
            <option value="default">Default</option>
            <option value="ignore-spaces">Ignore spaces</option>
          </select>
        </label>
      </div>
      <table class="outline-table">
        <thead>
          <tr>
            <th>
              <input
                ref={headerCheckRef}
                type="checkbox"
                checked={allChecked()}
                onChange={toggleAll}
              />
            </th>
            <th>Section</th>
            <th class="outline-num">Chars</th>
            <th class="outline-num">Words</th>
          </tr>
        </thead>
        <tbody>
          <For each={rows()}>
            {(r) => (
              <tr class={r.excluded ? "outline-excluded" : undefined}>
                <td>
                  <Show when={!r.excluded}>
                    <input
                      type="checkbox"
                      checked={checkedIds().has(r.entry.meta.id)}
                      onChange={() => toggleRow(r.entry.meta.id)}
                    />
                  </Show>
                </td>
                <td class="outline-heading">
                  {r.entry.meta.heading ? (
                    "#".repeat(r.entry.meta.level) + r.entry.meta.heading
                  ) : (
                    <em>(untitled)</em>
                  )}
                </td>
                <td class="outline-num">
                  {r.excluded ? (
                    <span class="outline-excluded-mark">—</span>
                  ) : (
                    r.chars.toLocaleString()
                  )}
                </td>
                <td class="outline-num">
                  {r.excluded ? (
                    <span class="outline-excluded-mark">—</span>
                  ) : (
                    r.words.toLocaleString()
                  )}
                </td>
              </tr>
            )}
          </For>
        </tbody>
        <tfoot>
          <tr class="outline-total">
            <td />
            <td>
              <strong>Total</strong>
            </td>
            <td class="outline-num">
              <strong>{totals().chars.toLocaleString()}</strong>
            </td>
            <td class="outline-num">
              <strong>{totals().words.toLocaleString()}</strong>
            </td>
          </tr>
          <tr>
            <td />
            <td>Avg</td>
            <td class="outline-num">
              {checkedCount() > 0
                ? (totals().chars / checkedCount()).toFixed(1)
                : "—"}
            </td>
            <td class="outline-num">
              {checkedCount() > 0
                ? (totals().words / checkedCount()).toFixed(1)
                : "—"}
            </td>
          </tr>
          <tr>
            <td />
            <td>Manuscript pages</td>
            <td class="outline-num">{(totals().chars / 200).toFixed(1)}</td>
            <td class="outline-num">—</td>
          </tr>
          <tr>
            <td />
            <td>A5 Pages</td>
            <td class="outline-num">{(totals().chars / 600).toFixed(1)}</td>
            <td class="outline-num">{(totals().words / 250).toFixed(1)}</td>
          </tr>
          <tr>
            <td />
            <td>Reading time</td>
            <td class="outline-num">{(totals().chars / 600).toFixed(1)} min</td>
            <td class="outline-num">{(totals().words / 200).toFixed(1)} min</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

// ── Main component ──

const PreviewPage: Component = () => {
  const params = useParams<{ fileId: string }>();
  const [data] = createResource(() => params.fileId, loadPreviewData);
  const [fmMode, setFmMode] = createSignal<FmMode>("remove-huji");
  const [renderRuleName, setRenderRuleName] = createSignal("");
  const [showOptions, setShowOptions] = createSignal(true);
  const [tab, setTab] = createSignal<"preview" | "outline">("preview");
  const [format, setFormat] = createSignal<"md" | "txt" | "html" | "docx">(
    "md",
  );

  const activeRule = createMemo((): RenderRule | null => {
    const name = renderRuleName();
    if (!name) return null;
    return data()?.renderRules[name] ?? null;
  });

  const visibleEntries = createMemo(() =>
    applyRenderRule(data()?.entries ?? [], activeRule()),
  );

  const baseFilename = () => stripMdExt(data()?.filename ?? params.fileId);

  const entries = () => visibleEntries().map((e) => ({ content: e.content }));

  const buildMd = async () => {
    const d = data();
    if (!d) return "";
    return buildMarkdown(d.fmRaw, d.fmType, d.fmData, entries(), fmMode());
  };

  const buildHtml = () => libBuildHtml(entries());

  const buildTxt = () => buildPlainText(entries());

  const dl = (content: string, mime: string, ext: string) =>
    downloadBlob(content, mime, `${baseFilename()}.${ext}`);

  const buildFullHtml = () => {
    const body = buildHtml();
    return `<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<meta name="viewport" content="width=device-width, initial-scale=1.0">\n<title>${baseFilename()}</title>\n</head>\n<body>\n${body}\n</body>\n</html>`;
  };

  const handleDownload = async () => {
    const fmt = format();
    if (fmt === "md") dl(await buildMd(), "text/markdown", "md");
    else if (fmt === "txt") dl(buildTxt(), "text/plain", "txt");
    else if (fmt === "html") dl(buildFullHtml(), "text/html", "html");
    else {
      const blob = await buildDocx(entries());
      downloadBlob(
        blob,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        `${baseFilename()}.docx`,
      );
    }
    toast.success("Downloaded");
  };

  const handleCopy = async () => {
    const fmt = format();
    if (fmt === "docx") {
      toast.error("Copy is not supported for .docx");
      return;
    }
    if (fmt === "md") {
      await navigator.clipboard.writeText(await buildMd());
    } else if (fmt === "txt") {
      await navigator.clipboard.writeText(buildTxt());
    } else {
      const html = buildHtml();
      try {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([normalizeNewlines(htmlToText(html))], {
              type: "text/plain",
            }),
          }),
        ]);
      } catch {
        await navigator.clipboard.writeText(html);
      }
    }
    toast.success("Copied");
  };

  const handleOpenInTab = () => {
    const blob = new Blob([buildFullHtml()], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  const handleShare = async () => {
    const fmt = format();
    if (fmt === "docx") {
      toast.error("Share is not supported for .docx");
      return;
    }
    let text: string;
    if (fmt === "md") text = await buildMd();
    else if (fmt === "txt") text = buildTxt();
    else text = buildHtml();
    await navigator.share({ title: baseFilename(), text });
  };

  return (
    <main>
      <Toolbar title={`Preview — ${data()?.filename ?? ""}`}>
        <A href={`/edit/${params.fileId}`} title="Back to editor">
          <TbOutlineArrowLeft />
        </A>
        <span class="spacer" />
        <button
          title="Outline / word count"
          class={tab() === "outline" ? "primary" : undefined}
          onClick={() =>
            setTab((t) => (t === "outline" ? "preview" : "outline"))
          }
        >
          <TbOutlineList />
        </button>
        <button
          title="Options"
          class={showOptions() ? "primary" : undefined}
          onClick={() => setShowOptions((v) => !v)}
        >
          <TbOutlineAdjustments />
        </button>
        <div class="toolbar-group">
          <select
            value={format()}
            onChange={(e) =>
              setFormat(e.currentTarget.value as "md" | "txt" | "html" | "docx")
            }
          >
            <option value="md">.md</option>
            <option value="txt">.txt</option>
            <option value="html">.html</option>
            <option value="docx">.docx</option>
          </select>
          <button title="Download" onClick={handleDownload}>
            <TbOutlineDownload />
          </button>
          <ToggleMenu label={<TbOutlineChevronDown />}>
            <button onClick={handleCopy}>
              <TbOutlineCopy /> Copy
            </button>
            <hr />
            <button onClick={handleOpenInTab}>
              <TbOutlineExternalLink /> Open in new tab
            </button>
            <Show when={typeof navigator.share === "function"}>
              <button onClick={handleShare}>
                <TbOutlineShare /> Share
              </button>
            </Show>
          </ToggleMenu>
        </div>
        <Show when={showOptions()}>
          <div class="preview-options">
            <label>
              Frontmatter
              <select
                value={fmMode()}
                onChange={(e) => setFmMode(e.currentTarget.value as FmMode)}
              >
                <option value="remove-huji">Remove huji meta</option>
                <option value="exclude">Exclude</option>
              </select>
            </label>
            <label>
              Render rule
              <select
                value={renderRuleName()}
                onChange={(e) => setRenderRuleName(e.currentTarget.value)}
              >
                <option value="">Default (none)</option>
                <For each={Object.keys(data()?.renderRules ?? {})}>
                  {(name) => <option value={name}>{name}</option>}
                </For>
              </select>
            </label>
          </div>
        </Show>
      </Toolbar>

      <Show
        when={!data.loading}
        fallback={
          <p>
            <small>Loading…</small>
          </p>
        }
      >
        <Show when={tab() === "outline"}>
          <OutlineView
            entries={data()?.entries ?? []}
            activeRule={activeRule()}
          />
        </Show>
        <Show when={tab() === "preview"}>
          <For each={visibleEntries()}>
            {(entry) => <SectionPreview entry={entry} />}
          </For>
        </Show>
      </Show>
    </main>
  );
};

export default PreviewPage;

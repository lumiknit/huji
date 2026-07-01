import {
  type Component,
  createResource,
  createSignal,
  For,
  Show,
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

import { htmlToText } from "../lib/md/render";
import {
  buildMarkdown,
  buildHtml as libBuildHtml,
  buildPlainText,
  buildDocx,
  downloadBlob,
  normalizeNewlines,
  type FmMode,
} from "../lib/export";
import {
  loadPreviewData,
  stripMdExt,
  applyRenderRule,
  type RenderRule,
} from "../lib/preview";
import Toolbar from "../components/Toolbar";
import SectionPreview from "../components/preview/SectionPreview";
import OutlineView from "../components/preview/OutlineView";

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

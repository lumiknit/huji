import {
  type Component,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
  Show,
  For,
} from "solid-js";
import { useParams, useNavigate, useSearchParams } from "@solidjs/router";
import {
  TbOutlineArrowLeft,
  TbOutlineCheck,
  TbOutlineRefresh,
} from "solid-icons/tb";
import toast from "solid-toast";
import { aconfirm } from "../components/CommonDialog";
import Toolbar from "../components/Toolbar";
import Editor from "../components/editor/Editor";
import FrontmatterEditor from "../components/editor/FrontmatterEditor";
import {
  createCommander,
  type EditorCommander,
} from "../components/editor/commander";
import type { FrontmatterType } from "../lib/md/frontmatter";
import {
  editorState,
  loadFile,
  loadAllContent,
  setPendingJump,
  WHOLE_ID,
  setMetas,
} from "../states/editor";
import { flushSave } from "../states/editor_save";

import { getFileMetas, putMeta, putMetas, deleteMetas } from "../lib/db/meta";
import { putContents, deleteContents } from "../lib/db/content";
import { buildReorderText, parseReorderText } from "../lib/md/reorder";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { genUniqueId } from "../lib/utils/id";
import type { SectionMeta } from "../lib/db/schema";

type Target = "reorder" | "all" | "frontmatter";

const TITLES: Record<Target, string> = {
  reorder: "Reorder",
  all: "Whole file",
  frontmatter: "Frontmatter",
};

type DiffInfo = {
  deleted: string[]; // heading
  added: string[]; // heading
};

const SpecialEditPage: Component = () => {
  const params = useParams<{ fileId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const target = createMemo<Target>(() => {
    const t = searchParams.target;
    return t === "all" || t === "frontmatter" ? t : "reorder";
  });
  const returnTo = () => {
    const v = searchParams.return_to;
    return Array.isArray(v) ? v[0] : v;
  };

  const goBack = () => {
    const to = returnTo();
    if (to) setPendingJump(to, 0, 0);
    navigate(`/edit/${params.fileId}`);
  };

  onMount(() => {
    loadFile(params.fileId);
  });

  // Sets content on a commander once its underlying widget is actually
  // mounted — the widget (CodeMirror/textarea) may be lazy-loaded or get
  // swapped (light editor <-> CodeMirror) after this component mounts, so a
  // single immediate setValue can silently no-op or hit a stale instance.
  const applyWhenReady = (commander: EditorCommander, content: string) => {
    let cancelled = false;
    onCleanup(() => {
      cancelled = true;
    });
    const attempt = () => {
      if (cancelled) return;
      commander.setValue(content, undefined, { resetHistory: true });
      if (commander.getValue() !== content) {
        requestAnimationFrame(attempt);
      } else {
        commander.focus();
      }
    };
    requestAnimationFrame(attempt);
  };

  // ── Whole file ──
  const wholeCommander = createCommander();

  createEffect(() => {
    if (target() !== "all") return;
    (async () => {
      const content = await loadAllContent();
      if (target() !== "all") return;
      applyWhenReady(wholeCommander, content);
    })();
  });

  const handleWholeBack = async () => {
    try {
      await flushSave(WHOLE_ID);
    } catch {
      toast.error("Failed to save");
      return;
    }
    goBack();
  };

  // ── Frontmatter ──
  const fmMeta = createMemo(() =>
    editorState.metas().find((m) => m.level === -1),
  );

  const setFrontmatterFormat = async (format: FrontmatterType) => {
    const meta = fmMeta();
    if (!meta) return;
    const updated = {
      ...meta,
      heading: format,
      updatedAt: new Date().toISOString(),
    };
    setMetas((prev) => prev.map((m) => (m.id === meta.id ? updated : m)));
    await putMeta(updated);
  };

  const handleFrontmatterBack = async () => {
    const meta = fmMeta();
    if (!meta) return goBack();
    try {
      await flushSave(meta.id);
    } catch {
      toast.error("Fix invalid frontmatter before leaving");
      return;
    }
    goBack();
  };

  // ── Reorder ──
  const reorderCommander = createCommander();
  const [text, setText] = createSignal("");
  const [error, setError] = createSignal("");
  const [reorderMetas, setReorderMetas] = createSignal<SectionMeta[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [diff, setDiff] = createSignal<DiffInfo | null>(null);
  let initialText = "";
  let fingerprintMap = new Map<string, string>();

  const buildInitial = async () => {
    const list = await getFileMetas(params.fileId);
    setReorderMetas(list);
    const sections = list.filter((m) => m.level > 0);
    const result = buildReorderText(sections);
    initialText = result.text;
    fingerprintMap = result.fingerprintMap;
    setText(result.text);
    setDiff(null);
    setLoaded(true);
    applyWhenReady(reorderCommander, result.text);
  };

  onMount(() => {
    if (target() === "reorder") buildInitial();
  });

  const handleReset = () => {
    setText(initialText);
    setError("");
    setDiff(null);
    reorderCommander.setValue(initialText);
  };

  const calcDiff = (): DiffInfo | null => {
    const result = parseReorderText(text());
    if (!result.ok) return null;

    const list = reorderMetas();
    const existingMap = new Map(list.map((m) => [m.id, m]));
    const usedIds = new Set<string>();
    const added: string[] = [];

    for (const entry of result.entries) {
      if (entry.kind === "section") {
        const realId =
          fingerprintMap.get(entry.fingerprint) ?? entry.fingerprint;
        if (existingMap.has(realId)) usedIds.add(realId);
        else added.push(entry.heading || entry.fingerprint);
      } else if (entry.kind === "new") {
        added.push(entry.heading || "(untitled)");
      }
    }

    const deleted = list
      .filter((m) => m.level > 0 && !usedIds.has(m.id))
      .map((m) => m.heading || "(no heading)");

    if (deleted.length === 0 && added.length === 0) return null;
    return { deleted, added };
  };

  const handleReorderBlur = () => {
    const result = parseReorderText(text());
    if (!result.ok) {
      setError((result as { ok: false; error: string }).error);
      setDiff(null);
      return;
    }
    setError("");
    setDiff(calcDiff());
  };

  const handleReorderApply = async () => {
    const d = calcDiff();
    if (d && (d.deleted.length > 0 || d.added.length > 0)) {
      const msg = [
        d.deleted.length > 0
          ? `Delete ${d.deleted.length} section(s): ${d.deleted.join(", ")}`
          : "",
        d.added.length > 0
          ? `Add ${d.added.length} new section(s): ${d.added.join(", ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
      if (!(await aconfirm(`${msg}\n\nProceed?`))) return;
    }

    const result = parseReorderText(text());
    if (!result.ok) {
      setError((result as { ok: false; error: string }).error);
      return;
    }
    setError("");

    const list = reorderMetas();
    const now = new Date().toISOString();
    const existingMap = new Map(list.map((m) => [m.id, m]));
    const usedIds = new Set<string>();
    const updatedMetas: SectionMeta[] = [];
    const newContents: Array<{
      id: string;
      content: string;
      updatedAt: string;
    }> = [];
    const deletedIds: string[] = [];

    const fm = list.find((m) => m.level === -1);
    if (fm) updatedMetas.push(fm);

    // The heading-less intro section (if any) always stays first among body
    // sections — give it a fracIndex smaller than any reordered heading so
    // it can't tie/lose its position.
    const introMeta = list.find((m) => m.level === 0);
    let fracIdx = FRAC_GAP;
    if (introMeta) {
      updatedMetas.push({ ...introMeta, fracIndex: fracIdx, updatedAt: now });
      fracIdx += FRAC_GAP;
    }

    for (const entry of result.entries) {
      if (entry.kind === "section") {
        const realId =
          fingerprintMap.get(entry.fingerprint) ?? entry.fingerprint;
        const existing = existingMap.get(realId);
        if (!existing) {
          toast.error(`Unknown fingerprint: ${entry.fingerprint}`);
          return;
        }
        usedIds.add(realId);
        updatedMetas.push({
          ...existing,
          level: entry.level,
          heading: entry.heading,
          fracIndex: fracIdx,
          updatedAt: now,
        });
        fracIdx += FRAC_GAP;
      } else if (entry.kind === "new") {
        const allIds = new Set([...existingMap.keys(), ...usedIds]);
        const newId = genUniqueId(allIds);
        usedIds.add(newId);
        updatedMetas.push({
          id: newId,
          fileId: params.fileId,
          fracIndex: fracIdx,
          level: entry.level,
          heading: entry.heading,
          updatedAt: now,
        });
        newContents.push({ id: newId, content: "", updatedAt: now });
        fracIdx += FRAC_GAP;
      }
    }

    for (const m of list) {
      if (m.level <= 0) continue;
      if (!usedIds.has(m.id)) deletedIds.push(m.id);
    }

    await putMetas(updatedMetas);
    if (newContents.length) await putContents(newContents);
    if (deletedIds.length) {
      await deleteMetas(deletedIds);
      await deleteContents(deletedIds);
    }

    toast.success("Reordered");
    goBack();
  };

  const handleApply = () => {
    if (target() === "reorder") return handleReorderApply();
    if (target() === "all") return handleWholeBack();
    return handleFrontmatterBack();
  };

  return (
    <main>
      <Toolbar title={`${TITLES[target()]} — ${editorState.filename()}`}>
        <button
          onClick={() =>
            target() === "reorder"
              ? goBack()
              : target() === "all"
                ? handleWholeBack()
                : handleFrontmatterBack()
          }
          title="Back"
        >
          <TbOutlineArrowLeft />
        </button>
        <span class="spacer" />
        <button class="primary" onClick={handleApply}>
          <TbOutlineCheck /> Apply
        </button>
      </Toolbar>

      <Show when={target() === "reorder"}>
        <p>
          <small>
            Rearrange headings to reorder sections. Keep fingerprint (e.g.{" "}
            <code>4c5:</code>) intact. Delete a line to remove that section. Add
            a heading without a fingerprint to create a new section.
          </small>
        </p>

        <Show when={loaded()}>
          <div class="align-end mb-xs">
            <button class="danger" onClick={handleReset}>
              <TbOutlineRefresh /> Reset changes
            </button>
          </div>
          <Editor
            language="plaintext"
            commander={reorderCommander}
            onChange={() => setText(reorderCommander.getValue())}
            onBlur={handleReorderBlur}
          />
        </Show>

        <Show when={error()}>
          <pre class="error-pre">{error()}</pre>
        </Show>

        <Show when={diff()}>
          {(d) => (
            <div class="mt-sm text-sm">
              <Show when={d().deleted.length > 0}>
                <p class="text-danger">
                  <strong>Delete {d().deleted.length} section(s):</strong>
                </p>
                <ul class="disc-list">
                  <For each={d().deleted}>{(h) => <li>{h}</li>}</For>
                </ul>
              </Show>
              <Show when={d().added.length > 0}>
                <p class="text-success">
                  <strong>Add {d().added.length} new section(s):</strong>
                </p>
                <ul class="disc-list">
                  <For each={d().added}>{(h) => <li>{h}</li>}</For>
                </ul>
              </Show>
            </div>
          )}
        </Show>
      </Show>

      <Show when={target() === "all"}>
        <Editor
          language="markdown"
          commander={wholeCommander}
          onSave={() => handleWholeBack()}
        />
      </Show>

      <Show when={target() === "frontmatter" ? fmMeta() : undefined}>
        {(meta) => (
          <FrontmatterEditor
            id={meta().id}
            format={meta().heading as FrontmatterType}
            onFormatChange={setFrontmatterFormat}
            onSave={() => handleFrontmatterBack()}
          />
        )}
      </Show>
    </main>
  );
};

export default SpecialEditPage;

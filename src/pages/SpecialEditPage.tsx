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
import {
  applyWhenReady,
  createCommander,
  writeWhenReady,
} from "../components/editor/commander";
import {
  type FrontmatterType,
  createDefaultFrontmatterData,
  decodeFrontmatterForEdit,
  encodeFrontmatterFromEdit,
  extractIdLoose,
} from "../lib/md/frontmatter";
import {
  editorState,
  loadFile,
  loadAllContent,
  loadSectionContent,
  setPendingJump,
  WHOLE_ID,
  setMetas,
} from "../states/editor";
import { flushSave } from "../states/editor_save";

import { getFileMetas, putMeta, putMetas, deleteMetas } from "../lib/db/meta";
import { putContent, putContents, deleteContents } from "../lib/db/content";
import { buildReorderText, parseReorderText } from "../lib/md/reorder";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { genId, genUniqueId } from "../lib/utils/id";
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

  const [fileReady, setFileReady] = createSignal(false);
  onMount(async () => {
    await loadFile(params.fileId);
    setFileReady(true);
  });

  // ── Shared editor ──
  // Only one target is ever shown at a time, so a single commander/widget is
  // reused across reorder/all/frontmatter instead of mounting three.
  const commander = createCommander();
  const [error, setError] = createSignal("");
  // True once the user edits the editor. Cleared back to false right when a
  // fresh/reset/converted value actually lands (see `onApplied` below) —
  // CMEditor's setValue also fires onChange, so we can't just leave it be.
  const [dirty, setDirty] = createSignal(false);

  onMount(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirty()) e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    onCleanup(() => window.removeEventListener("beforeunload", handler));
  });

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

  const handleFrontmatterFormatChange = async (e: Event) => {
    const select = e.currentTarget as HTMLSelectElement;
    const newFormat = select.value as FrontmatterType;
    const meta = fmMeta();
    if (!meta || newFormat === meta.heading) return;
    try {
      const data = await encodeFrontmatterFromEdit(
        commander.getValue(),
        meta.heading as FrontmatterType,
      );
      const decoded = await decodeFrontmatterForEdit(
        JSON.stringify(data),
        newFormat,
      );
      setError("");
      writeWhenReady(commander, decoded, {
        guard: () => target() === "frontmatter",
        onApplied: () => setDirty(false),
      });
      await setFrontmatterFormat(newFormat);
    } catch {
      setError("Fix errors before switching format");
      select.value = meta.heading;
    }
  };

  const handleFrontmatterApply = async () => {
    const meta = fmMeta();
    if (!meta) return goBack();
    try {
      await flushSave(meta.id, commander.getValue);
    } catch {
      toast.error("Fix invalid frontmatter before leaving");
      return;
    }
    goBack();
  };

  // ── Whole file ──
  const handleWholeApply = async () => {
    try {
      await flushSave(WHOLE_ID, commander.getValue);
    } catch {
      toast.error("Failed to save");
      return;
    }
    goBack();
  };

  // ── Back (cancel) — never saves; just confirms when there are unsaved edits ──
  const handleBack = () => {
    if (dirty() && !confirm("Leave without saving?")) return;
    goBack();
  };

  // ── Reorder ──
  const [reorderError, setReorderError] = createSignal("");
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
    setDiff(null);
    setLoaded(true);
    return initialText;
  };

  const handleReset = () => {
    setReorderError("");
    setDiff(null);
    writeWhenReady(commander, initialText, {
      guard: () => target() === "reorder",
      onApplied: () => setDirty(false),
    });
  };

  const calcDiff = (): DiffInfo | null => {
    const result = parseReorderText(commander.getValue());
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
    const result = parseReorderText(commander.getValue());
    if (!result.ok) {
      setReorderError((result as { ok: false; error: string }).error);
      setDiff(null);
      return;
    }
    setReorderError("");
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

    const result = parseReorderText(commander.getValue());
    if (!result.ok) {
      setReorderError((result as { ok: false; error: string }).error);
      return;
    }
    setReorderError("");

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
    if (target() === "all") return handleWholeApply();
    return handleFrontmatterApply();
  };

  // ── Content loading — one commander, content/language swapped per target ──
  createEffect(() => {
    const t = target();
    if (!fileReady()) return; // metas/fmMeta aren't populated until loadFile resolves
    commander.setLanguage(t === "all" ? "markdown" : "plaintext");
    (async () => {
      if (t === "all") {
        const content = await loadAllContent();
        if (target() !== t) return;
        applyWhenReady(commander, content, {
          guard: () => target() === t,
          onApplied: () => setDirty(false),
        });
      } else if (t === "reorder") {
        const content = await buildInitial();
        if (target() !== t) return;
        applyWhenReady(commander, content, {
          guard: () => target() === t,
          onApplied: () => setDirty(false),
        });
      } else {
        let meta = fmMeta();
        if (!meta) {
          // No frontmatter section exists yet (e.g. an older/corrupted file)
          // — create a default one so there's something to edit instead of
          // silently leaving the page blank.
          const now = new Date().toISOString();
          const newMeta: SectionMeta = {
            id: genId(),
            fileId: params.fileId,
            fracIndex: 0,
            level: -1,
            heading: "json",
            updatedAt: now,
          };
          await putMeta(newMeta);
          await putContent({
            id: newMeta.id,
            content: JSON.stringify(createDefaultFrontmatterData(genId())),
            updatedAt: now,
          });
          if (target() !== t) return;
          setMetas((prev) => [newMeta, ...prev]);
          meta = newMeta;
        }
        const raw = await loadSectionContent(meta.id);
        let decoded: string;
        try {
          decoded = await decodeFrontmatterForEdit(
            raw,
            meta.heading as FrontmatterType,
          );
          setError("");
        } catch {
          // Raw content isn't valid JSON at all — show an editable default
          // instead of the broken text, keeping whatever _id we can recover.
          const fallback = createDefaultFrontmatterData(
            extractIdLoose(raw) ?? genId(),
          );
          decoded = await decodeFrontmatterForEdit(
            JSON.stringify(fallback),
            meta.heading as FrontmatterType,
          );
          setError("Invalid frontmatter — loaded default, save to fix");
        }
        if (target() !== t) return;
        applyWhenReady(commander, decoded, {
          guard: () => target() === t,
          onApplied: () => setDirty(false),
        });
      }
    })();
  });

  return (
    <main>
      <Toolbar title={`${TITLES[target()]} — ${editorState.filename()}`}>
        <button onClick={handleBack} title="Back">
          <TbOutlineArrowLeft />
        </button>
        <span class="spacer" />
        <button class="primary" onClick={handleApply} disabled={!dirty()}>
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
        </Show>
      </Show>

      <Show when={target() === "frontmatter" ? fmMeta() : undefined}>
        {(meta) => (
          <div class="frontmatter-editor-toolbar">
            <select
              value={meta().heading}
              onChange={handleFrontmatterFormatChange}
            >
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
            </select>
          </div>
        )}
      </Show>

      <Editor
        language={target() === "all" ? "markdown" : "plaintext"}
        commander={commander}
        onChange={() => setDirty(true)}
        onBlur={() => {
          if (target() === "reorder") handleReorderBlur();
        }}
        onSave={() => {
          if (dirty()) handleApply();
        }}
      />

      <Show when={target() === "reorder"}>
        <Show when={reorderError()}>
          <pre class="error-pre">{reorderError()}</pre>
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

      <Show when={target() === "frontmatter" && error()}>
        <p class="error-text">{error()}</p>
      </Show>
    </main>
  );
};

export default SpecialEditPage;

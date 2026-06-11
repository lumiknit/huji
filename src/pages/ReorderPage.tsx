import { type Component, createSignal, onMount, Show, For } from "solid-js";
import { useParams, useNavigate, A } from "@solidjs/router";
import {
  TbOutlineArrowLeft,
  TbOutlineCheck,
  TbOutlineRefresh,
} from "solid-icons/tb";
import toast from "solid-toast";
import Toolbar from "../components/Toolbar";
import { editorState } from "../states/editor";

import { getFileMetas, putMeta, putMetas, deleteMetas } from "../lib/db/meta";
import {
  getContent,
  putContent,
  putContents,
  deleteContents,
} from "../lib/db/content";
import { buildReorderText, parseReorderText } from "../lib/md/reorder";
import {
  extractFrontmatter,
  serializeFrontmatter,
} from "../lib/md/frontmatter";
import { FRAC_GAP } from "../lib/utils/fracindex";
import { genUniqueId } from "../lib/utils/id";
import type { SectionMeta } from "../lib/db/schema";

type DiffInfo = {
  deleted: string[]; // heading
  added: string[]; // heading
};

const ReorderPage: Component = () => {
  const params = useParams<{ fileId: string }>();
  const navigate = useNavigate();

  const [text, setText] = createSignal("");
  const [error, setError] = createSignal("");
  const [metas, setMetas] = createSignal<SectionMeta[]>([]);
  const [loaded, setLoaded] = createSignal(false);
  const [diff, setDiff] = createSignal<DiffInfo | null>(null);
  let initialText = "";
  let fingerprintMap = new Map<string, string>();
  let textareaEl: HTMLTextAreaElement | null = null;

  const buildInitial = async () => {
    const list = await getFileMetas(params.fileId);
    setMetas(list);
    const fmMeta = list.find((m) => m.level === -1);
    const fmType = fmMeta ? (fmMeta.heading as "json" | "yaml" | "toml") : null;
    const sections = list.filter((m) => m.level > 0);
    const result = buildReorderText(fmType, sections);
    initialText = result.text;
    fingerprintMap = result.fingerprintMap;
    setText(result.text);
    setDiff(null);
    setLoaded(true);
  };

  onMount(buildInitial);

  const handleReset = () => {
    setText(initialText);
    setError("");
    setDiff(null);
    if (textareaEl) {
      textareaEl.value = initialText;
    }
  };

  const calcDiff = (): DiffInfo | null => {
    const result = parseReorderText(text());
    if (!result.ok) return null;

    const list = metas();
    const existingMap = new Map(list.map((m) => [m.id, m]));
    const usedIds = new Set<string>();
    const added: string[] = [];

    for (const entry of result.entries) {
      if (entry.kind === "fm") continue;
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

  const handleBlur = () => {
    const result = parseReorderText(text());
    if (!result.ok) {
      setError((result as { ok: false; error: string }).error);
      setDiff(null);
      return;
    }
    setError("");
    setDiff(calcDiff());
  };

  const handleApply = async () => {
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
      if (!confirm(`${msg}\n\nProceed?`)) return;
    }

    const result = parseReorderText(text());
    if (!result.ok) {
      setError((result as { ok: false; error: string }).error);
      return;
    }
    setError("");

    const list = metas();
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

    const fmMeta = list.find((m) => m.level === -1);
    if (fmMeta) {
      const newFmFormat = result.fmFormat;
      if (newFmFormat && newFmFormat !== fmMeta.heading) {
        // Format changed — parse current content and re-serialize to new format
        const row = await getContent(fmMeta.id);
        const info = await extractFrontmatter(row?.content ?? "").catch(
          () => null,
        );
        if (!info) {
          toast.error("Frontmatter parse failed — format not converted");
          return;
        }
        const newRaw = await serializeFrontmatter(newFmFormat, info.data);
        await putContent({ id: fmMeta.id, content: newRaw, updatedAt: now });
        const updatedFmMeta = {
          ...fmMeta,
          heading: newFmFormat,
          updatedAt: now,
        };
        await putMeta(updatedFmMeta);
        updatedMetas.push(updatedFmMeta);
      } else {
        updatedMetas.push(fmMeta);
      }
    }
    const introMeta = list.find((m) => m.level === 0);
    if (introMeta) updatedMetas.push(introMeta);

    let fracIdx = FRAC_GAP;

    for (const entry of result.entries) {
      if (entry.kind === "fm") continue;

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
    navigate(`/edit/${params.fileId}`);
  };

  return (
    <main>
      <Toolbar title={`Reorder — ${editorState.filename()}`}>
        <A href={`/edit/${params.fileId}`} title="Back">
          <TbOutlineArrowLeft />
        </A>
        <span class="spacer" />
        <button class="primary" onClick={handleApply}>
          <TbOutlineCheck /> Apply
        </button>
      </Toolbar>

      <p>
        <small>
          Rearrange headings to reorder sections. Keep fingerprint (e.g.{" "}
          <code>4c5:</code>) intact. Delete a line to remove that section. Add a
          heading without a fingerprint to create a new section.
        </small>
      </p>

      <Show when={loaded()}>
        <div class="align-end mb-xs">
          <button class="danger" onClick={handleReset}>
            <TbOutlineRefresh /> Reset changes
          </button>
        </div>
        <textarea
          class="edit"
          ref={(el) => {
            textareaEl = el;
            el.value = text();
          }}
          onInput={(e) => setText(e.currentTarget.value)}
          onBlur={handleBlur}
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
    </main>
  );
};

export default ReorderPage;

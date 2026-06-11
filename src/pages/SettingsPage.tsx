import { type Component, For } from "solid-js";
import { A } from "@solidjs/router";
import { TbOutlineArrowLeft, TbOutlineTrash } from "solid-icons/tb";
import Toolbar from "../components/Toolbar";

import {
  settingsSignals,
  setEditorFont,
  setEditorFontSize,
  setEditorLineHeight,
  setPreviewFont,
  setPreviewFontSize,
  setPreviewLineHeight,
  setPreviewParaIndent,
  setSpellcheck,
  setContextSections,
  setContextRaw,
  setMaxWidth,
  defaultRemoteProvider,
  setDefaultRemoteProvider,
} from "../states/settings";
import { availableProviders } from "../lib/sync/provider";
import { clearHujiSettings } from "../lib/db/settings-storage";

const handleResetAll = async () => {
  if (
    !confirm("Delete ALL data (documents + settings)? This cannot be undone.")
  )
    return;
  await clearHujiSettings();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase("huji");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
  location.reload();
};

const SettingsPage: Component = () => {
  return (
    <main>
      <Toolbar title="Settings">
        <A href="/" title="Back">
          <TbOutlineArrowLeft />
        </A>
      </Toolbar>

      <section>
        <h2>Editor</h2>

        <label>
          Font family
          <input
            type="text"
            placeholder="(Default Serif)"
            value={settingsSignals.editorFont()}
            onChange={(e) => setEditorFont(e.currentTarget.value)}
          />
        </label>

        <label>
          Font size (px)
          <input
            type="number"
            min={10}
            max={32}
            value={settingsSignals.editorFontSize()}
            onChange={(e) => setEditorFontSize(Number(e.currentTarget.value))}
          />
        </label>

        <label>
          Line height
          <input
            type="number"
            min={1}
            max={3}
            step={0.1}
            value={settingsSignals.editorLineHeight()}
            onChange={(e) => setEditorLineHeight(Number(e.currentTarget.value))}
          />
        </label>

        <label>
          Spellcheck
          <input
            type="checkbox"
            checked={settingsSignals.spellcheck()}
            onChange={(e) => setSpellcheck(e.currentTarget.checked)}
          />
        </label>
      </section>

      <section>
        <h2>Preview</h2>

        <label>
          Font family
          <input
            type="text"
            placeholder="(Default Serif)"
            value={settingsSignals.previewFont()}
            onChange={(e) => setPreviewFont(e.currentTarget.value)}
          />
        </label>

        <label>
          Font size (px)
          <input
            type="number"
            min={10}
            max={32}
            value={settingsSignals.previewFontSize()}
            onChange={(e) => setPreviewFontSize(Number(e.currentTarget.value))}
          />
        </label>

        <label>
          Line height
          <input
            type="number"
            min={1}
            max={3}
            step={0.1}
            value={settingsSignals.previewLineHeight()}
            onChange={(e) =>
              setPreviewLineHeight(Number(e.currentTarget.value))
            }
          />
        </label>

        <label>
          Paragraph indent
          <input
            type="checkbox"
            checked={settingsSignals.previewParaIndent()}
            onChange={(e) => setPreviewParaIndent(e.currentTarget.checked)}
          />
        </label>
      </section>

      <section>
        <h2>View</h2>

        <label>
          Context sections (before/after)
          <input
            type="number"
            min={0}
            max={5}
            value={settingsSignals.contextSections()}
            onChange={(e) => setContextSections(Number(e.currentTarget.value))}
          />
        </label>

        <label>
          Show context as raw text
          <input
            type="checkbox"
            checked={settingsSignals.contextRaw()}
            onChange={(e) => setContextRaw(e.currentTarget.checked)}
          />
        </label>

        <label>
          Max width (px)
          <input
            type="number"
            min={320}
            max={1920}
            step={10}
            value={settingsSignals.maxWidth()}
            onChange={(e) => setMaxWidth(Number(e.currentTarget.value))}
          />
        </label>
      </section>

      <section>
        <h2>Cloud</h2>
        <label>
          Default backup provider
          <select
            value={defaultRemoteProvider()}
            onChange={(e) => setDefaultRemoteProvider(e.currentTarget.value)}
          >
            <option value="">(None)</option>
            <For each={availableProviders()}>
              {(p) => <option value={p.name}>{p.name}</option>}
            </For>
          </select>
        </label>
      </section>

      <section>
        <h2>Data</h2>
        <label>
          Reset all data
          <button class="danger" onClick={handleResetAll}>
            <TbOutlineTrash /> Reset
          </button>
        </label>
      </section>
    </main>
  );
};

export default SettingsPage;

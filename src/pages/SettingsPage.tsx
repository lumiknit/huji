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
  setAutocorrect,
  setAutocapitalize,
  setWakeLock,
  typewriterMode,
  setTypewriterMode,
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

const FontDataList: Component<{ id: string }> = (props) => {
  return (
    <datalist id={props.id}>
      <option value="BuiltinSerif" />
      <option value="BuiltinSans" />
      <option value="RIDIBatang" />
      <option value="MaruBuri" />
      <option value="Pretendard JP Variable" />
      <option value="KimjungchulMyungjo" />
      <option value="GyeonggiCheonnyeonBatang" />
    </datalist>
  );
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
            list="editor-font-family"
            value={settingsSignals.editorFont()}
            onChange={(e) => setEditorFont(e.currentTarget.value)}
          />
          <FontDataList id="editor-font-family" />
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
          <select
            value={settingsSignals.spellcheck() ? "on" : "off"}
            onChange={(e) => setSpellcheck(e.currentTarget.value === "on")}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>

        <label>
          Autocorrect
          <select
            value={settingsSignals.autocorrect() ? "on" : "off"}
            onChange={(e) => setAutocorrect(e.currentTarget.value === "on")}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>

        <label>
          Autocapitalize
          <select
            value={settingsSignals.autocapitalize()}
            onChange={(e) =>
              setAutocapitalize(
                e.currentTarget.value as "off" | "none" | "sentences" | "words",
              )
            }
          >
            <option value="sentences">Sentences</option>
            <option value="words">Words</option>
            <option value="none">None</option>
            <option value="off">Off</option>
          </select>
        </label>

        <label>
          Typewriter mode
          <select
            value={typewriterMode() ? "on" : "off"}
            onChange={(e) => setTypewriterMode(e.currentTarget.value === "on")}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>

        <label>
          Wake lock (prevent screen sleep)
          <select
            value={settingsSignals.wakeLock() ? "on" : "off"}
            onChange={(e) => setWakeLock(e.currentTarget.value === "on")}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>
      </section>

      <section>
        <h2>Preview</h2>

        <label>
          Font family
          <input
            type="text"
            placeholder="(Default Serif)"
            list="preview-font-family"
            value={settingsSignals.previewFont()}
            onChange={(e) => setPreviewFont(e.currentTarget.value)}
          />
          <FontDataList id="preview-font-family" />
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
          <select
            value={settingsSignals.previewParaIndent() ? "on" : "off"}
            onChange={(e) =>
              setPreviewParaIndent(e.currentTarget.value === "on")
            }
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
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
          <select
            value={settingsSignals.contextRaw() ? "on" : "off"}
            onChange={(e) => setContextRaw(e.currentTarget.value === "on")}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
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

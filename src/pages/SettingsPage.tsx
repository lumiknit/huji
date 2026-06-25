import { type Component, For } from "solid-js";
import { A } from "@solidjs/router";
import { TbOutlineArrowLeft, TbOutlineTrash } from "solid-icons/tb";
import Toolbar from "../components/Toolbar";

import { SERIF_STACK, type ThemeVariant } from "../states/settings";
import {
  themeLight,
  setThemeLight,
  themeDark,
  setThemeDark,
  editorFont,
  setEditorFont,
  editorFontSize,
  setEditorFontSize,
  editorLineHeight,
  setEditorLineHeight,
  editorFontWeight,
  setEditorFontWeight,
  previewFont,
  setPreviewFont,
  previewFontSize,
  setPreviewFontSize,
  previewLineHeight,
  setPreviewLineHeight,
  previewFontWeight,
  setPreviewFontWeight,
  previewParaIndent,
  setPreviewParaIndent,
  spellcheck,
  setSpellcheck,
  autocorrect,
  setAutocorrect,
  autocapitalize,
  setAutocapitalize,
  wakeLock,
  setWakeLock,
  typewriterMode,
  setTypewriterMode,
  contextSections,
  setContextSections,
  contextRaw,
  setContextRaw,
  maxWidth,
  setMaxWidth,
  defaultRemoteProvider,
  setDefaultRemoteProvider,
} from "../states/settings";
import { availableProviders } from "../lib/sync/provider";
import {
  clearHujiSettings,
  exportHujiSettings,
  importHujiSettings,
} from "../lib/db/settings-storage";

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

const THEME_VARIANTS: { value: ThemeVariant; label: string }[] = [
  { value: "default", label: "Default" },
  { value: "warm", label: "Warm" },
  { value: "cool", label: "Cool" },
];

type ThemeSwatch = { mode: "light" | "dark"; variant: ThemeVariant };

const ThemePreview: Component<ThemeSwatch> = (props) => {
  const prefix = () => `--thm-${props.mode}-${props.variant}`;
  const v = (name: string) => `var(${prefix()}-${name})`;
  return (
    <div
      style={{
        display: "flex",
        gap: "6px",
        padding: "6px 8px",
        background: v("bg"),
        border: `2px solid ${v("border")}`,
        "border-radius": "var(--radius)",
        "font-size": "11px",
        color: v("fg"),
        "min-width": "120px",
        "align-items": "center",
      }}
    >
      <span style={{ flex: 1 }}>Aa</span>
      <span
        style={{
          background: v("primary"),
          color: v("primary-fg"),
          padding: "1px 6px",
          "border-radius": "3px",
        }}
      >
        Btn
      </span>
      <span style={{ color: v("muted") }}>…</span>
    </div>
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
        <h2>Theme</h2>

        <label>
          Light theme
          <select
            value={themeLight()}
            onChange={(e) => setThemeLight(e.currentTarget.value as ThemeVariant)}
          >
            <For each={THEME_VARIANTS}>
              {(t) => <option value={t.value}>{t.label}</option>}
            </For>
          </select>
        </label>
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <For each={THEME_VARIANTS}>
            {(t) => (
              <div
                style={{
                  cursor: "pointer",
                  outline: themeLight() === t.value ? "2px solid var(--c-primary)" : "none",
                  "outline-offset": "2px",
                  "border-radius": "var(--radius)",
                }}
                onClick={() => setThemeLight(t.value)}
              >
                <div style={{ "font-size": "10px", "text-align": "center", "margin-bottom": "2px", color: "var(--c-muted)" }}>{t.label}</div>
                <ThemePreview mode="light" variant={t.value} />
              </div>
            )}
          </For>
        </div>

        <label>
          Dark theme
          <select
            value={themeDark()}
            onChange={(e) => setThemeDark(e.currentTarget.value as ThemeVariant)}
          >
            <For each={THEME_VARIANTS}>
              {(t) => <option value={t.value}>{t.label}</option>}
            </For>
          </select>
        </label>
        <div style={{ display: "flex", gap: "8px", "flex-wrap": "wrap" }}>
          <For each={THEME_VARIANTS}>
            {(t) => (
              <div
                style={{
                  cursor: "pointer",
                  outline: themeDark() === t.value ? "2px solid var(--c-primary)" : "none",
                  "outline-offset": "2px",
                  "border-radius": "var(--radius)",
                }}
                onClick={() => setThemeDark(t.value)}
              >
                <div style={{ "font-size": "10px", "text-align": "center", "margin-bottom": "2px", color: "var(--c-muted)" }}>{t.label}</div>
                <ThemePreview mode="dark" variant={t.value} />
              </div>
            )}
          </For>
        </div>
      </section>

      <section>
        <h2>Editor</h2>

        <label>
          Font family
          <input
            type="text"
            placeholder="(Default Serif)"
            list="editor-font-family"
            value={editorFont()}
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
            value={editorFontSize()}
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
            value={editorLineHeight()}
            onChange={(e) => setEditorLineHeight(Number(e.currentTarget.value))}
          />
        </label>

        <label>
          Font weight
          <input
            type="number"
            min={100}
            max={900}
            step={10}
            value={editorFontWeight()}
            onChange={(e) => setEditorFontWeight(Number(e.currentTarget.value))}
          />
        </label>

        <div
          style={{
            "font-family": editorFont() || SERIF_STACK,
            "font-size": `${editorFontSize()}px`,
            "font-weight": editorFontWeight(),
            "line-height": editorLineHeight(),
            padding: "0.5em",
            border: "1px solid var(--c-border)",
            "border-radius": "var(--radius)",
            "white-space": "pre-wrap",
          }}
        >
          Hello, 다람쥐, テスト文字
        </div>

        <label>
          Spellcheck
          <select
            value={spellcheck() ? "on" : "off"}
            onChange={(e) => setSpellcheck(e.currentTarget.value === "on")}
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>

        <label>
          Autocorrect
          <select
            value={autocorrect() ? "on" : "off"}
            onChange={(e) => setAutocorrect(e.currentTarget.value === "on")}
          >
            <option value="off">Off</option>
            <option value="on">On</option>
          </select>
        </label>

        <label>
          Autocapitalize
          <select
            value={autocapitalize()}
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
            value={wakeLock() ? "on" : "off"}
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
            value={previewFont()}
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
            value={previewFontSize()}
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
            value={previewLineHeight()}
            onChange={(e) =>
              setPreviewLineHeight(Number(e.currentTarget.value))
            }
          />
        </label>

        <label>
          Font weight
          <input
            type="number"
            min={100}
            max={900}
            step={10}
            value={previewFontWeight()}
            onChange={(e) =>
              setPreviewFontWeight(Number(e.currentTarget.value))
            }
          />
        </label>

        <label>
          Paragraph indent
          <select
            value={previewParaIndent() ? "on" : "off"}
            onChange={(e) =>
              setPreviewParaIndent(e.currentTarget.value === "on")
            }
          >
            <option value="on">On</option>
            <option value="off">Off</option>
          </select>
        </label>

        <div
          style={{
            "font-family": previewFont() || SERIF_STACK,
            "font-size": `${previewFontSize()}px`,
            "font-weight": previewFontWeight(),
            "line-height": previewLineHeight(),
            padding: "0.5em",
            border: "1px solid var(--c-border)",
            "border-radius": "var(--radius)",
          }}
        >
          Hello, 다람쥐, テスト文字
        </div>
      </section>

      <section>
        <h2>View</h2>

        <label>
          Context sections (before/after)
          <input
            type="number"
            min={0}
            max={5}
            value={contextSections()}
            onChange={(e) => setContextSections(Number(e.currentTarget.value))}
          />
        </label>

        <label>
          Show context as raw text
          <select
            value={contextRaw() ? "on" : "off"}
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
            value={maxWidth()}
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
          Export settings
          <button onClick={exportHujiSettings}>Export</button>
        </label>
        <label>
          Import settings
          <input
            type="file"
            accept="application/json"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) importHujiSettings(file);
            }}
          />
        </label>
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

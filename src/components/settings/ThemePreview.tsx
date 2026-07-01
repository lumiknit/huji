import type { Component } from "solid-js";
import type { ThemeVariant } from "../../states/settings";

type Props = { mode: "light" | "dark"; variant: ThemeVariant };

const ThemePreview: Component<Props> = (props) => {
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

export default ThemePreview;

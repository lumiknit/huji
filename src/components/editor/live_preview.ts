import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSetBuilder } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";

const DECO = {
  marker: Decoration.mark({ class: "cm-md-marker" }),
  paragraph: Decoration.line({ class: "cm-md-paragraph" }),
  blockquote: Decoration.line({ class: "cm-md-blockquote" }),
  codeBlock: Decoration.line({ class: "cm-md-code-block" }),
  strong: Decoration.mark({ class: "cm-md-strong" }),
  em: Decoration.mark({ class: "cm-md-em" }),
  code: Decoration.mark({ class: "cm-md-code" }),
  strike: Decoration.mark({ class: "cm-md-strike" }),
  link: Decoration.mark({ class: "cm-md-link" }),
  imageAlt: Decoration.mark({ class: "cm-md-image-alt" }),
  h: ["", 1, 2, 3, 4, 5, 6].map((n) =>
    n ? Decoration.line({ class: `cm-md-h${n}` }) : null,
  ) as (Decoration | null)[],
  hr: Decoration.line({ class: "cm-md-hr" }),
  bullet: Decoration.mark({ class: "cm-md-bullet-mark" }),
};

function buildDecoSet(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const vpFrom = view.viewport.from;
  const vpTo = view.viewport.to;

  syntaxTree(view.state).iterate({
    from: vpFrom,
    to: vpTo,
    enter(node): boolean | void {
      switch (node.name) {
        case "FencedCode": {
          for (let pos = Math.max(node.from, vpFrom); pos <= doc.length;) {
            const line = doc.lineAt(pos);
            if (line.from > vpTo) break;
            builder.add(line.from, line.from, DECO.codeBlock);
            if (line.to >= node.to) break;
            pos = line.to + 1;
          }
          return false;
        }

        case "ATXHeading1":
        case "ATXHeading2":
        case "ATXHeading3":
        case "ATXHeading4":
        case "ATXHeading5":
        case "ATXHeading6": {
          if (node.node.parent?.name === "Blockquote") break;
          const level = +node.name[node.name.length - 1];
          const lf = doc.lineAt(node.from).from;
          builder.add(lf, lf, DECO.h[level]!);
          break;
        }

        case "SetextHeading1":
        case "SetextHeading2": {
          if (node.node.parent?.name === "Blockquote") break;
          const level = node.name === "SetextHeading1" ? 1 : 2;
          const lf = doc.lineAt(node.from).from;
          builder.add(lf, lf, DECO.h[level]!);
          break;
        }

        case "HeaderMark":
        case "SetextHeadingMark": {
          builder.add(node.from, node.to, DECO.marker);
          break;
        }

        case "HorizontalRule": {
          const lf = doc.lineAt(node.from).from;
          builder.add(lf, lf, DECO.hr);
          builder.add(node.from, node.to, DECO.marker);
          break;
        }

        case "Blockquote": {
          const outermost = node.node.parent?.name !== "Blockquote";
          let child = node.node.firstChild;
          for (let pos = Math.max(node.from, vpFrom); pos <= node.to;) {
            const line = doc.lineAt(pos);
            if (line.from > vpTo) break;
            while (child && child.from < line.from) child = child.nextSibling;
            const qm =
              child?.name === "QuoteMark" && child.from <= line.to
                ? child
                : null;
            if (outermost) builder.add(line.from, line.from, DECO.blockquote);
            const qmFrom = qm ? qm.from : line.from;
            const qmTo = qm ? qm.to : Math.min(line.from + 1, line.to);
            builder.add(qmFrom, qmTo, DECO.marker);
            pos = line.to + 1;
          }
          return false;
        }

        case "QuoteMark":
          break;

        case "ListMark": {
          builder.add(node.from, node.to, DECO.bullet);
          break;
        }

        case "Paragraph": {
          const pn = node.node.parent?.name;
          if (pn === "ListItem" || pn === "Blockquote") break;
          const lf = doc.lineAt(node.from).from;
          builder.add(lf, lf, DECO.paragraph);
          break;
        }

        case "StrongEmphasis":
        case "Emphasis":
        case "InlineCode":
        case "Strikethrough":
          break;

        case "EmphasisMark":
        case "StrikethroughMark": {
          const parent = node.node.parent;
          builder.add(node.from, node.to, DECO.marker);
          if (parent?.from === node.from) {
            if (parent.name === "StrongEmphasis")
              builder.add(parent.from, parent.to, DECO.strong);
            else if (parent.name === "Emphasis")
              builder.add(parent.from, parent.to, DECO.em);
            else if (parent.name === "Strikethrough")
              builder.add(parent.from, parent.to, DECO.strike);
          }
          break;
        }

        case "CodeMark": {
          const parent = node.node.parent;
          if (parent?.name === "InlineCode") {
            builder.add(node.from, node.to, DECO.marker);
            if (parent.from === node.from)
              builder.add(parent.from, parent.to, DECO.code);
          }
          break;
        }

        case "Link": {
          let firstMark = null,
            secondMark = null;
          for (let c = node.node.firstChild; c; c = c.nextSibling) {
            if (c.name !== "LinkMark") continue;
            if (!firstMark) firstMark = c;
            else {
              secondMark = c;
              break;
            }
          }
          if (firstMark && secondMark) {
            builder.add(firstMark.from, firstMark.to, DECO.marker);
            builder.add(firstMark.to, secondMark.from, DECO.link);
            builder.add(secondMark.from, node.to, DECO.marker);
          }
          break;
        }

        case "Image": {
          let firstMark = null,
            secondMark = null;
          for (let c = node.node.firstChild; c; c = c.nextSibling) {
            if (c.name !== "LinkMark") continue;
            if (!firstMark) firstMark = c;
            else {
              secondMark = c;
              break;
            }
          }
          if (firstMark && secondMark) {
            builder.add(node.from, firstMark.to, DECO.marker);
            builder.add(firstMark.to, secondMark.from, DECO.imageAlt);
            builder.add(secondMark.from, node.to, DECO.marker);
          }
          break;
        }

        case "LinkMark":
        case "URL":
        case "LinkTitle":
        case "LinkLabel":
          break;
      }
    },
  });

  return builder.finish();
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    tree: ReturnType<typeof syntaxTree>;

    constructor(view: EditorView) {
      this.tree = syntaxTree(view.state);
      this.decorations = buildDecoSet(view);
    }

    update(update: ViewUpdate) {
      const tree = syntaxTree(update.state);
      // Background parsing can finish after the initial build, growing the
      // tree without a docChanged/viewportChanged update firing — recompute
      // so decorations (e.g. headings) don't go stale in that region.
      if (update.docChanged || update.viewportChanged || tree !== this.tree) {
        this.tree = tree;
        this.decorations = buildDecoSet(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  },
);

export const livePreviewTheme = EditorView.theme({
  "&": { background: "transparent" },
  ".cm-scroller": {
    fontFamily: "inherit",
    lineHeight: "inherit",
    overflow: "visible",
  },
  ".cm-content": { padding: "0", caretColor: "var(--c-fg)" },
  ".cm-line": { padding: "0" },
  "&.cm-focused": { outline: "none" },
  ".cm-cursor": { borderLeftColor: "var(--c-fg)" },
  ".cm-selectionBackground": {
    background: "var(--cm-selection) !important",
  },
  "&.cm-focused .cm-selectionBackground": {
    background: "var(--cm-sel-focus) !important",
  },

  ".cm-line.cm-md-paragraph": { textIndent: "var(--typo-indent, 0)" },

  ".cm-line.cm-md-h1": {
    fontSize: "2em",
    fontWeight: "900",
    color: "var(--c-fg)",
  },
  ".cm-line.cm-md-h2": {
    fontSize: "1.75em",
    fontWeight: "900",
    color: "var(--c-fg)",
  },
  ".cm-line.cm-md-h3": {
    fontSize: "1.5em",
    fontWeight: "800",
    color: "var(--c-fg)",
  },
  ".cm-line.cm-md-h4": {
    fontSize: "1.4em",
    fontWeight: "bold",
    color: "var(--c-fg)",
  },
  ".cm-line.cm-md-h5": {
    fontSize: "1.25em",
    fontWeight: "bold",
    color: "var(--c-fg)",
  },
  ".cm-line.cm-md-h6": {
    fontSize: "1.125em",
    fontWeight: "bold",
    color: "var(--c-muted)",
  },

  ".cm-md-strong": { fontWeight: "bold" },
  ".cm-md-em": { fontStyle: "italic" },
  ".cm-md-strike": {
    textDecoration: "line-through",
    color: "var(--c-muted)",
  },
  ".cm-md-code": {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "0.88em",
    background: "var(--c-border)",
    borderRadius: "3px",
    padding: "0.1em 3px",
  },

  ".cm-md-link": {
    color: "var(--c-primary)",
    textDecoration: "underline",
    cursor: "pointer",
  },
  ".cm-md-image-alt": {
    color: "var(--c-muted)",
    fontStyle: "italic",
  },

  ".cm-line.cm-md-blockquote": {
    borderLeft: "4px solid var(--c-muted)",
    paddingLeft: "0.75em",
    fontStyle: "italic",
    color: "var(--c-muted)",
  },

  ".cm-line.cm-md-code-block": {
    fontFamily: "var(--font-mono, monospace)",
    fontSize: "0.9em",
    background: "var(--c-bg-subtle)",
  },

  ".cm-line.cm-md-hr": { position: "relative" },
  ".cm-line.cm-md-hr::after": {
    content: '""',
    position: "absolute",
    top: "50%",
    left: "0",
    right: "0",
    borderTop: "1px solid var(--c-muted)",
    transform: "translateY(-50%)",
  },
  ".cm-activeLine.cm-md-hr::after": { display: "none" },

  ".cm-md-bullet-mark": { color: "var(--c-muted)" },

  ".cm-activeLine": { backgroundColor: "transparent" },

  ".cm-md-marker": { color: "transparent", fontSize: "1px" },
  ".cm-activeLine .cm-md-marker": {
    color: "var(--c-muted)",
    fontSize: "inherit",
  },
});

import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from "@codemirror/view";
import { RangeSet, RangeSetBuilder } from "@codemirror/state";
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

function buildDecoSet(
  view: EditorView,
  from: number = view.viewport.from,
  to: number = view.viewport.to,
): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  const vpFrom = from;
  const vpTo = to;

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

// Extra padding kept around the viewport so small scrolls don't need any
// recompute at all; only scrolling past this margin triggers new work.
const VIEWPORT_MARGIN = 1024;

type Tree = ReturnType<typeof syntaxTree>;

// Walks up from `pos` to the block-level node directly under the document
// root. Its span is exactly the region whose decorations can change when the
// node's content/structure changes — e.g. deleting a closing fence marker
// re-parents everything up to the next fence (or EOF) into one FencedCode
// node, and that node's `.to` reflects it automatically.
function topBlockRange(
  tree: Tree,
  pos: number,
  side: -1 | 1,
): { from: number; to: number } {
  let node = tree.resolveInner(pos, side);
  while (node.parent && node.parent !== tree.topNode) node = node.parent;
  return { from: node.from, to: node.to };
}

function unionTopBlockRange(
  tree: Tree,
  from: number,
  to: number,
): { from: number; to: number } {
  const start = topBlockRange(tree, from, 1);
  const end = to > from ? topBlockRange(tree, to - 1, -1) : start;
  return {
    from: Math.min(start.from, end.from),
    to: Math.max(start.to, end.to),
  };
}

function paddedRange(view: EditorView): { from: number; to: number } {
  return {
    from: Math.max(0, view.viewport.from - VIEWPORT_MARGIN),
    to: Math.min(view.state.doc.length, view.viewport.to + VIEWPORT_MARGIN),
  };
}

export const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    // The doc range (in current-doc coordinates) for which `decorations` is
    // known to be complete and accurate.
    builtFrom: number;
    builtTo: number;

    constructor(view: EditorView) {
      const { from, to } = paddedRange(view);
      this.decorations = buildDecoSet(view, from, to);
      this.builtFrom = from;
      this.builtTo = to;
    }

    update(update: ViewUpdate) {
      const view = update.view;
      if (update.docChanged) {
        this.decorations = this.decorations.map(update.changes);
        this.builtFrom = update.changes.mapPos(this.builtFrom, -1);
        this.builtTo = update.changes.mapPos(this.builtTo, 1);
        this.patchChangedBlocks(update);
      }
      this.ensureViewportCovered(view);
    }

    // Re-derives decorations only for the block(s) touched by this edit,
    // instead of rebuilding the whole built range.
    private patchChangedBlocks(update: ViewUpdate) {
      const oldTree = syntaxTree(update.startState);
      const newTree = syntaxTree(update.state);
      let patchFrom = Infinity;
      let patchTo = -Infinity;

      update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
        const oldRange = unionTopBlockRange(oldTree, fromA, toA);
        const mappedOldFrom = update.changes.mapPos(oldRange.from, -1);
        const mappedOldTo = update.changes.mapPos(oldRange.to, 1);
        const newRange = unionTopBlockRange(newTree, fromB, toB);
        patchFrom = Math.min(patchFrom, mappedOldFrom, newRange.from);
        patchTo = Math.max(patchTo, mappedOldTo, newRange.to);
      });
      if (patchFrom > patchTo) return;

      const view = update.view;
      const from = Math.max(this.builtFrom, patchFrom, 0);
      const to = Math.min(this.builtTo, patchTo, view.state.doc.length);
      if (from >= to) return;
      this.replaceRange(view, from, to);
    }

    // Keeps `decorations` covering the (padded) viewport, evicting anything
    // outside it so the set doesn't grow unbounded as the user scrolls
    // around a long document.
    private ensureViewportCovered(view: EditorView) {
      const { from: wantFrom, to: wantTo } = paddedRange(view);
      if (wantFrom === this.builtFrom && wantTo === this.builtTo) return;

      if (wantFrom >= this.builtTo || wantTo <= this.builtFrom) {
        // Jumped somewhere disjoint from what's built (e.g. search jump) —
        // nothing salvageable, just rebuild the new window from scratch.
        this.decorations = buildDecoSet(view, wantFrom, wantTo);
      } else {
        if (wantFrom < this.builtFrom)
          this.replaceRange(view, wantFrom, this.builtFrom);
        if (wantTo > this.builtTo)
          this.replaceRange(view, this.builtTo, wantTo);
        this.decorations = this.decorations.update({
          filter: (from, to) => !(to <= wantFrom || from >= wantTo),
        });
      }
      this.builtFrom = wantFrom;
      this.builtTo = wantTo;
    }

    // Recomputes decorations for [from, to) and splices them into the
    // existing set, leaving decorations outside that range untouched.
    private replaceRange(view: EditorView, from: number, to: number) {
      const kept = this.decorations.update({
        filterFrom: from,
        filterTo: to,
        filter: () => false,
      });
      const fresh = buildDecoSet(view, from, to);
      this.decorations = RangeSet.join([kept, fresh]);
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

  // Same specificity as highlightActiveLine()'s baseTheme rule for
  // .cm-activeLine; this wins the tie because livePreviewTheme is registered
  // after highlightActiveLine() in cm_setup.ts (later stylesheet wins ties),
  // so no !important needed — and .cm-line.cm-md-code-block (2 classes)
  // still legitimately outranks this 1-class rule on code-fence lines.
  ".cm-activeLine": { backgroundColor: "transparent" },

  ".cm-md-marker": { color: "transparent", fontSize: "1px" },
  ".cm-activeLine .cm-md-marker": {
    color: "var(--c-muted)",
    fontSize: "inherit",
  },
});

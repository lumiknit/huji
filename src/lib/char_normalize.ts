export type QuotesMode = "keep" | "ascii";
export type EllipsisMode = "keep" | "ascii" | "smart";
export type DashMode = "keep" | "ascii" | "smart";
export type FullwidthMode = "keep" | "halfwidth";
// "trim" also implies "normalize" (unicode space -> ASCII space), and
// additionally collapses interior tab/space runs to one space and strips
// trailing tab/space, per line. Leading whitespace is always left alone.
export type WhitespaceMode = "keep" | "normalize" | "trim";
export type SpecialCharMode = "keep" | "remove";

export type CharNormalizeOptions = {
  quotes: QuotesMode;
  ellipsis: EllipsisMode;
  dash: DashMode;
  fullwidth: FullwidthMode;
  whitespace: WhitespaceMode;
  special: SpecialCharMode;
};

export const defaultCharNormalizeOptions = (): CharNormalizeOptions => ({
  quotes: "ascii",
  ellipsis: "smart",
  dash: "smart",
  fullwidth: "halfwidth",
  whitespace: "normalize",
  special: "remove",
});

export type CharNormalizeResult = {
  text: string;
  count: number;
};

// All non-ASCII code points are referenced by numeric code point below and
// turned into characters via String.fromCharCode. This keeps the source
// file itself pure ASCII, since editors/tools mangle literal unicode
// punctuation glyphs embedded in regex literals.
const chr = (code: number): string => String.fromCharCode(code);
const range = (from: number, to: number): number[] => {
  const out: number[] = [];
  for (let c = from; c <= to; c++) out.push(c);
  return out;
};
const classOf = (codes: number[]): string => codes.map(chr).join("");
const classRe = (codes: number[]): RegExp =>
  new RegExp(`[${classOf(codes)}]`, "g");

// Curly double quotes (0x201C, 0x201D) and low/reversed double quotes
// (0x201E, 0x201F) -> ASCII '"'.
const DOUBLE_QUOTES_RE = classRe([0x201c, 0x201d, 0x201e, 0x201f]);
// Curly single quotes (0x2018, 0x2019) and low/reversed single quotes
// (0x201a, 0x201b) -> ASCII "'".
const SINGLE_QUOTES_RE = classRe([0x2018, 0x2019, 0x201a, 0x201b]);

const ELLIPSIS_CODE = 0x2026; // horizontal ellipsis "..."
const ELLIPSIS_CHAR = chr(ELLIPSIS_CODE);
// Runs of "." and the horizontal ellipsis character mixed together.
const ELLIPSIS_RUN_RE = new RegExp(`[.${ELLIPSIS_CHAR}]+`, "g");

// Ascii-hyphen-equivalent width of each unicode dash, used to round-trip
// between "--"/"---" typed hyphens and en/em dash in "smart" mode.
const DASH_WIDTH_CODES: Array<[number, number]> = [
  [0x2012, 1], // figure dash
  [0x2013, 2], // en dash
  [0x2014, 3], // em dash
  [0x2015, 3], // horizontal bar
  [0x2212, 1], // minus sign
];
const DASH_WIDTH: Record<string, number> = {};
for (const [code, width] of DASH_WIDTH_CODES) DASH_WIDTH[chr(code)] = width;
const EN_DASH = chr(0x2013);
const EM_DASH = chr(0x2014);
const DASH_RUN_RE = new RegExp(
  `[-${classOf(DASH_WIDTH_CODES.map(([code]) => code))}]+`,
  "g",
);
const THEMATIC_BREAK_RE = /^-{2,}$/;

const dashForWidth = (width: number): string => {
  if (width <= 1) return "-";
  if (width === 2) return EN_DASH;
  return EM_DASH;
};

// Various unicode space characters (tab/newline excluded) collapsed to a
// plain ASCII space: NBSP, Ogham space mark, En quad through hair space,
// narrow no-break space, medium mathematical space, ideographic space.
const WHITESPACE_RE = classRe([
  0x00a0,
  0x1680,
  ...range(0x2000, 0x200a),
  0x202f,
  0x205f,
  0x3000,
]);

// Per-line whitespace trimming helpers: leading tab/space is left alone,
// interior runs collapse to one space, trailing tab/space is stripped.
const LEADING_WS_RE = /^[ \t]*/;
const INNER_WS_RUN_RE = /[ \t]+/g;
const TRAILING_WS_RE = / $/;

// Invisible/control characters with no visible purpose in prose: C0 control
// codes other than tab/newline/CR, DEL, soft hyphen, zero-width
// space/joiner/non-joiner, BOM, and the U+FFFE/U+FFFF/U+FFFD noncharacters.
const SPECIAL_RE = classRe([
  ...range(0x00, 0x08),
  0x0b,
  0x0c,
  ...range(0x0e, 0x1f),
  0x7f,
  0x00ad,
  0x200b,
  0x200c,
  0x200d,
  0xfeff,
  0xfffe,
  0xffff,
  0xfffd,
]);

// Fullwidth Forms block (0xFF01-0xFF5E) -> matching ASCII punctuation/alnum.
const FULLWIDTH_RE = classRe(range(0xff01, 0xff5e));
const FULLWIDTH_OFFSET = 0xfee0;
const toHalfwidth = (ch: string) =>
  String.fromCharCode(ch.charCodeAt(0) - FULLWIDTH_OFFSET);

export const normalizeCharacters = (
  input: string,
  opts: CharNormalizeOptions,
): CharNormalizeResult => {
  let text = input;
  let count = 0;

  if (opts.quotes !== "keep") {
    text = text.replace(DOUBLE_QUOTES_RE, () => {
      count++;
      return '"';
    });
    text = text.replace(SINGLE_QUOTES_RE, () => {
      count++;
      return "'";
    });
  }

  if (opts.ellipsis !== "keep") {
    text = text.replace(ELLIPSIS_RUN_RE, (run) => {
      let dots = 0;
      for (const ch of run) dots += ch === ELLIPSIS_CHAR ? 3 : 1;
      const out =
        opts.ellipsis === "ascii"
          ? ".".repeat(dots)
          : ELLIPSIS_CHAR.repeat(Math.floor(dots / 3)) + ".".repeat(dots % 3);
      if (out !== run) count++;
      return out;
    });
  }

  if (opts.dash !== "keep") {
    // Thematic-break / setext-underline lines ("---") are markdown syntax,
    // not prose dashes - leave them untouched.
    text = text
      .split("\n")
      .map((line) => {
        if (THEMATIC_BREAK_RE.test(line.trim())) return line;
        return line.replace(DASH_RUN_RE, (run) => {
          let width = 0;
          for (const ch of run) width += DASH_WIDTH[ch] ?? 1;
          const out =
            opts.dash === "ascii" ? "-".repeat(width) : dashForWidth(width);
          if (out !== run) count++;
          return out;
        });
      })
      .join("\n");
  }

  if (opts.fullwidth !== "keep") {
    text = text.replace(FULLWIDTH_RE, (ch) => {
      count++;
      return toHalfwidth(ch);
    });
  }

  if (opts.whitespace === "normalize") {
    text = text.replace(WHITESPACE_RE, () => {
      count++;
      return " ";
    });
  } else if (opts.whitespace === "trim") {
    // Leading tab/space is left completely untouched (not even unicode-space
    // normalized) - only the rest of the line is normalized, collapsed, and
    // trailing-stripped.
    text = text
      .split("\n")
      .map((line) => {
        const leadMatch = line.match(LEADING_WS_RE);
        const leading = leadMatch ? leadMatch[0] : "";
        const rest = line
          .slice(leading.length)
          .replace(WHITESPACE_RE, " ")
          .replace(INNER_WS_RUN_RE, " ")
          .replace(TRAILING_WS_RE, "");
        const out = leading + rest;
        if (out !== line) count++;
        return out;
      })
      .join("\n");
  }

  if (opts.special === "remove") {
    text = text.replace(SPECIAL_RE, () => {
      count++;
      return "";
    });
  }

  return { text, count };
};

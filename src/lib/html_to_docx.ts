import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  ExternalHyperlink,
  type IParagraphOptions,
} from "docx";

type RunStyle = {
  bold?: boolean;
  italics?: boolean;
  strike?: boolean;
  code?: boolean;
};

function collectRuns(
  node: Node,
  style: RunStyle,
): (TextRun | ExternalHyperlink)[] {
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node.textContent ?? "";
    if (!text) return [];
    return [
      new TextRun({
        text,
        bold: style.bold,
        italics: style.italics,
        strike: style.strike,
        ...(style.code ? { font: "Courier New", size: 18 } : {}),
      }),
    ];
  }

  if (node.nodeType !== Node.ELEMENT_NODE) return [];
  const el = node as Element;
  const tag = el.tagName.toLowerCase();

  const childStyle = { ...style };
  if (tag === "strong" || tag === "b") childStyle.bold = true;
  if (tag === "em" || tag === "i") childStyle.italics = true;
  if (tag === "s" || tag === "del") childStyle.strike = true;
  if (tag === "code") childStyle.code = true;

  if (tag === "br") return [new TextRun({ text: "", break: 1 })];

  if (tag === "a") {
    const href = el.getAttribute("href") ?? "";
    const runs = Array.from(el.childNodes).flatMap((c) =>
      collectRuns(c, childStyle),
    );
    if (!href) return runs;
    return [new ExternalHyperlink({ link: href, children: runs as TextRun[] })];
  }

  return Array.from(el.childNodes).flatMap((c) => collectRuns(c, childStyle));
}

function elToParagraphs(el: Element): Paragraph[] {
  const tag = el.tagName.toLowerCase();

  if (/^h[1-6]$/.test(tag)) {
    const level = [
      HeadingLevel.HEADING_1,
      HeadingLevel.HEADING_2,
      HeadingLevel.HEADING_3,
      HeadingLevel.HEADING_4,
      HeadingLevel.HEADING_5,
      HeadingLevel.HEADING_6,
    ][parseInt(tag[1]) - 1];
    return [
      new Paragraph({
        heading: level,
        children: collectRuns(el, {}) as TextRun[],
      }),
    ];
  }

  if (tag === "p") {
    return [new Paragraph({ children: collectRuns(el, {}) as TextRun[] })];
  }

  if (tag === "blockquote") {
    return Array.from(el.querySelectorAll("p")).map(
      (p) =>
        new Paragraph({
          indent: { left: 720 },
          children: collectRuns(p, { italics: true }) as TextRun[],
        }),
    );
  }

  if (tag === "pre") {
    const code = el.querySelector("code");
    const text = (code ?? el).textContent ?? "";
    return text.split("\n").map(
      (line) =>
        new Paragraph({
          children: [
            new TextRun({ text: line, font: "Courier New", size: 18 }),
          ],
        }),
    );
  }

  if (tag === "ul" || tag === "ol") {
    const isOrdered = tag === "ol";
    return Array.from(el.children)
      .filter((c) => c.tagName.toLowerCase() === "li")
      .map((li, i) => {
        const opts: IParagraphOptions = {
          indent: { left: 720, hanging: 360 },
          children: [
            new TextRun({ text: isOrdered ? `${i + 1}. ` : "• " }),
            ...(collectRuns(li, {}) as TextRun[]),
          ],
        };
        return new Paragraph(opts);
      });
  }

  if (tag === "hr") {
    return [
      new Paragraph({
        border: {
          bottom: { color: "AAAAAA", size: 6, style: "single", space: 1 },
        },
        children: [],
      }),
    ];
  }

  return [];
}

export async function convert(html: string): Promise<Blob> {
  const div = document.createElement("div");
  div.innerHTML = html;

  const paragraphs = Array.from(div.children).flatMap((el) =>
    elToParagraphs(el),
  );

  const doc = new Document({
    sections: [{ properties: {}, children: paragraphs }],
  });

  return Packer.toBlob(doc);
}

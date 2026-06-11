import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ async: false });

export const renderMarkdown = (raw: string): string => {
  const html = marked.parse(raw) as string;
  return DOMPurify.sanitize(html);
};

/** Extracts plain text from an HTML string. */
export const htmlToText = (html: string): string => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.textContent ?? "";
};

/** Extracts plain text from markdown (for .txt export). */
export const extractText = (raw: string): string =>
  htmlToText(renderMarkdown(raw));

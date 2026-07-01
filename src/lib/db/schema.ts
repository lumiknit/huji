import type { DBSchema } from "idb";

export type SectionMeta = {
  id: string;
  fileId: string;
  fracIndex: number;
  /** -1 = frontmatter, 0 = heading-less intro, 1–6 = H1–H6 */
  level: number;
  /** level=-1: preferred edit format ("json" | "yaml"); stored content is always compact JSON */
  heading: string;
  updatedAt: string;
};

export type SectionContent = {
  id: string;
  content: string;
  updatedAt: string;
};

export interface HujiDB extends DBSchema {
  meta: {
    key: string;
    value: SectionMeta;
    indexes: { byFile: string };
  };
  content: {
    key: string;
    value: SectionContent;
  };
}

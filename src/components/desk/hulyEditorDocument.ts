import { Extension, Mark, Node, getSchema, type Editor, type Extensions, type JSONContent } from "@tiptap/core";

const opaqueBlock = "hdOpaqueBlock";
const opaqueInline = "hdOpaqueInline";
const opaqueMark = "hdOpaqueMark";
const extraAttrs = "hdExtraAttrs";

function opaqueNode(name: string, inline: boolean) {
  return Node.create({
    name, inline, group: inline ? "inline" : "block", atom: true,
    addAttributes: () => ({ original: { default: null, rendered: false } }),
    renderHTML: ({ node }) => {
      const original = node.attrs.original as JSONContent | null;
      const labels: Record<string, string> = { drawingBoard: "画板", mathematics: "公式", inlineMath: "公式", blockMath: "公式" };
      const text = extractText(original);
      return [inline ? "span" : "div", { class: "hd-opaque-rich-content", contenteditable: "false" },
        text || labels[original?.type ?? ""] || "Huly 富文本内容"];
    },
  });
}

function extractText(content?: JSONContent | null): string {
  return content?.text ?? content?.content?.map(extractText).join(" ") ?? "";
}

export function compatibleEditorExtensions(base: Extensions): Extensions {
  const baseSchema = getSchema(base);
  return [
    ...base,
    opaqueNode(opaqueInline, true), opaqueNode(opaqueBlock, false),
    Mark.create({
      name: opaqueMark,
      addAttributes: () => ({ original: { default: [], rendered: false } }),
      renderHTML: () => ["span", 0],
    }),
    Extension.create({
      name: "hdPreserveHulyAttributes",
      addGlobalAttributes: () => [{
        types: [...Object.keys(baseSchema.nodes).filter((name) => name !== "text"), ...Object.keys(baseSchema.marks)],
        attributes: { [extraAttrs]: { default: null, rendered: false } },
      }],
    }),
  ];
}

function withExtraAttrs(attrs: JSONContent["attrs"], known: Record<string, unknown>): JSONContent["attrs"] {
  if (!attrs) return attrs;
  const kept: Record<string, unknown> = {};
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(attrs)) {
    (key !== extraAttrs && Object.hasOwn(known, key) ? kept : extra)[key] = value;
  }
  return Object.keys(extra).length ? { ...kept, [extraAttrs]: extra } : kept;
}

export function toEditorDocument(document: JSONContent, schema: Editor["schema"]): JSONContent {
  if (document.type !== "doc") throw new Error("不是 Huly 文档");
  function convert(node: JSONContent, inline: boolean): JSONContent {
    const type = node.type && Object.hasOwn(schema.nodes, node.type) && schema.nodes[node.type];
    if (!type || node.type === opaqueBlock || node.type === opaqueInline) return opaque(node, inline);
    const marks: NonNullable<JSONContent["marks"]> = [];
    const unknownMarks: typeof marks = [];
    for (const mark of node.marks ?? []) {
      const markType = mark.type !== opaqueMark && Object.hasOwn(schema.marks, mark.type) && schema.marks[mark.type];
      if (markType) marks.push({ ...mark, attrs: withExtraAttrs(mark.attrs, markType.spec.attrs ?? {}) });
      else unknownMarks.push(mark);
    }
    if (unknownMarks.length) marks.push({ type: opaqueMark, attrs: { original: unknownMarks } });
    const children = node.content?.filter((child) => child.type !== "text" || child.text !== "")
      .map((child) => convert(child, type.inlineContent));
    const content = node.type === "doc" && !children?.length ? [{ type: "paragraph" }] : children;
    return { ...node, attrs: withExtraAttrs(node.attrs, type.spec.attrs ?? {}), marks, content };
  }
  const converted = convert(document, false);
  try {
    schema.nodeFromJSON(converted).check();
    return converted;
  } catch {
    // If a newer block has constraints this schema cannot represent (for
    // example a new table cell type), preserve the whole affected block.
    const content = document.content?.map((original) => {
      const block = convert(original, false);
      try {
        const node = schema.nodeFromJSON(block);
        node.check();
        return node.isBlock ? block : opaque(original, false);
      } catch {
        return opaque(original, false);
      }
    });
    if (!content?.length) throw new Error("无法读取 Huly 文档内容");
    return { ...converted, content };
  }
}

function opaque(original: JSONContent, inline: boolean): JSONContent {
  return { type: inline ? opaqueInline : opaqueBlock, attrs: { original } };
}

export function fromEditorDocument(node: JSONContent): JSONContent {
  if ((node.type === opaqueBlock || node.type === opaqueInline) && node.attrs?.original) {
    return node.attrs.original as JSONContent;
  }
  const marks = node.marks?.flatMap((mark) => {
    if (mark.type === opaqueMark && Array.isArray(mark.attrs?.original)) return mark.attrs.original as NonNullable<JSONContent["marks"]>;
    const attrs = restoreAttrs(mark.attrs);
    return [attrs ? { ...mark, attrs } : { type: mark.type }];
  });
  const attrs = restoreAttrs(node.attrs);
  return { ...node, attrs, marks, content: node.content?.map(fromEditorDocument) };
}

function restoreAttrs(attrs: JSONContent["attrs"]): JSONContent["attrs"] {
  if (!attrs) return undefined;
  const { [extraAttrs]: extra, ...known } = attrs;
  const restored = { ...known, ...extra };
  return Object.keys(restored).length ? restored : undefined;
}

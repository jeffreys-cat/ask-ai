import { splitTextIntoChunks, type SplitOptions } from "./splitter";

export function chunkMarkdown(markdown: string, options: SplitOptions) {
  const { body, frontmatter } = extractFrontmatter(markdown);
  const cleaned = body
    .replace(/^\s*import\s.+$/gm, "")
    .replace(/^\s*export\s+(?:default\s+)?(?:const|let|var|function|class|\{)[\s\S]*?(?=\n{2,}|$)/gm, "")
    .replace(/<([A-Z][A-Za-z0-9.]*)(?:\s[^>]*)?\/>/g, "")
    .replace(/<\/?[A-Z][A-Za-z0-9.]*[^>]*>/g, "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```[^\n]*\n?/g, ""))
    .replace(/!\[[^\]]*]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/[*_~`>]/g, "");

  const sections = splitIntoHeadingSections(cleaned);
  const chunks = sections.flatMap((section, sectionIndex) =>
    splitTextIntoChunks(section.content, {
      ...options,
      documentId: `${options.documentId}:section-${sectionIndex}`,
      metadata: {
        ...(options.metadata ?? {}),
        parser: "markdown",
        frontmatter,
        headingPath: section.headingPath,
      },
    }),
  );

  return chunks.map((chunk, order) => ({
    ...chunk,
    chunkId: `${options.documentId}:${order}`,
    order,
    metadata: {
      ...chunk.metadata,
      order,
    },
  }));
}

function extractFrontmatter(markdown: string) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n?/);
  if (!match) return { body: markdown, frontmatter: {} };

  const frontmatter: Record<string, string> = {};
  const rawFrontmatter = match[1] ?? "";
  for (const line of rawFrontmatter.split("\n")) {
    const pair = line.match(/^([A-Za-z0-9_-]+):\s*(.+)$/);
    const key = pair?.[1];
    const value = pair?.[2];
    if (key && value) frontmatter[key] = value.replace(/^['"]|['"]$/g, "");
  }

  return { body: markdown.slice(match[0].length), frontmatter };
}

function splitIntoHeadingSections(markdown: string) {
  const lines = markdown.split("\n");
  const sections: Array<{ headingPath: string[]; content: string }> = [];
  const headingStack: string[] = [];
  let current: string[] = [];
  let currentPath: string[] = [];

  const flush = () => {
    const content = current.join("\n").replace(/^#{1,6}\s+/gm, "").trim();
    if (content) sections.push({ headingPath: currentPath, content });
    current = [];
  };

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    const marker = heading?.[1];
    const title = heading?.[2];
    if (marker && title) {
      flush();
      const level = marker.length;
      headingStack.splice(level - 1);
      headingStack[level - 1] = title.trim();
      currentPath = headingStack.filter(Boolean);
    }
    current.push(line);
  }
  flush();

  return sections.length > 0 ? sections : [{ headingPath: [], content: markdown.replace(/^#{1,6}\s+/gm, "").trim() }];
}

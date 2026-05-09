import { describe, expect, it } from "vitest";
import { chunkMarkdown } from "./markdown";

describe("chunkMarkdown", () => {
  it("preserves frontmatter, source metadata, and heading paths", () => {
    const chunks = chunkMarkdown(
      `---
title: Getting Started
description: Setup guide
---

# Guide

Welcome to [Ask AI](/ask).

## Install

Run the installer.`,
      { documentId: "doc-1", metadata: { sourcePath: "docs/index.mdx", projectId: "project-1" } },
    );

    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]?.metadata).toMatchObject({
      parser: "markdown",
      sourcePath: "docs/index.mdx",
      projectId: "project-1",
      frontmatter: { title: "Getting Started", description: "Setup guide" },
    });
    expect(chunks.some((chunk) => (chunk.metadata as { headingPath?: string[] }).headingPath?.includes("Install"))).toBe(true);
    expect(chunks.map((chunk) => chunk.chunkId)).toEqual(chunks.map((_, index) => `doc-1:${index}`));
  });

  it("lightly strips MDX imports, JSX components, code fences, and markdown link syntax", () => {
    const chunks = chunkMarkdown(
      `import { Callout } from "nextra/components";

# MDX Page

<Callout type="info">Use the stable API.</Callout>

\`\`\`ts
const value = "kept without fences";
\`\`\`

Read [the docs](/docs).`,
      { documentId: "doc-2" },
    );

    const content = chunks.map((chunk) => chunk.content).join("\n");
    expect(content).not.toContain("import { Callout }");
    expect(content).not.toContain("<Callout");
    expect(content).not.toContain("```");
    expect(content).not.toContain("[the docs]");
    expect(content).toContain("the docs");
    expect(content).toContain("stable API");
  });
});

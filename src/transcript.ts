import type { Message, ContentBlock } from "./types/messages.ts";

export type TranscriptFormat = "markdown" | "html";
export interface TranscriptOptions {
  format?: TranscriptFormat;
  title?: string;
  /** Include tool call/result payloads instead of only their visible text. */
  includeToolDetails?: boolean;
}

/** Render a lossless message projection without embedding image base64 data. */
export function renderTranscript(messages: Message[], options: TranscriptOptions = {}): string {
  return options.format === "html" ? renderHTMLTranscript(messages, options) : renderMarkdownTranscript(messages, options);
}

export function renderMarkdownTranscript(messages: Message[], options: TranscriptOptions = {}): string {
  const title = options.title ?? "DoMoCode transcript";
  const lines = [`# ${escapeMarkdown(title)}`, ""];
  for (const message of messages) {
    lines.push(`## ${roleLabel(message.role)}`, "");
    if (message.role === "system") lines.push(message.content, "");
    else {
      for (const block of contentBlocks(message)) {
        const rendered = markdownBlock(block, options.includeToolDetails ?? true);
        if (rendered) lines.push(rendered, "");
      }
      if (message.role === "assistant" && message.errorMessage) lines.push(`> Error: ${escapeMarkdown(message.errorMessage)}`, "");
    }
  }
  return trimTrailingBlankLines(lines).join("\n") + "\n";
}

export function renderHTMLTranscript(messages: Message[], options: TranscriptOptions = {}): string {
  const title = options.title ?? "DoMoCode transcript";
  const sections = messages.map((message) => {
    const body = message.role === "system"
      ? `<p>${escapeHTML(message.content)}</p>`
      : contentBlocks(message).map((block) => htmlBlock(block, options.includeToolDetails ?? true)).filter(Boolean).join("\n");
    const error = message.role === "assistant" && message.errorMessage ? `<p class="error">${escapeHTML(message.errorMessage)}</p>` : "";
    return `<section class="message message-${message.role}"><h2>${escapeHTML(roleLabel(message.role))}</h2>${body}${error}</section>`;
  }).join("\n");
  return `<!doctype html>\n<html><head><meta charset="utf-8"><title>${escapeHTML(title)}</title></head><body><main><h1>${escapeHTML(title)}</h1>${sections}</main></body></html>\n`;
}

function markdownBlock(block: ContentBlock, includeToolDetails: boolean): string {
  switch (block.type) {
    case "text": return block.text;
    case "reasoning": return `<details>\n<summary>Reasoning</summary>\n\n${block.text}\n\n</details>`;
    case "toolCall": return includeToolDetails ? `**Tool call** \`${escapeMarkdown(block.name)}\`\n\n\`\`\`json\n${JSON.stringify(block.arguments, null, 2)}\n\`\`\`` : `**Tool call** \`${escapeMarkdown(block.name)}\``;
    case "toolResult": return includeToolDetails ? `**Tool result** \`${escapeMarkdown(block.toolName)}\`\n\n${block.isError ? "> Error: " : ""}${block.output}` : block.output;
    case "image": return `[image: ${escapeMarkdown(block.mediaType)}]`;
  }
}

function htmlBlock(block: ContentBlock, includeToolDetails: boolean): string {
  switch (block.type) {
    case "text": return `<p>${escapeHTML(block.text)}</p>`;
    case "reasoning": return `<details><summary>Reasoning</summary><p>${escapeHTML(block.text)}</p></details>`;
    case "toolCall": return includeToolDetails ? `<div class="tool-call"><h3>Tool call <code>${escapeHTML(block.name)}</code></h3><pre>${escapeHTML(JSON.stringify(block.arguments, null, 2))}</pre></div>` : `<p>Tool call <code>${escapeHTML(block.name)}</code></p>`;
    case "toolResult": return includeToolDetails ? `<div class="tool-result"><h3>Tool result <code>${escapeHTML(block.toolName)}</code></h3><pre class="${block.isError ? "error" : ""}">${escapeHTML(block.output)}</pre></div>` : `<p>${escapeHTML(block.output)}</p>`;
    case "image": return `<p>[image: ${escapeHTML(block.mediaType)}]</p>`;
  }
}

function roleLabel(role: Message["role"]): string { return role[0]!.toUpperCase() + role.slice(1); }
function contentBlocks(message: Exclude<Message, { role: "system" }>): ContentBlock[] {
  if (message.role !== "tool") return message.content;
  return [{ type: "toolResult", toolCallId: message.toolCallId, toolName: message.toolName, output: message.output, isError: message.isError, ...(message.images === undefined ? {} : { images: message.images }) }];
}
function trimTrailingBlankLines(lines: string[]): string[] { while (lines.at(-1) === "") lines.pop(); return lines; }
function escapeMarkdown(value: string): string { return value.replaceAll("\\", "\\\\").replaceAll("`", "\\`"); }
function escapeHTML(value: string): string { return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;"); }

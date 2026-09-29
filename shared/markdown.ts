/*
 * The Markdown Todoist reads in task names (inline only) and descriptions (blocks too). Hand-written rather
 * than a dependency. Shared by the app, which renders it as React elements (never as HTML, so whatever another
 * app wrote in a task can't inject markup), and the tasks feed, which turns it into plain text for calendars.
 * Plain TypeScript only: the backend runs it with type stripping.
 */

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[] };

export type Block =
  | { type: 'paragraph'; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'code'; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: Block[][] }
  | { type: 'rule' };

const wrap = (type: 'strong' | 'em' | 'del') => (match: RegExpExecArray) => ({ type, children: parseInline(match[1]!) });

interface InlineRule {
  pattern: RegExp;
  make: (match: RegExpExecArray) => Inline;
  /** Links can't nest in links. */
  link?: boolean;
}

// Sticky patterns, tried in order where one could start. Emphasis must hug its text (`2 * 3 * 4` stays as is),
// and underscores only count at word edges, so snake_case names stay as they are.
const INLINE: InlineRule[] = [
  { pattern: /\\([!-/:-@[-`{-~])/y, make: (m) => ({ type: 'text', text: m[1]! }) },
  { pattern: /`([^`\n]+)`/y, make: (m) => ({ type: 'code', text: m[1]! }) },
  {
    pattern: /\[([^\]\n]+)\]\(\s*<?([^\s()<>]+)>?\s*\)/y,
    make: (m) => ({ type: 'link', href: m[2]!, children: parseInline(m[1]!, false) }),
    link: true,
  },
  { pattern: /\*\*(?=\S)([\s\S]+?)(?<=\S)\*\*/y, make: wrap('strong') },
  { pattern: /(?<![\p{L}\p{N}])__(?=\S)([\s\S]+?)(?<=\S)__(?![\p{L}\p{N}])/uy, make: wrap('strong') },
  { pattern: /~~(?=\S)([\s\S]+?)(?<=\S)~~/y, make: wrap('del') },
  { pattern: /\*(?=[^\s*])([\s\S]+?)(?<=[^\s*])\*(?!\*)/y, make: wrap('em') },
  { pattern: /(?<![\p{L}\p{N}])_(?=[^\s_])([\s\S]+?)(?<=[^\s_])_(?![\p{L}\p{N}])/uy, make: wrap('em') },
  {
    // Trailing punctuation belongs to the sentence, and a parenthesis only to a URL that opened it (Wikipedia's).
    pattern: /(?<![\p{L}\p{N}])(?:https?|obsidian):\/\/(?:[^\s<>()]|\([^\s<>()]*\))*(?:[^\s<>().,;:!?'"*_~\]]|\([^\s<>()]*\))/uy,
    make: (m) => ({ type: 'link', href: m[0], children: [{ type: 'text', text: m[0] }] }),
    link: true,
  },
];

/** Characters an inline rule can start with; anything else is plain text, without trying every pattern. */
const STARTS = new Set(['\\', '`', '[', '*', '_', '~', 'h', 'o']);

export function parseInline(text: string, links = true): Inline[] {
  const nodes: Inline[] = [];
  let plain = '';
  let i = 0;
  outer: while (i < text.length) {
    if (STARTS.has(text[i]!)) {
      for (const rule of INLINE) {
        if (rule.link && !links) continue;
        rule.pattern.lastIndex = i;
        const match = rule.pattern.exec(text);
        if (!match) continue;
        // Read before making the node: parsing what's inside reuses these same patterns.
        i = rule.pattern.lastIndex;
        const node = rule.make(match);
        if (node.type === 'text') {
          plain += node.text;
        } else {
          if (plain) nodes.push({ type: 'text', text: plain });
          plain = '';
          nodes.push(node);
        }
        continue outer;
      }
    }
    plain += text[i++];
  }
  if (plain) nodes.push({ type: 'text', text: plain });
  return nodes;
}

/**
 * Only web, mail and Obsidian links (obsidian://open?vault=...&file=..., from "Copy Obsidian URL"): a task could
 * carry a javascript: URL. Obsidian's URLs can also create notes, but the browser asks before opening the app.
 */
export const isSafeHref = (href: string) => /^(?:https?:\/\/|mailto:|obsidian:\/\/)/i.test(href);

/** Web pages open in a new tab; mail and Obsidian links hand over to their app and leave the page as it is. */
export const isWebHref = (href: string) => /^https?:\/\//i.test(href);

const formattedInline = (text: string) => parseInline(text).some((node) => node.type !== 'text');

/**
 * Whether the text shows any differently from how it's typed (marks, links; with `blocks`, also headings, lists...),
 * so a click on it may be meant for a link or a selection rather than for editing.
 */
export function hasMarkdown(markdown: string, blocks = false): boolean {
  if (!blocks) return formattedInline(markdown);
  return parseMarkdown(markdown).some((block) => block.type !== 'paragraph' || formattedInline(block.text));
}

const FENCE = /^ {0,3}(```|~~~)/;
// A space after the hashes is required, so a line starting with a #tag stays a paragraph.
const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const RULE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?(.*)$/;
const ITEM = /^( *)([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

const indentOf = (line: string) => line.length - line.trimStart().length;
const startsBlock = (line: string) => [FENCE, HEADING, RULE, QUOTE, ITEM].some((pattern) => pattern.test(line));

/** A description's blocks: paragraphs (single line breaks kept, as Todoist does), headings, lists, quotes, code, rules. */
export function parseMarkdown(text: string): Block[] {
  return parseBlocks(text.split(/\r?\n/).map((line) => line.replace(/^\t+/, (tabs) => '    '.repeat(tabs.length))));
}

function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      for (i++; i < lines.length && !lines[i]!.trimStart().startsWith(fence[1]!); i++) body.push(lines[i]!);
      i++; // the closing fence, if any
      blocks.push({ type: 'code', text: body.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', level: heading[1]!.length, text: heading[2]! });
      i++;
      continue;
    }
    if (RULE.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }
    if (QUOTE.test(line)) {
      const inner: string[] = [];
      for (; i < lines.length && QUOTE.test(lines[i]!); i++) inner.push(QUOTE.exec(lines[i]!)![1]!);
      blocks.push({ type: 'quote', children: parseBlocks(inner) });
      continue;
    }
    if (ITEM.test(line)) {
      i = parseList(lines, i, blocks);
      continue;
    }
    const paragraph: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && (paragraph.length === 0 || !startsBlock(lines[i]!)); i++) {
      paragraph.push(lines[i]!.trim());
    }
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

/** Adds the list starting at `start` to `blocks`, and returns the line after it. */
function parseList(lines: string[], start: number, blocks: Block[]): number {
  const first = ITEM.exec(lines[start]!)!;
  const indent = first[1]!.length;
  const ordered = /\d/.test(first[2]!);
  const items: string[][] = [];
  let i = start;
  while (i < lines.length) {
    const line = lines[i]!;
    const item = ITEM.exec(line);
    if (item && item[1]!.length === indent) {
      if (/\d/.test(item[2]!) !== ordered) break; // a list of the other kind starts
      items.push([item[3]!]);
      i++;
      continue;
    }
    if (line.trim() && indentOf(line) > indent) {
      // Deeper lines belong to the item above: a nested list, or more of its text.
      items[items.length - 1]!.push(line.slice(indent + 1));
      i++;
      continue;
    }
    if (line.trim()) break;
    // A blank line stays in the list only when the list goes on after it.
    let next = i + 1;
    while (next < lines.length && !lines[next]!.trim()) next++;
    const after = lines[next];
    const sameList = after !== undefined && ITEM.exec(after)?.[1]!.length === indent;
    if (after === undefined || !(sameList || indentOf(after) > indent)) break;
    if (!sameList) items[items.length - 1]!.push('');
    i = next;
  }
  blocks.push({ type: 'list', ordered, start: ordered ? parseInt(first[2]!, 10) : 1, items: items.map(parseBlocks) });
  return i;
}

/** The first line of a description with any block marks (heading, list, quote) taken off, for a task row. */
export function previewLine(markdown: string): string {
  const line = markdown.split(/\r?\n/).find((l) => l.trim() && !FENCE.test(l) && !RULE.test(l)) ?? '';
  return line.replace(/^(?:\s*(?:#{1,6}[ \t]|>|[-*+][ \t]|\d{1,9}[.)][ \t]))*/, '').trim();
}

function inlineText(nodes: Inline[], urls: boolean): string {
  return nodes
    .map((node) => {
      if (node.type === 'text' || node.type === 'code') return node.text;
      const text = inlineText(node.children, urls);
      if (node.type !== 'link' || !urls || !isSafeHref(node.href)) return text;
      // The address stays readable (and clickable where the text is autolinked, as in Google Calendar).
      const address = node.href.replace(/^mailto:/i, '');
      return text === node.href || text === address ? text : `${text} (${node.href})`;
    })
    .join('');
}

/**
 * A task name as plain text, marks taken off. With `urls`, a link keeps its address after its text
 * ("docs (https://...)"), for places where the text is all there is, like a calendar event.
 */
export function plainText(markdown: string, urls = false): string {
  return inlineText(parseInline(markdown), urls);
}

/** A description as readable plain text: marks off, links with their address, lists with bullets or numbers. */
export function markdownToText(markdown: string): string {
  return blocksText(parseMarkdown(markdown)).join('\n\n');
}

function blocksText(blocks: Block[]): string[] {
  return blocks.map((block) => {
    switch (block.type) {
      case 'paragraph':
      case 'heading':
        return plainText(block.text, true);
      case 'code':
        return block.text;
      case 'quote':
        return blocksText(block.children)
          .join('\n\n')
          .split('\n')
          .map((line) => `│ ${line}`)
          .join('\n');
      case 'list':
        return block.items
          .map((item, i) => {
            const marker = block.ordered ? `${block.start + i}. ` : '• ';
            // The item's own lines (a nested list included) line up after the marker.
            const pad = ' '.repeat(marker.length);
            return marker + blocksText(item).join('\n').split('\n').join(`\n${pad}`);
          })
          .join('\n');
      case 'rule':
        return '──────────';
    }
  });
}

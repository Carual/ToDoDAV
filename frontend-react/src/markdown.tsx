import { Fragment, type ReactNode } from 'react';
import { isSafeHref, isWebHref, parseInline, parseMarkdown, type Block, type Inline } from '../../shared/markdown.ts';

export { hasMarkdown, plainText, previewLine } from '../../shared/markdown.ts';

// Markdown rendered as React elements, never as HTML: whatever another app wrote in a task can't inject markup.

function renderInline(nodes: Inline[]): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'code':
        return (
          <code key={i} className="md-code">
            {node.text}
          </code>
        );
      case 'strong':
        return <strong key={i}>{renderInline(node.children)}</strong>;
      case 'em':
        return <em key={i}>{renderInline(node.children)}</em>;
      case 'del':
        return <del key={i}>{renderInline(node.children)}</del>;
      case 'link':
        if (!isSafeHref(node.href)) return <Fragment key={i}>{renderInline(node.children)}</Fragment>;
        return (
          <a
            key={i}
            className="md-link"
            href={node.href}
            target={isWebHref(node.href) ? '_blank' : undefined}
            rel="noreferrer noopener"
            // The link opens on its own: it neither opens the task row it sits in nor turns the modal's text into
            // its editor (which a click focusing the text around it would do).
            onMouseDown={(event) => event.preventDefault()}
            onClick={(event) => event.stopPropagation()}
          >
            {renderInline(node.children)}
          </a>
        );
    }
  });
}

/** One line of inline Markdown (bold, italic, strikethrough, code, links), as in a task name. */
export function InlineMarkdown({ text }: { text: string }) {
  return <>{renderInline(parseInline(text))}</>;
}

const HEADINGS = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;

function renderBlocks(blocks: Block[]): ReactNode[] {
  return blocks.map((block, i) => {
    switch (block.type) {
      case 'paragraph':
        return (
          <p key={i}>
            <InlineMarkdown text={block.text} />
          </p>
        );
      case 'heading': {
        const Heading = HEADINGS[block.level - 1] ?? 'h6';
        return (
          <Heading key={i}>
            <InlineMarkdown text={block.text} />
          </Heading>
        );
      }
      case 'code':
        return (
          <pre key={i}>
            <code>{block.text}</code>
          </pre>
        );
      case 'quote':
        return <blockquote key={i}>{renderBlocks(block.children)}</blockquote>;
      case 'list': {
        const items = block.items.map((item, j) => <li key={j}>{renderBlocks(item)}</li>);
        return block.ordered ? (
          <ol key={i} start={block.start}>
            {items}
          </ol>
        ) : (
          <ul key={i}>{items}</ul>
        );
      }
      case 'rule':
        return <hr key={i} />;
    }
  });
}

/** A description: paragraphs (single line breaks kept, as Todoist does), headings, lists, quotes, code, rules. */
export function Markdown({ text }: { text: string }) {
  return <>{renderBlocks(parseMarkdown(text))}</>;
}

import type { ReactNode } from 'react';
import { Linking, Platform, StyleSheet, Text, View } from 'react-native';

import { isSafeHref, parseInline, parseMarkdown, type Block, type Inline } from '../../../shared/markdown.ts';
import { useColors, fs, type Colors } from '../theme.ts';

export { hasMarkdown, plainText, previewLine } from '../../../shared/markdown.ts';

// Markdown rendered as nested <Text> elements, never as HTML: whatever another app wrote in a task can't inject
// markup. Only http(s), mailto and obsidian links open (isSafeHref), each in its own app.

/**
 * On the web, Linking opens every link in a new tab, which for mailto: and obsidian: would only be a blank one left
 * behind once the app takes over: those open in place, and only web pages get a tab of their own.
 */
function openLink(href: string) {
  if (Platform.OS === 'web' && !/^https?:/i.test(href)) window.location.href = href;
  else void Linking.openURL(href).catch(() => {});
}

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, Menlo, Consolas, monospace' });

function renderInline(nodes: Inline[], colors: Colors): ReactNode[] {
  return nodes.map((node, i) => {
    switch (node.type) {
      case 'text':
        return node.text;
      case 'code':
        return (
          <Text key={i} style={{ fontFamily: MONO, backgroundColor: colors.codeBg }}>
            {node.text}
          </Text>
        );
      case 'strong':
        return (
          <Text key={i} style={styles.strong}>
            {renderInline(node.children, colors)}
          </Text>
        );
      case 'em':
        return (
          <Text key={i} style={styles.em}>
            {renderInline(node.children, colors)}
          </Text>
        );
      case 'del':
        return (
          <Text key={i} style={styles.del}>
            {renderInline(node.children, colors)}
          </Text>
        );
      case 'link':
        if (!isSafeHref(node.href)) return <Text key={i}>{renderInline(node.children, colors)}</Text>;
        return (
          <Text
            key={i}
            role="link"
            style={{ color: colors.link }}
            // The link opens on its own, without also opening the task row it sits in.
            onPress={(event) => {
              event.stopPropagation();
              openLink(node.href);
            }}
          >
            {renderInline(node.children, colors)}
          </Text>
        );
    }
  });
}

/** One line of inline Markdown (bold, italic, strikethrough, code, links), as in a task name. Goes inside a <Text>. */
export function InlineMarkdown({ text }: { text: string }) {
  const colors = useColors();
  return <>{renderInline(parseInline(text), colors)}</>;
}

const HEADING_SIZES = [20, 17, 15, 14, 14, 14];

function renderBlocks(blocks: Block[], colors: Colors, baseStyle: object): ReactNode[] {
  return blocks.map((block, i) => {
    const last = i === blocks.length - 1;
    switch (block.type) {
      case 'paragraph':
        // Single line breaks stay, as in Todoist: Text keeps them.
        return (
          <Text key={i} style={[baseStyle, !last && styles.gap]}>
            <InlineMarkdown text={block.text} />
          </Text>
        );
      case 'heading':
        return (
          <Text
            key={i}
            role="heading"
            style={[baseStyle, styles.heading, { fontSize: fs(HEADING_SIZES[block.level - 1] ?? 14) }, !last && styles.gap]}
          >
            <InlineMarkdown text={block.text} />
          </Text>
        );
      case 'code':
        return (
          <View key={i} style={[styles.pre, { backgroundColor: colors.codeBg }, !last && styles.gap]}>
            <Text style={[baseStyle, { fontFamily: MONO, fontSize: fs(13) }]}>{block.text}</Text>
          </View>
        );
      case 'quote':
        return (
          <View key={i} style={[styles.quote, { borderLeftColor: colors.border }, !last && styles.gap]}>
            {renderBlocks(block.children, colors, [baseStyle, { color: colors.textSecondary }])}
          </View>
        );
      case 'list':
        return (
          <View key={i} style={!last && styles.gap}>
            {block.items.map((item, j) => (
              <View key={j} style={styles.item}>
                <Text style={[baseStyle, styles.marker]}>{block.ordered ? `${block.start + j}.` : '•'}</Text>
                <View style={styles.itemBody}>{renderBlocks(item, colors, baseStyle)}</View>
              </View>
            ))}
          </View>
        );
      case 'rule':
        return <View key={i} style={[styles.rule, { borderTopColor: colors.border }]} />;
    }
  });
}

/** A description: paragraphs (single line breaks kept, as Todoist does), headings, lists, quotes, code, rules. */
export function Markdown({ text, style }: { text: string; style: object }) {
  const colors = useColors();
  return <View>{renderBlocks(parseMarkdown(text), colors, style)}</View>;
}

const styles = StyleSheet.create({
  strong: { fontWeight: '700' },
  em: { fontStyle: 'italic' },
  del: { textDecorationLine: 'line-through' },
  gap: { marginBottom: 8 },
  heading: { fontWeight: '700', marginTop: 4 },
  pre: { borderRadius: 4, paddingHorizontal: 10, paddingVertical: 8 },
  quote: { borderLeftWidth: 3, paddingLeft: 12 },
  item: { flexDirection: 'row', gap: 6 },
  marker: { minWidth: 14, textAlign: 'right' },
  itemBody: { flex: 1, minWidth: 0 },
  rule: { borderTopWidth: StyleSheet.hairlineWidth, marginVertical: 12 },
});

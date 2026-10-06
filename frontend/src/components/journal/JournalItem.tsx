import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Calendar } from '../../api/caldav.ts';
import type { Journal } from '../../api/journals.ts';
import { describeRepeat, formatTime } from '../../lib/format.ts';
import { InlineMarkdown, previewLine } from '../../lib/markdown.tsx';
import { useColors, fs, type Colors } from '../../theme.ts';
import { HashIcon, MapPinIcon, RepeatIcon, TagIcon } from '../controls/icons.tsx';

interface Props {
  journal: Journal;
  /** The journal it is in, shown only where entries of several journals mix (the "All" view). */
  project?: Calendar;
  /** Width of the time column: less on narrow screens. */
  timeWidth: number;
  onOpen: (journal: Journal) => void;
}

/** One entry or note: its time, title, first line of text, then labels and location. */
export function JournalItem({ journal, project, timeWidth, onOpen }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const { start, recurrence } = journal;
  const firstLine = previewLine(journal.description);
  // Entries without a title (common in jtx Board) are known by their first line.
  const title = journal.summary || firstLine;
  const repeat = recurrence && describeRepeat(recurrence, start);
  const cancelled = journal.status === 'CANCELLED';
  return (
    <Pressable
      onPress={() => onOpen(journal)}
      style={({ pressed, hovered }) => [styles.row, (pressed || hovered) && { backgroundColor: colors.bgSoft }]}
    >
      {/* The time sits where a task's checkbox would, in a fixed column so the titles line up. */}
      {start && <Text style={[styles.time, { width: timeWidth }]}>{start.time ? formatTime(start.time) : 'All day'}</Text>}
      <View style={styles.body}>
        <Text style={[styles.title, cancelled && styles.cancelled]}>
          {title ? <InlineMarkdown text={title} /> : <Text style={styles.muted}>Untitled</Text>}
          {journal.status === 'DRAFT' && <Text style={styles.badge}>{'  Draft  '}</Text>}
        </Text>
        {journal.summary && firstLine ? (
          <Text style={[styles.small, styles.muted]} numberOfLines={1}>
            <InlineMarkdown text={firstLine} />
          </Text>
        ) : null}
        {(repeat || journal.categories.length > 0) && (
          <View style={styles.meta}>
            {repeat && (
              <View style={styles.item}>
                <RepeatIcon color={colors.textTertiary} />
                <Text style={[styles.small, styles.muted]}>{repeat}</Text>
              </View>
            )}
            {journal.categories.map((label) => (
              <View key={label} style={styles.item}>
                <TagIcon color={colors.textTertiary} />
                <Text style={[styles.small, styles.muted]}>{label}</Text>
              </View>
            ))}
          </View>
        )}
        {journal.location && (
          <View style={[styles.item, styles.line]}>
            <MapPinIcon color={colors.textTertiary} size={12} />
            <Text style={[styles.small, styles.muted, styles.shrink]} numberOfLines={1}>
              {journal.location}
            </Text>
          </View>
        )}
      </View>
      {project && (
        <View style={styles.project} aria-label={`In ${project.name}`}>
          <Text style={[styles.small, styles.muted, styles.shrink]} numberOfLines={1}>
            {project.name}
          </Text>
          <HashIcon color={project.color ?? colors.textTertiary} size={12} />
        </View>
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    row: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
      paddingVertical: 8,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.divider,
    },
    time: { flexShrink: 0, fontSize: fs(12), lineHeight: fs(21), color: colors.textTertiary, fontVariant: ['tabular-nums'] },
    body: { flex: 1, minWidth: 0 },
    title: { fontSize: fs(14), lineHeight: fs(21), color: colors.text },
    cancelled: { textDecorationLine: 'line-through', color: colors.textTertiary },
    badge: { fontSize: fs(11), color: colors.textSecondary, backgroundColor: colors.bgSoft },
    small: { fontSize: fs(12), lineHeight: fs(18) },
    muted: { color: colors.textTertiary },
    shrink: { flexShrink: 1 },
    meta: { flexDirection: 'row', flexWrap: 'wrap', columnGap: 10, rowGap: 4, marginTop: 2 },
    item: { flexDirection: 'row', alignItems: 'center', gap: 3 },
    line: { marginTop: 2 },
    project: { alignSelf: 'flex-end', flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '35%' },
  });

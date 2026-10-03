import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { Priority } from '../../api/tasks.ts';
import { ALL_PRIORITIES, DEFAULT_SETTINGS, DUE_FILTER_NAMES, filtersActive, type DueFilter, type Filters } from '../../lib/viewSettings.ts';
import { useColors } from '../../theme.ts';
import { FilterIcon, FlagIcon, TagIcon } from '../controls/icons.tsx';
import { Select } from '../controls/Select.tsx';
import { Section, SettingRow, SmallDialog } from '../controls/SmallDialog.tsx';

interface Props {
  filters: Filters;
  /** Labels used in the current list. */
  labels: string[];
  /** Changes apply at once, so the list behind shows the result. */
  onChange: (filters: Filters) => void;
  onClose: () => void;
}

export function FilterModal({ filters, labels, onChange, onClose }: Props) {
  const colors = useColors();
  // A label chosen in another list stays selectable, so the filter can be seen and undone.
  const labelOptions = filters.label && !labels.includes(filters.label) ? [filters.label, ...labels] : labels;

  const update = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });

  function togglePriority(priority: Priority) {
    const next = filters.priorities.includes(priority)
      ? filters.priorities.filter((p) => p !== priority)
      : ALL_PRIORITIES.filter((p) => p === priority || filters.priorities.includes(p));
    update({ priorities: next });
  }

  return (
    <SmallDialog
      label="Filters"
      icon={<FilterIcon color={colors.textSecondary} size={16} />}
      onClose={onClose}
      footerAction={{
        label: 'Clear filters',
        disabled: !filtersActive(filters),
        onPress: () => onChange(DEFAULT_SETTINGS.filters),
      }}
    >
      <Section>
        <SettingRow label="Priority">
          <View role="group" aria-label="Priority" style={styles.toggles}>
            {ALL_PRIORITIES.map((p) => {
              const on = filters.priorities.includes(p);
              const color = colors[`p${p}`];
              // At least one priority stays on: an empty list would only look broken.
              const locked = on && filters.priorities.length === 1;
              return (
                <Pressable
                  key={p}
                  role="button"
                  aria-pressed={on}
                  aria-label={`Priority ${p}`}
                  disabled={locked}
                  onPress={() => togglePriority(p)}
                  style={[
                    styles.toggle,
                    on
                      ? { borderColor: color, backgroundColor: `${color}1a` }
                      : { borderColor: colors.border, backgroundColor: colors.bg },
                  ]}
                >
                  <FlagIcon color={on ? color : colors.textTertiary} size={14} />
                  <Text style={[styles.toggleText, { color: on ? color : colors.textTertiary }]}>P{p}</Text>
                </Pressable>
              );
            })}
          </View>
        </SettingRow>
        <SettingRow label="Due date">
          <Select
            aria-label="Due date"
            value={filters.due}
            onChange={(due) => update({ due })}
            options={(Object.entries(DUE_FILTER_NAMES) as [DueFilter, string][]).map(([value, label]) => ({ value, label }))}
          />
        </SettingRow>
        <SettingRow label="Label">
          <Select
            aria-label="Label"
            value={filters.label ?? ''}
            onChange={(label) => update({ label: label || undefined })}
            options={[
              { value: '', label: 'Any label' },
              ...labelOptions.map((label) => ({ value: label, label, icon: <TagIcon color={colors.textSecondary} /> })),
            ]}
          />
        </SettingRow>
      </Section>
    </SmallDialog>
  );
}

const styles = StyleSheet.create({
  toggles: { flexDirection: 'row', gap: 4 },
  // Pressed: tinted in the priority's color, like the checkbox. Off: plain and gray.
  toggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    paddingVertical: 3,
    paddingLeft: 5,
    paddingRight: 8,
    borderWidth: 1,
    borderRadius: 5,
  },
  toggleText: { fontSize: 12 },
});

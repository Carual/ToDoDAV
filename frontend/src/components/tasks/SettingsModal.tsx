import { StyleSheet, View } from 'react-native';

import { DEFAULT_SETTINGS, ROW_FIELD_NAMES, type ListLayout, type ViewSettings } from '../../lib/viewSettings.ts';
import { useColors, fs } from '../../theme.ts';
import { ChevronDownIcon, ChevronUpIcon, GearIcon } from '../controls/icons.tsx';
import { Select } from '../controls/Select.tsx';
import { Note, Section, SettingRow, SmallDialog } from '../controls/SmallDialog.tsx';
import { Button, IconButton, SwitchRow } from '../controls/ui.tsx';

interface Props {
  settings: ViewSettings;
  /** Changes apply at once, so the list behind shows the result. */
  onChange: (settings: ViewSettings) => void;
  /** Opens the import and export dialog in place of this one; absent when there is no list to work on. */
  onImportExport?: () => void;
  onClose: () => void;
}

export function SettingsModal({ settings, onChange, onImportExport, onClose }: Props) {
  const colors = useColors();
  const { layout, fields } = settings;

  const setLayout = (patch: Partial<ListLayout>) => onChange({ ...settings, layout: { ...layout, ...patch } });

  function setVisible(index: number, visible: boolean) {
    onChange({ ...settings, fields: fields.map((f, i) => (i === index ? { ...f, visible } : f)) });
  }

  function move(index: number, by: -1 | 1) {
    const next = [...fields];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved!);
    onChange({ ...settings, fields: next });
  }

  const label = { fontSize: fs(13), color: colors.text };

  return (
    <SmallDialog
      label="Settings"
      icon={<GearIcon color={colors.textSecondary} size={16} />}
      onClose={onClose}
      // Filters have their own dialog and their own Clear.
      footerAction={{ label: 'Reset to defaults', onPress: () => onChange({ ...DEFAULT_SETTINGS, filters: settings.filters }) }}
    >
      <Section title="List">
        <SwitchRow
          label="Show sub-tasks under their parent"
          value={layout.nestSubtasks}
          onChange={(nestSubtasks) => setLayout({ nestSubtasks })}
          labelStyle={label}
        />
        <SettingRow label="Tasks without a due date">
          <Select
            aria-label="Tasks without a due date"
            value={layout.undatedFirst ? 'first' : 'last'}
            onChange={(order) => setLayout({ undatedFirst: order === 'first' })}
            options={[
              { value: 'last', label: 'At the end' },
              { value: 'first', label: 'At the top' },
            ]}
          />
        </SettingRow>
      </Section>

      <Section title="Task page">
        <SwitchRow
          label="Show a map of the location"
          value={settings.showMap}
          onChange={(showMap) => onChange({ ...settings, showMap })}
          labelStyle={label}
        />
        <Note>The map comes from Google, so the location is sent to Google to show it.</Note>
      </Section>

      <Section title="Task details">
        <Note>What each task shows under its name, from top to bottom.</Note>
        <View>
          {fields.map(({ field, visible }, index) => {
            const name = ROW_FIELD_NAMES[field];
            return (
              <View
                key={field}
                style={[styles.field, index < fields.length - 1 && { borderBottomColor: colors.divider, borderBottomWidth: 1 }]}
              >
                <View style={styles.grow}>
                  <SwitchRow
                    label={name}
                    value={visible}
                    onChange={(on) => setVisible(index, on)}
                    labelStyle={[label, !visible && { color: colors.textTertiary }]}
                  />
                </View>
                <IconButton
                  label={`Move ${name.toLowerCase()} up`}
                  disabled={index === 0}
                  onPress={() => move(index, -1)}
                  style={index === 0 && styles.dimmed}
                >
                  <ChevronUpIcon color={colors.textSecondary} />
                </IconButton>
                <IconButton
                  label={`Move ${name.toLowerCase()} down`}
                  disabled={index === fields.length - 1}
                  onPress={() => move(index, 1)}
                  style={index === fields.length - 1 && styles.dimmed}
                >
                  <ChevronDownIcon color={colors.textSecondary} />
                </IconButton>
              </View>
            );
          })}
        </View>
      </Section>

      {onImportExport && (
        <Section title="Import and export">
          <Note>Move tasks in or out as an .ics file or a Todoist CSV, or bring in a whole Todoist account.</Note>
          <Button label="Import or export" onPress={onImportExport} style={styles.button} />
        </Section>
      )}
    </SmallDialog>
  );
}

const styles = StyleSheet.create({
  field: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingVertical: 4 },
  grow: { flex: 1 },
  dimmed: { opacity: 0.3 },
  button: { alignSelf: 'flex-start' },
});

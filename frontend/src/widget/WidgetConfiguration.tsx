import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WidgetConfigurationScreenProps } from 'react-native-android-widget';

import { CalDavClient, type Calendar } from '../api/caldav.ts';
import { HashIcon, LayersIcon } from '../components/controls/icons.tsx';
import { Button } from '../components/controls/ui.tsx';
import { readLogin } from '../state/loginStore.ts';
import { fs, useColors, type Colors } from '../theme.ts';
import { ALL_LISTS, loadSnapshot, readWidgetList, saveWidgetList } from './data.ts';
import { widgetFor } from './TaskListWidget.tsx';

type Lists = { state: 'loading' } | { state: 'loggedOut' } | { state: 'error'; message: string } | { state: 'ok'; calendars: Calendar[] };

/**
 * Which list the widget shows, asked when it is added to the home screen (and from the launcher's "Settings" on the
 * widget later), as Todoist asks for a project. A screen of its own, outside the app's navigation and session.
 */
export function WidgetConfiguration({ widgetInfo, renderWidget, setResult }: WidgetConfigurationScreenProps) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const id = widgetInfo.widgetId;
  const [lists, setLists] = useState<Lists>({ state: 'loading' });
  const [saving, setSaving] = useState(false);
  const current = readWidgetList(id);

  useEffect(() => {
    (async () => {
      const login = await readLogin();
      if (!login) return setLists({ state: 'loggedOut' });
      try {
        const { tasks } = await new CalDavClient(login, login.transport).discoverCalendars();
        setLists({ state: 'ok', calendars: tasks });
      } catch (error) {
        setLists({ state: 'error', message: error instanceof Error ? error.message : 'Could not reach the server.' });
      }
    })();
  }, []);

  async function pick(list: string) {
    setSaving(true);
    saveWidgetList(id, list);
    try {
      renderWidget(widgetFor(await loadSnapshot(id)));
    } catch {
      // The choice is saved: the widget draws itself on its next update. The screen must close either way.
    } finally {
      setResult('ok');
    }
  }

  const choices =
    lists.state === 'ok'
      ? [
          ...(lists.calendars.length > 1
            ? [{ value: ALL_LISTS, name: 'All lists', icon: <LayersIcon color={colors.textSecondary} size={18} /> }]
            : []),
          ...lists.calendars.map((c) => ({ value: c.href, name: c.name, icon: <HashIcon color={c.color ?? colors.textSecondary} size={18} /> })),
        ]
      : [];

  return (
    <View style={styles.page}>
      <Text style={styles.title} role="heading">
        Widget list
      </Text>
      <Text style={styles.text}>Which tasks the widget shows. Hold the widget later to change it.</Text>

      {lists.state === 'loading' || saving ? (
        <ActivityIndicator color={colors.accent} style={styles.spinner} />
      ) : lists.state === 'loggedOut' ? (
        <Text style={styles.text}>Log in to ToDoDAV first. The widget will ask you to, until you do.</Text>
      ) : lists.state === 'error' ? (
        <Text style={styles.text}>{lists.message} The widget shows every list until you pick one.</Text>
      ) : (
        <ScrollView style={styles.list}>
          {choices.map((choice) => {
            const chosen = (current ?? ALL_LISTS) === choice.value;
            return (
              <Pressable
                key={choice.value}
                role="radio"
                aria-checked={chosen}
                onPress={() => void pick(choice.value)}
                style={({ pressed }) => [styles.choice, (pressed || chosen) && { backgroundColor: colors.bgHover }]}
              >
                {choice.icon}
                <Text style={styles.choiceText}>{choice.name}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      <View style={styles.footer}>
        {lists.state === 'ok' ? (
          <Button label="Cancel" onPress={() => setResult('cancel')} />
        ) : (
          <Button label="OK" variant="primary" onPress={() => void pick(current ?? ALL_LISTS)} disabled={saving} />
        )}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    page: { flex: 1, backgroundColor: colors.bg, paddingHorizontal: 20, paddingTop: 48, paddingBottom: 24, gap: 8 },
    title: { fontSize: fs(22), fontWeight: '700', color: colors.text },
    text: { fontSize: fs(14), lineHeight: fs(20), color: colors.textSecondary },
    spinner: { marginTop: 32 },
    list: { flexGrow: 0, marginTop: 8 },
    choice: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 12, borderRadius: 8 },
    choiceText: { flex: 1, fontSize: fs(16), color: colors.text },
    footer: { flexDirection: 'row', justifyContent: 'flex-end', marginTop: 'auto', paddingTop: 12 },
  });

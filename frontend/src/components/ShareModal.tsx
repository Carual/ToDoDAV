import * as Clipboard from 'expo-clipboard';
import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { Calendar, CalDavClient } from '../api/caldav.ts';
import type { Priority } from '../api/tasks.ts';
import { ALL_PRIORITIES, readSetting, saveSetting } from '../lib/viewSettings.ts';
import { useColors, fs, type Colors } from '../theme.ts';
import { FlagIcon, ShareIcon } from './controls/icons.tsx';
import { Select } from './controls/Select.tsx';
import { Note, Section, SettingRow, SmallDialog } from './controls/SmallDialog.tsx';
import { Button, SwitchRow } from './controls/ui.tsx';

interface Props {
  client: CalDavClient;
  calendar: Calendar;
  token: string;
  /** The page sharing it: each starts from what it shows, and remembers its own choices. */
  section?: 'tasks' | 'journal';
  onClose: () => void;
}

/** What the feed's query string asks for (backend/feed/index.ts); the defaults add nothing to the URL. */
interface FeedOptions {
  /** tasks=1: tasks become events. With journals off too, the calendar is sent as stored (and Google ignores its tasks). */
  tasks: boolean;
  /** journals=1: journal entries with a date (VJOURNAL, as jtx Board writes them) become events. */
  journals: boolean;
  /** completed, subtasks and priorities only shape tasks. */
  completed: boolean;
  subtasks: boolean;
  priorities: Priority[];
  html: boolean;
  /** With html: app links (obsidian://) as text and address, since Google Calendar drops them. */
  appLinksAsText: boolean;
  /** Minutes a timed task lasts; 0 is an instant. */
  duration: number;
}

// Each page shares what it shows as events by default (Google Calendar shows nothing of tasks or journal
// entries otherwise), and keeps its own choices, so sharing a journal doesn't change the next task list's link.
const OPTIONS_KEYS = { tasks: 'tododav.feedOptions', journal: 'tododav.journalFeedOptions' } as const;

const TASK_DEFAULTS: FeedOptions = { tasks: true, journals: false, completed: true, subtasks: true, priorities: ALL_PRIORITIES, html: false, appLinksAsText: false, duration: 0 };
const DEFAULTS = { tasks: TASK_DEFAULTS, journal: { ...TASK_DEFAULTS, tasks: false, journals: true } } as const;

const DURATIONS = [
  { value: '0', label: 'No duration' },
  { value: '15', label: '15 minutes' },
  { value: '30', label: '30 minutes' },
  { value: '60', label: '1 hour' },
  { value: '120', label: '2 hours' },
];

/** The options last used, so the next list's link comes out the same; anything unreadable falls back to the default. */
function loadOptions(section: 'tasks' | 'journal'): FeedOptions {
  const DEFAULT_OPTIONS = DEFAULTS[section];
  let saved: Partial<Record<keyof FeedOptions, unknown>> = {};
  try {
    saved = JSON.parse(readSetting(OPTIONS_KEYS[section]) ?? '{}') ?? {};
  } catch {
    // Keep the defaults.
  }
  const bool = (value: unknown, fallback: boolean) => (typeof value === 'boolean' ? value : fallback);
  const priorities = Array.isArray(saved.priorities) ? ALL_PRIORITIES.filter((p) => (saved.priorities as unknown[]).includes(p)) : [];
  return {
    tasks: bool(saved.tasks, DEFAULT_OPTIONS.tasks),
    journals: bool(saved.journals, DEFAULT_OPTIONS.journals),
    completed: bool(saved.completed, DEFAULT_OPTIONS.completed),
    subtasks: bool(saved.subtasks, DEFAULT_OPTIONS.subtasks),
    priorities: priorities.length > 0 ? priorities : DEFAULT_OPTIONS.priorities,
    html: bool(saved.html, DEFAULT_OPTIONS.html),
    appLinksAsText: bool(saved.appLinksAsText, DEFAULT_OPTIONS.appLinksAsText),
    duration: DURATIONS.some((d) => Number(d.value) === saved.duration) ? (saved.duration as number) : DEFAULT_OPTIONS.duration,
  };
}

/** The list's subscription URL, for Google Calendar's "Other calendars → From URL". */
function feedUrl(client: CalDavClient, calendar: Calendar, token: string, options: FeedOptions): string {
  // Feeds only come with a ToDoDAV backend: the page's own origin on the web, the server typed at login on a phone.
  const { transport } = client;
  const origin = transport.kind === 'proxy' && transport.origin ? transport.origin : Platform.OS === 'web' ? window.location.origin : '';
  const url = `${origin}/feed/${token}/${client.relativePath(calendar.href)}`;
  if (!options.tasks && !options.journals) return url;
  // Built by hand so the priority list keeps its plain commas instead of %2C.
  const params: string[] = [];
  if (options.tasks) {
    params.push('tasks=1');
    if (!options.completed) params.push('completed=0');
    if (!options.subtasks) params.push('subtasks=0');
    if (options.priorities.length < ALL_PRIORITIES.length) params.push(`priority=${options.priorities.join(',')}`);
  }
  if (options.journals) params.push('journals=1');
  if (options.html) params.push('format=html');
  // Remembered while the HTML is off, but only part of the link with it.
  if (options.html && options.appLinksAsText) params.push('applinks=text');
  if (options.duration > 0) params.push(`duration=${options.duration}`);
  return `${url}?${params.join('&')}`;
}

/** The feed link of the list on screen, with the switches that build its query string. */
export function ShareModal({ client, calendar, token, section = 'tasks', onClose }: Props) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [options, setOptions] = useState(() => loadOptions(section));
  const url = feedUrl(client, calendar, token, options);

  function update(patch: Partial<FeedOptions>) {
    const next = { ...options, ...patch };
    setOptions(next);
    saveSetting(OPTIONS_KEYS[section], JSON.stringify(next));
  }

  function togglePriority(priority: Priority) {
    const priorities = options.priorities.includes(priority)
      ? options.priorities.filter((p) => p !== priority)
      : ALL_PRIORITIES.filter((p) => p === priority || options.priorities.includes(p));
    update({ priorities });
  }

  const label = { fontSize: fs(13), color: colors.text };

  return (
    <SmallDialog label="Add to Google Calendar" icon={<ShareIcon color={colors.textSecondary} size={16} />} onClose={onClose}>
      <Text style={styles.intro}>
        To see <Text style={styles.strong}>{calendar.name}</Text> in Google Calendar, open{' '}
        <Text style={styles.strong}>Other calendars → + → From URL</Text> there and paste the link.
      </Text>

      <Section>
        <SwitchRow label="Show tasks as events" value={options.tasks} onChange={(tasks) => update({ tasks })} labelStyle={label} />
        <Note>
          {options.tasks
            ? 'Each task with a due date becomes an event on that date. Events in the list stay as they are.'
            : options.journals
              ? 'Tasks are left out. Events in the list stay as they are.'
              : 'The calendar exactly as stored. Google Calendar ignores tasks, so only its events show up.'}
        </Note>

        {options.tasks && (
          <View style={styles.nested}>
            <SwitchRow
              label="Completed tasks"
              value={options.completed}
              onChange={(completed) => update({ completed })}
              labelStyle={label}
            />
            <SwitchRow label="Sub-tasks" value={options.subtasks} onChange={(subtasks) => update({ subtasks })} labelStyle={label} />
            <SettingRow label="Priority">
              <View role="group" aria-label="Priority" style={styles.toggles}>
                {ALL_PRIORITIES.map((p) => {
                  const on = options.priorities.includes(p);
                  const color = colors[`p${p}`];
                  return (
                    <Pressable
                      key={p}
                      role="button"
                      aria-pressed={on}
                      aria-label={`Priority ${p}`}
                      // At least one priority stays on: a feed of nothing would only look broken.
                      disabled={on && options.priorities.length === 1}
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
          </View>
        )}

        <SwitchRow
          label="Show journal entries as events"
          value={options.journals}
          onChange={(journals) => update({ journals })}
          labelStyle={label}
        />
        <Note>Journal entries with a date (jtx Board and similar) become events on that date. Undated notes are left out.</Note>

        {(options.tasks || options.journals) && (
          <>
            <SwitchRow label="Formatted descriptions" value={options.html} onChange={(html) => update({ html })} labelStyle={label} />
            <Note>Bold, italic, links and lists. Google Calendar only: other apps show the HTML tags.</Note>
            {options.html && (
              <View style={styles.nested}>
                <SwitchRow
                  label="Show app link addresses"
                  value={options.appLinksAsText}
                  onChange={(appLinksAsText) => update({ appLinksAsText })}
                  labelStyle={label}
                />
                <Note>
                  Google Calendar removes links to apps such as Obsidian. This writes their address as text, so it can be
                  copied.
                </Note>
              </View>
            )}
            <SettingRow label="Timed items last">
              <Select
                aria-label="Timed items last"
                value={String(options.duration)}
                onChange={(duration) => update({ duration: Number(duration) })}
                options={DURATIONS}
              />
            </SettingRow>
          </>
        )}
      </Section>

      <FeedLinkField url={url} />

      <Note>
        Anyone with the link can see this list, so keep it private. The calendar is read-only, and Google only refreshes
        it every few hours. Changing the options makes a new link: subscribe to it again.
      </Note>
    </SmallDialog>
  );
}

function FeedLinkField({ url }: { url: string }) {
  const colors = useColors();
  const styles = makeStyles(colors);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<TextInput>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  // A copied link that has since changed must not still say "Copied".
  useEffect(() => setCopied(false), [url]);

  async function copy() {
    // On the web, copying can fail (the Clipboard API only exists on HTTPS/localhost): select the text so Ctrl+C
    // works instead.
    const done = await Clipboard.setStringAsync(url).catch(() => false);
    if (!done) {
      inputRef.current?.focus();
      return;
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 2000);
  }

  return (
    <Section title="Link">
      <View style={styles.linkRow}>
        <TextInput
          ref={inputRef}
          value={url}
          editable={false}
          selectTextOnFocus
          aria-label="Feed link"
          style={styles.linkInput}
          numberOfLines={1}
        />
        <Button label={copied ? 'Copied' : 'Copy'} variant="primary" onPress={() => void copy()} />
      </View>
    </Section>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    intro: { fontSize: fs(13), lineHeight: fs(20), color: colors.textSecondary },
    strong: { fontWeight: '700', color: colors.text },
    // Options that only apply while the switch above them is on.
    nested: { gap: 10, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.divider },
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
    toggleText: { fontSize: fs(12) },
    linkRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    linkInput: {
      flex: 1,
      minWidth: 0,
      minHeight: 34,
      paddingHorizontal: 10,
      borderWidth: 1,
      borderRadius: 6,
      borderColor: colors.border,
      backgroundColor: colors.bgSoft,
      color: colors.text,
      fontSize: fs(13),
    },
  });

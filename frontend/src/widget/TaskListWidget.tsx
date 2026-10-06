// The React Compiler (on for the app) would give these components hooks, which the library can't run: it calls
// them as plain functions to build the widget's tree.
'use no memo';

import { FlexWidget, ListWidget, SvgWidget, TextWidget, type ColorProp, type WidgetRepresentation } from 'react-native-android-widget';

import { describeDue } from '../lib/format.ts';
import { palettes, type Colors } from '../theme.ts';
import type { WidgetRow, WidgetSnapshot } from './data.ts';

// The home-screen widget, drawn with react-native-android-widget's primitives (native RemoteViews, not React Native
// views): Todoist's list widget, with the list's name, + and refresh at the top and the open tasks under it. A tick
// completes a task in the background; a tap anywhere else on a row opens it in the app.

export const WIDGET_NAME = 'TaskList';

/** Click actions the task handler acts on (OPEN_URI is handled by the launcher itself). */
export const COMPLETE = 'COMPLETE';
export const REFRESH = 'REFRESH';

export const taskLink = (uid: string) => `tododav://tasks/${encodeURIComponent(uid)}`;
const addLink = (calendarHref?: string) => `tododav://tasks?add=${encodeURIComponent(calendarHref ?? '')}`;
const LIST_LINK = 'tododav://tasks';

/** Both looks: the launcher picks by the system's dark mode. */
export function widgetFor(snapshot: WidgetSnapshot): WidgetRepresentation {
  return {
    light: <TaskListWidget snapshot={snapshot} colors={palettes.light} />,
    dark: <TaskListWidget snapshot={snapshot} colors={palettes.dark} />,
  };
}

/**
 * The widget takes #RRGGBB or rgba(). The app's colors are #RRGGBB, but a list's color from the server can be
 * #RRGGBBAA, which Android would read as #AARRGGBB: its alpha is dropped.
 */
const hex = (color: string) => color.slice(0, 7) as ColorProp;
function withAlpha(color: string, alpha: number): ColorProp {
  const n = Number.parseInt(color.slice(1, 7), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const priorityColor = (colors: Colors, priority: WidgetRow['priority']) =>
  ({ 1: colors.p1, 2: colors.p2, 3: colors.p3, 4: colors.p4 })[priority];

const toneColor = (colors: Colors, tone: ReturnType<typeof describeDue>['tone']) =>
  ({
    overdue: colors.dueOverdue,
    today: colors.dueToday,
    tomorrow: colors.dueTomorrow,
    week: colors.dueWeek,
    later: colors.dueLater,
  })[tone];

const svg = (body: string, color: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;
const CHECK = '<path d="M5 12.5l4.5 4.5L19 7.5"/>';
const PLUS = '<path d="M12 5v14M5 12h14"/>';
const REFRESH_ICON = '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/>';

function TaskListWidget({ snapshot, colors }: { snapshot: WidgetSnapshot; colors: Colors }) {
  const loggedIn = snapshot.state !== 'loggedOut';
  return (
    <FlexWidget
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'column',
        backgroundColor: hex(colors.bg),
        borderRadius: 20,
      }}
    >
      <FlexWidget
        style={{
          width: 'match_parent',
          flexDirection: 'row',
          alignItems: 'center',
          paddingLeft: 16,
          paddingRight: 8,
          paddingTop: 10,
          paddingBottom: 6,
        }}
      >
        <FlexWidget
          clickAction="OPEN_URI"
          clickActionData={{ uri: LIST_LINK }}
          accessibilityLabel={`Open ${snapshot.title} in ToDoDAV`}
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
        >
          <TextWidget
            text={snapshot.title}
            maxLines={1}
            truncate="END"
            style={{ fontSize: 17, fontWeight: 'bold', color: hex(colors.text) }}
          />
          {snapshot.state === 'ok' && snapshot.rows.length > 0 && (
            <TextWidget
              text={`  ${snapshot.rows.length}`}
              style={{ fontSize: 14, color: hex(colors.textTertiary) }}
            />
          )}
        </FlexWidget>
        {loggedIn && (
          <FlexWidget
            clickAction={REFRESH}
            accessibilityLabel="Refresh"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <SvgWidget
              svg={svg(REFRESH_ICON, snapshot.loading ? colors.border : colors.textTertiary)}
              style={{ width: 20, height: 20 }}
            />
          </FlexWidget>
        )}
        {snapshot.state === 'ok' && (
          <FlexWidget
            clickAction="OPEN_URI"
            clickActionData={{ uri: addLink(snapshot.calendarHref) }}
            accessibilityLabel="Add task"
            style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
          >
            <FlexWidget
              style={{
                width: 30,
                height: 30,
                borderRadius: 15,
                backgroundColor: hex(colors.accent),
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SvgWidget svg={svg(PLUS, '#ffffff')} style={{ width: 18, height: 18 }} />
            </FlexWidget>
          </FlexWidget>
        )}
      </FlexWidget>

      {snapshot.problem && (
        <TextWidget
          text={`${snapshot.problem}. Showing the last tasks read.`}
          maxLines={1}
          truncate="END"
          style={{ fontSize: 12, color: hex(colors.dueTomorrow), marginHorizontal: 16, marginBottom: 4 }}
        />
      )}

      <Body snapshot={snapshot} colors={colors} />
    </FlexWidget>
  );
}

function Body({ snapshot, colors }: { snapshot: WidgetSnapshot; colors: Colors }) {
  if (snapshot.state === 'loggedOut') {
    return <Message title="Not logged in" text="Tap to log in to ToDoDAV." colors={colors} />;
  }
  if (snapshot.state === 'noLists') {
    return <Message title="No task lists" text="Tap to create one in ToDoDAV." colors={colors} />;
  }
  if (snapshot.rows.length === 0) {
    return (
      <Message
        title={snapshot.loading ? 'Loading…' : 'All clear'}
        text={snapshot.loading ? '' : 'No open tasks. Enjoy your day.'}
        colors={colors}
      />
    );
  }
  const now = new Date();
  return (
    <ListWidget style={{ width: 'match_parent', height: 'match_parent' }}>
      {snapshot.rows.map((row) => (
        <Row key={row.href} row={row} colors={colors} now={now} />
      ))}
    </ListWidget>
  );
}

function Message({ title, text, colors }: { title: string; text: string; colors: Colors }) {
  return (
    <FlexWidget
      clickAction="OPEN_APP"
      style={{
        width: 'match_parent',
        height: 'match_parent',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <TextWidget text={title} style={{ fontSize: 16, fontWeight: 'bold', color: hex(colors.text), textAlign: 'center' }} />
      {text !== '' && (
        <TextWidget text={text} style={{ fontSize: 13, color: hex(colors.textTertiary), textAlign: 'center', marginTop: 4 }} />
      )}
    </FlexWidget>
  );
}

function Row({ row, colors, now }: { row: WidgetRow; colors: Colors; now: Date }) {
  const color = priorityColor(colors, row.priority);
  const strong = row.priority !== 4;
  const due = row.due && describeDue(row.due, now);
  const dueText = due ? `${due.label}${row.recurring ? ' ↻' : ''}` : '';
  const labels = row.labels.map((l) => `# ${l}`).join('  ');
  return (
    <FlexWidget
      clickAction="OPEN_URI"
      clickActionData={{ uri: taskLink(row.uid) }}
      accessibilityLabel={`Open ${row.summary}`}
      style={{
        width: 'match_parent',
        flexDirection: 'row',
        alignItems: 'flex-start',
        paddingLeft: 6,
        paddingRight: 16,
        paddingVertical: 4,
        borderBottomWidth: 1,
        borderBottomColor: hex(colors.divider),
      }}
    >
      {/* The tick's own area, bigger than the circle, so it is easy to hit without opening the task. */}
      <FlexWidget
        clickAction={row.done ? undefined : COMPLETE}
        clickActionData={{ href: row.href, calendarHref: row.calendarHref, recurring: row.recurring }}
        accessibilityLabel={`Complete ${row.summary}`}
        style={{ paddingLeft: 10, paddingRight: 10, paddingTop: 10, paddingBottom: 10 }}
      >
        <FlexWidget
          style={{
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: strong ? 2 : 1,
            borderColor: hex(color),
            backgroundColor: row.done ? hex(color) : strong ? withAlpha(color, 0.1) : withAlpha(colors.bg, 0),
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {row.done && <SvgWidget svg={svg(CHECK, '#ffffff')} style={{ width: 13, height: 13 }} />}
        </FlexWidget>
      </FlexWidget>

      <FlexWidget style={{ flex: 1, flexDirection: 'column', paddingVertical: 8 }}>
        <TextWidget
          text={row.summary}
          maxLines={2}
          truncate="END"
          style={{ fontSize: 15, color: hex(row.done ? colors.textTertiary : colors.text) }}
        />
        {(dueText !== '' || labels !== '' || row.list) && (
          <FlexWidget style={{ width: 'match_parent', flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
            {dueText !== '' && due && (
              <TextWidget text={dueText} maxLines={1} style={{ fontSize: 12, color: hex(toneColor(colors, due.tone)), marginRight: 10 }} />
            )}
            {labels !== '' && (
              <TextWidget text={labels} maxLines={1} truncate="END" style={{ fontSize: 12, color: hex(colors.textTertiary) }} />
            )}
            {row.list && (
              <FlexWidget style={{ flex: 1, flexDirection: 'row', justifyContent: 'flex-end' }}>
                <TextWidget text={row.list.name} maxLines={1} truncate="END" style={{ fontSize: 12, color: hex(colors.textTertiary) }} />
                <TextWidget text=" #" style={{ fontSize: 12, color: hex(row.list.color ?? colors.textTertiary) }} />
              </FlexWidget>
            )}
          </FlexWidget>
        )}
      </FlexWidget>
    </FlexWidget>
  );
}

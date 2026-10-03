import type { ReactNode } from 'react';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';

// The icons of frontend-react's icons.tsx, drawn with react-native-svg. `color` fills in for CSS's currentColor.

export interface IconProps {
  color: string;
  /** Width and height; each icon has its own default, as in frontend-react. */
  size?: number;
}

function icon(viewBox: string, defaultSize: number, draw: (color: string) => ReactNode) {
  return function Icon({ color, size = defaultSize }: IconProps) {
    return (
      <Svg width={size} height={size} viewBox={viewBox} fill="none" color={color} aria-hidden>
        {draw(color)}
      </Svg>
    );
  };
}

const c = 'currentColor';

export const CheckIcon = icon('0 0 12 12', 12, () => (
  <Path d="M2.5 6.2 4.9 8.6 9.5 3.6" stroke={c} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
));

export const PencilIcon = icon('0 0 24 24', 24, () => (
  <>
    <Path
      d="M9.585 18.65 5.5 19.5l.85-4.085L16.025 5.74a1.5 1.5 0 0 1 2.121 0l1.114 1.114a1.5 1.5 0 0 1 0 2.121L9.585 18.65Z"
      stroke={c}
      strokeLinejoin="round"
    />
    <Path d="m14.5 7.25 2.25 2.25" stroke={c} />
  </>
));

export const CalendarIcon = icon('0 0 12 12', 12, () => (
  <>
    <Rect x={1.5} y={2} width={9} height={8.5} rx={1.5} stroke={c} />
    <Path d="M1.5 4.75h9M4 1v2M8 1v2" stroke={c} strokeLinecap="round" />
  </>
));

/** Two arrows chasing each other round: a repeating task. */
export const RepeatIcon = icon('0 0 12 12', 12, () => (
  <Path
    d="M1.75 5.5A3.25 3.25 0 0 1 5 2.25h4.5M8 .75l1.5 1.5L8 3.75M10.25 6.5A3.25 3.25 0 0 1 7 9.75H2.5M4 11.25l-1.5-1.5L4 8.25"
    stroke={c}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const FlagIcon = icon('0 0 16 16', 16, () => (
  <Path d="M3.5 14V2.5h8l-1.5 3 1.5 3h-8" stroke={c} strokeLinejoin="round" fill={c} fillOpacity={0.15} />
));

export const TagIcon = icon('0 0 12 12', 12, () => (
  <>
    <Path d="M1.5 1.5h4.2l4.8 4.8-4.2 4.2-4.8-4.8V1.5Z" stroke={c} strokeLinejoin="round" />
    <Circle cx={4} cy={4} r={0.8} fill={c} />
  </>
));

/** Two branches off one line: sub-tasks. */
export const SubtaskIcon = icon('0 0 12 12', 12, () => (
  <Path d="M3 1.5v6A1.5 1.5 0 0 0 4.5 9H10M3 4.5h7" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
));

export const HashIcon = icon('0 0 16 16', 16, () => (
  <Path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10.5h11" stroke={c} strokeLinecap="round" />
));

/** Stacked layers: every list at once (the "All" view). */
export const LayersIcon = icon('0 0 16 16', 16, () => (
  <>
    <Path d="M8 2.5 14 5.5 8 8.5 2 5.5 8 2.5Z" stroke={c} strokeLinejoin="round" />
    <Path d="m2 8.25 6 3 6-3M2 11l6 3 6-3" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const PlusIcon = icon('0 0 13 13', 13, () => (
  <Path d="M6.5 1.5v10M1.5 6.5h10" stroke={c} strokeWidth={1.25} strokeLinecap="round" />
));

export const CloseIcon = icon('0 0 24 24', 24, () => <Path d="m6.5 6.5 11 11m0-11-11 11" stroke={c} strokeLinecap="round" />);

/** Arrow leaving a box: share / publish. */
export const ShareIcon = icon('0 0 24 24', 24, () => (
  <>
    <Path d="M12 4.5v10M8.5 8 12 4.5 15.5 8" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M8 11H6.5v8.5h11V11H16" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

export const MapPinIcon = icon('0 0 24 24', 24, () => (
  <>
    <Path d="M12 20.5s-6-5.6-6-10.5a6 6 0 0 1 12 0c0 4.9-6 10.5-6 10.5Z" stroke={c} strokeLinejoin="round" />
    <Circle cx={12} cy={10} r={2} stroke={c} />
  </>
));

/** Funnel: filters. */
export const FilterIcon = icon('0 0 24 24', 24, () => (
  <Path d="M5 6.5h14l-5.5 6.25v4.5l-3 1.75v-6.25L5 6.5Z" stroke={c} strokeLinejoin="round" />
));

/** Cog wheel: settings. */
export const GearIcon = icon('-2.5 -2.5 29 29', 24, () => (
  <>
    <Circle cx={12} cy={12} r={3} stroke={c} />
    <Path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
      stroke={c}
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </>
));

/** An arrow up and an arrow down: import and export. */
export const TransferIcon = icon('0 0 24 24', 24, () => (
  <Path d="M8.5 18.5v-12M5.5 9.5l3-3 3 3M15.5 5.5v12M12.5 14.5l3 3 3-3" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
));

/** An arrow into a tray: download. */
export const DownloadIcon = icon('0 0 24 24', 24, () => (
  <Path d="M12 4.5v10M8.5 11 12 14.5 15.5 11M5.5 15.5v3h13v-3" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
));

/** Three dots: more actions. */
export const MoreIcon = icon('0 0 24 24', 24, () => (
  <>
    <Circle cx={6.5} cy={12} r={1.25} fill={c} />
    <Circle cx={12} cy={12} r={1.25} fill={c} />
    <Circle cx={17.5} cy={12} r={1.25} fill={c} />
  </>
));

export const TrashIcon = icon('0 0 16 16', 16, () => (
  <Path
    d="M2.5 4.5h11M6.5 4.5V3a1 1 0 0 1 1-1h1a1 1 0 0 1 1 1v1.5M4 4.5l.6 8.1a1.5 1.5 0 0 0 1.5 1.4h3.8a1.5 1.5 0 0 0 1.5-1.4l.6-8.1M6.75 7v4.5M9.25 7v4.5"
    stroke={c}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

export const ChevronDownIcon = icon('0 0 16 16', 16, () => (
  <Path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
));

export const ChevronUpIcon = icon('0 0 16 16', 16, () => (
  <Path d="m4.5 9.5 3.5-3.5 3.5 3.5" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
));

export const ChevronLeftIcon = icon('0 0 16 16', 16, () => (
  <Path d="M9.5 4.5 6 8l3.5 3.5" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
));

export const ChevronRightIcon = icon('0 0 16 16', 16, () => (
  <Path d="M6.5 4.5 10 8l-3.5 3.5" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
));

/** A calendar page showing the day of the month: "Today" in the date picker, as in Todoist. */
export function TodayIcon({ day, color, size = 16 }: IconProps & { day: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none" color={color} aria-hidden>
      <Rect x={2} y={2.5} width={12} height={11.5} rx={2} stroke={c} />
      <Path d="M2 5.5h12" stroke={c} />
      <SvgText x={8} y={12.4} textAnchor="middle" fontSize={6.5} fontWeight="700" fill={color}>
        {day}
      </SvgText>
    </Svg>
  );
}

export const SunIcon = icon('0 0 16 16', 16, () => (
  <>
    <Circle cx={8} cy={8} r={2.75} stroke={c} />
    <Path
      d="M8 1.5v1.25M8 13.25v1.25M1.5 8h1.25M13.25 8h1.25M3.4 3.4l.9.9M11.7 11.7l.9.9M3.4 12.6l.9-.9M11.7 4.3l.9-.9"
      stroke={c}
      strokeLinecap="round"
    />
  </>
));

/** A sofa: the weekend. */
export const WeekendIcon = icon('0 0 16 16', 16, () => (
  <Path
    d="M3.5 7V5.5a2 2 0 0 1 2-2h5a2 2 0 0 1 2 2V7M2.5 7.5a1 1 0 0 1 2 0v1.5h7V7.5a1 1 0 0 1 2 0V11a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V7.5ZM4 12v1.5M12 12v1.5"
    stroke={c}
    strokeLinecap="round"
    strokeLinejoin="round"
  />
));

/** A calendar with an arrow: next week. */
export const NextWeekIcon = icon('0 0 16 16', 16, () => (
  <>
    <Path d="M14 7.5V4.5a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2V12a2 2 0 0 0 2 2h4M2 5.5h12" stroke={c} strokeLinecap="round" />
    <Path d="M10 12h4.5M12.75 10.25 14.5 12l-1.75 1.75" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

/** A circle struck through: no date. */
export const NoDateIcon = icon('0 0 16 16', 16, () => (
  <>
    <Circle cx={8} cy={8} r={5.5} stroke={c} />
    <Path d="m4.2 11.8 7.6-7.6" stroke={c} />
  </>
));

export const ClockIcon = icon('0 0 12 12', 12, () => (
  <>
    <Circle cx={6} cy={6} r={4.75} stroke={c} />
    <Path d="M6 3.5V6l1.75 1.25" stroke={c} strokeLinecap="round" strokeLinejoin="round" />
  </>
));

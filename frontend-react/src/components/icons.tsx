import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

const base = { width: 24, height: 24, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true } as const;

/** ToDoDAV mark: a white tick on a red rounded square. */
export function LogoMark(props: IconProps) {
  return (
    <svg {...base} viewBox="0 0 32 32" {...props}>
      <rect width="32" height="32" rx="8" fill="var(--accent)" />
      <path d="m9 16.5 4.5 4.5L23 11.5" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <svg {...base} width={12} height={12} viewBox="0 0 12 12" {...props}>
      <path d="M2.5 6.2 4.9 8.6 9.5 3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PencilIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path
        d="M9.585 18.65 5.5 19.5l.85-4.085L16.025 5.74a1.5 1.5 0 0 1 2.121 0l1.114 1.114a1.5 1.5 0 0 1 0 2.121L9.585 18.65Z"
        stroke="currentColor"
        strokeLinejoin="round"
      />
      <path d="m14.5 7.25 2.25 2.25" stroke="currentColor" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base} width={12} height={12} viewBox="0 0 12 12" {...props}>
      <rect x="1.5" y="2" width="9" height="8.5" rx="1.5" stroke="currentColor" />
      <path d="M1.5 4.75h9M4 1v2M8 1v2" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/** Two arrows chasing each other round: a repeating task. */
export function RepeatIcon(props: IconProps) {
  return (
    <svg {...base} width={12} height={12} viewBox="0 0 12 12" {...props}>
      <path
        d="M1.75 5.5A3.25 3.25 0 0 1 5 2.25h4.5M8 .75l1.5 1.5L8 3.75M10.25 6.5A3.25 3.25 0 0 1 7 9.75H2.5M4 11.25l-1.5-1.5L4 8.25"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function FlagIcon(props: IconProps) {
  return (
    <svg {...base} width={16} height={16} viewBox="0 0 16 16" {...props}>
      <path d="M3.5 14V2.5h8l-1.5 3 1.5 3h-8" stroke="currentColor" strokeLinejoin="round" fill="currentColor" fillOpacity=".15" />
    </svg>
  );
}

export function TagIcon(props: IconProps) {
  return (
    <svg {...base} width={12} height={12} viewBox="0 0 12 12" {...props}>
      <path d="M1.5 1.5h4.2l4.8 4.8-4.2 4.2-4.8-4.8V1.5Z" stroke="currentColor" strokeLinejoin="round" />
      <circle cx="4" cy="4" r=".8" fill="currentColor" />
    </svg>
  );
}

/** Two branches off one line: sub-tasks. */
export function SubtaskIcon(props: IconProps) {
  return (
    <svg {...base} width={12} height={12} viewBox="0 0 12 12" {...props}>
      <path d="M3 1.5v6A1.5 1.5 0 0 0 4.5 9H10M3 4.5h7" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HashIcon(props: IconProps) {
  return (
    <svg {...base} width={16} height={16} viewBox="0 0 16 16" {...props}>
      <path d="M6 2.5 4.5 13.5M11.5 2.5 10 13.5M2.5 6h11M2 10.5h11" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

export function PlusIcon(props: IconProps) {
  return (
    <svg {...base} width={13} height={13} viewBox="0 0 13 13" {...props}>
      <path d="M6.5 1.5v10M1.5 6.5h10" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
    </svg>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" strokeLinecap="round" />
    </svg>
  );
}

/** Arrow leaving a box: share / publish. */
export function ShareIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 4.5v10M8.5 8 12 4.5 15.5 8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 11H6.5v8.5h11V11H16" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function MapPinIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M12 20.5s-6-5.6-6-10.5a6 6 0 0 1 12 0c0 4.9-6 10.5-6 10.5Z" stroke="currentColor" strokeLinejoin="round" />
      <circle cx="12" cy="10" r="2" stroke="currentColor" />
    </svg>
  );
}

/** Funnel: filters. */
export function FilterIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path d="M5 6.5h14l-5.5 6.25v4.5l-3 1.75v-6.25L5 6.5Z" stroke="currentColor" strokeLinejoin="round" />
    </svg>
  );
}

/** Cog wheel: settings. */
export function GearIcon(props: IconProps) {
  return (
    <svg {...base} viewBox="-2.5 -2.5 29 29" {...props}>
      <circle cx="12" cy="12" r="3" stroke="currentColor" />
      <path
        d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** An arrow up and an arrow down: import and export. */
export function TransferIcon(props: IconProps) {
  return (
    <svg {...base} {...props}>
      <path
        d="M8.5 18.5v-12M5.5 9.5l3-3 3 3M15.5 5.5v12M12.5 14.5l3 3 3-3"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <svg {...base} width={16} height={16} viewBox="0 0 16 16" {...props}>
      <path d="m4.5 6.5 3.5 3.5 3.5-3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronUpIcon(props: IconProps) {
  return (
    <svg {...base} width={16} height={16} viewBox="0 0 16 16" {...props}>
      <path d="m4.5 9.5 3.5-3.5 3.5 3.5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

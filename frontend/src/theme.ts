import { useColorScheme } from 'react-native';

// Todoist-like look, the same colors as frontend-react's styles.css: light by default, dark when the system asks.
const light = {
  bg: '#ffffff',
  bgSoft: '#fcfaf8',
  bgHover: '#f5f5f5',
  text: '#202020',
  textSecondary: '#666666',
  textTertiary: '#808080',
  divider: '#f0f0f0',
  border: '#e6e6e6',
  accent: '#dc4c3e',
  accentHover: '#c3392c',
  accentText: '#ffffff',
  p1: '#d1453b',
  p2: '#eb8909',
  p3: '#246fe0',
  p4: '#999999',
  dueOverdue: '#d1453b',
  dueToday: '#058527',
  dueTomorrow: '#ad6200',
  dueWeek: '#692ec2',
  dueLater: '#808080',
  toastBg: '#282828',
  toastText: '#ffffff',
  toastAction: '#ff7066',
  link: '#246fe0',
  codeBg: 'rgba(0, 0, 0, 0.06)',
};

export type Colors = typeof light;

const dark: Colors = {
  ...light,
  bg: '#1e1e1e',
  bgSoft: '#262626',
  bgHover: '#2a2a2a',
  text: '#e8e8e8',
  textSecondary: '#b3b3b3',
  textTertiary: '#8f8f8f',
  divider: '#2e2e2e',
  border: '#3d3d3d',
  accent: '#e0584a',
  accentHover: '#ec6a5d',
  p1: '#ff7066',
  p2: '#ff9a14',
  p3: '#5297ff',
  p4: '#8a8a8a',
  dueOverdue: '#ff7066',
  dueToday: '#25b84c',
  dueTomorrow: '#ff9a14',
  dueWeek: '#a970ff',
  dueLater: '#8f8f8f',
  toastBg: '#3a3a3a',
  link: '#5297ff',
  codeBg: 'rgba(255, 255, 255, 0.1)',
};

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

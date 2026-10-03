import Svg, { Path, Rect } from 'react-native-svg';

import { useColors } from '../theme.ts';

export function LogoMark({ size = 24 }: { size?: number }) {
  const colors = useColors();
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <Rect width={32} height={32} rx={8} fill={colors.accent} />
      <Path d="m9 16.5 4.5 4.5L23 11.5" stroke="#fff" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

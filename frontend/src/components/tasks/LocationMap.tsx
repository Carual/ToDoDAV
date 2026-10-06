import { useColors } from '../../theme.ts';

/** The map under the location, on the web: an iframe (the backend's CSP allows the frame). */
export function LocationMap({ uri, title }: { uri: string; title: string }) {
  const colors = useColors();
  return (
    <iframe
      src={uri}
      title={title}
      loading="lazy"
      style={{
        display: 'block',
        width: '100%',
        height: 200,
        marginTop: 8,
        border: `1px solid ${colors.border}`,
        borderRadius: 5,
        boxSizing: 'border-box',
      }}
    />
  );
}

import { Linking, StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { useColors } from '../../theme.ts';

/** The map under the location, on Android/iOS: the same embed page as on the web, in a WebView. */
export function LocationMap({ uri, title }: { uri: string; title: string }) {
  const colors = useColors();
  return (
    <View style={[styles.frame, { borderColor: colors.border }]} aria-label={title}>
      <WebView
        source={{ uri }}
        // The map's own links ("View larger map") open in the Maps app or the browser, not in this small box.
        onOpenWindow={({ nativeEvent }) => void Linking.openURL(nativeEvent.targetUrl)}
        onShouldStartLoadWithRequest={(request) => {
          if (request.isTopFrame && request.navigationType === 'click') {
            void Linking.openURL(request.url);
            return false;
          }
          return true;
        }}
        // Lets the map pan inside the modal's scrolling area on Android (iOS already does).
        nestedScrollEnabled
      />
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { height: 200, marginTop: 8, borderWidth: 1, borderRadius: 5, overflow: 'hidden' },
});

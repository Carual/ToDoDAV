import * as DocumentPicker from 'expo-document-picker';

// The web version. pickFile.native.ts replaces it on Android/iOS: import it without the extension, so the bundler
// picks the file for the platform.

export interface PickedFile {
  name: string;
  text: string;
}

/** Asks for one file and reads it as text; null when the user cancels. `accept` filters the browser's chooser. */
export async function pickTextFile(accept: string[]): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: accept });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset?.file) return null;
  return { name: asset.name, text: await asset.file.text() };
}

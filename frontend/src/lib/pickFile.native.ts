import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';

export interface PickedFile {
  name: string;
  text: string;
}

/**
 * Asks for one file and reads it as text; null when the user cancels. Any file can be picked: Android often labels
 * .ics and .csv files as application/octet-stream, so filtering by type would hide them. A wrong file is caught by
 * the importer, which finds no tasks in it.
 */
export async function pickTextFile(_accept: string[]): Promise<PickedFile | null> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
  const asset = result.canceled ? undefined : result.assets[0];
  if (!asset) return null;
  const file = new File(asset.uri);
  try {
    return { name: asset.name, text: await file.text() };
  } finally {
    // The picker's copy in the cache is no longer needed.
    if (file.exists) file.delete();
  }
}

import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Hands `text` to the system's share sheet as a file (save to Files or Drive, send by mail...): apps have no
 * downloads folder of their own to drop it in.
 */
export async function download(name: string, text: string, type: string): Promise<void> {
  const file = new File(Paths.cache, name);
  if (file.exists) file.delete();
  file.create();
  file.write(text);
  await Sharing.shareAsync(file.uri, { mimeType: type, dialogTitle: name });
}

// The web version. download.native.ts replaces it on Android/iOS: import it as '../download', without the
// extension, so the bundler picks the file for the platform.

/** Saves `text` as a file, all in the browser. */
export async function download(name: string, text: string, type: string): Promise<void> {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoked later: some browsers still read the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

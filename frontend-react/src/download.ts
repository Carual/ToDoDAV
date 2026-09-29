/** A file name without the characters Windows and macOS refuse. */
export const fileName = (name: string, extension: string, fallback = 'tasks') =>
  `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || fallback}.${extension}`;

/** Saves `text` as a file, all in the browser. */
export function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  // Revoked later: some browsers still read the blob after click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

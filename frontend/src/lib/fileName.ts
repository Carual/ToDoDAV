/** A file name without the characters Windows and macOS refuse. */
export const fileName = (name: string, extension: string, fallback = 'tasks') =>
  `${name.replace(/[\\/:*?"<>|]+/g, '-').trim() || fallback}.${extension}`;

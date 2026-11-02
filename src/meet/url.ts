const MEET_PATH = /^\/(?:[a-z]{3}-[a-z]{4}-[a-z]{3}|lookup\/[a-z0-9_-]+)$/;

export function parseMeetUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    if (url.protocol !== 'https:') return null;
    if (url.hostname !== 'meet.google.com') return null;
    const path = url.pathname.replace(/\/+$/, '').toLowerCase();
    if (!MEET_PATH.test(path)) return null;
    return `https://meet.google.com${path}`;
  } catch {
    return null;
  }
}

export function meetCode(meetUrl: string): string {
  const path = new URL(meetUrl).pathname.replace(/^\//, '');
  return path.replaceAll('/', '-');
}

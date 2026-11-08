/** Turn a display name into a URL slug: "HilaTech Dev!" → "hilatech-dev". */
export function slugify(input: string, maxLength = 50): string {
  const slug = input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxLength)
    .replace(/-+$/g, '');
  return slug || 'org';
}

/** Append a short random suffix to make a slug unique: "acme" → "acme-k3f9". */
export function withRandomSuffix(slug: string, length = 4): string {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let i = 0; i < length; i++) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `${slug.slice(0, 50 - length - 1)}-${suffix}`;
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1))}…`;
}

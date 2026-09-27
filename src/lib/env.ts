import "server-only";

// Reads a setting that Vercel's storage integrations may have added with a custom
// prefix (e.g. STORAGE_POSTGRES_URL for POSTGRES_URL). The plain name always wins.
export function env(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const key = Object.keys(process.env)
    .sort()
    .find((k) => k.endsWith(`_${name}`) && process.env[k]);
  return key ? process.env[key] : undefined;
}

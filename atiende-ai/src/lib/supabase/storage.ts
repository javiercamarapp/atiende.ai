// Build a public URL for an asset in a public Supabase Storage bucket.
// We construct the URL manually instead of spinning up a browser client just
// to call `storage.from(...).getPublicUrl(...)`, which returns the exact same
// deterministic URL for public buckets.
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

export function getPublicStorageUrl(bucket: string, path: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/${bucket}/${path}`;
}

// Hero video shared by /login and /register. Lives in the public `videos`
// bucket in Supabase Storage.
export const HERO_VIDEO_URL = getPublicStorageUrl(
  'videos',
  'hf_20260410_182950_217295fd-b276-46d6-a53d-c2aa956a1967.mp4',
);

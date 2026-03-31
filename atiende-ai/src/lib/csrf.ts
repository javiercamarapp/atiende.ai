export function validateOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl || !origin) return true; // Allow in development
  return origin === appUrl;
}

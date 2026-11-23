import { ipAddress, next } from '@vercel/functions';
import { checkUpdateLock, updateCacheHeaders, updateLocked } from './server/update-lock.ts';

// No matcher: every page, static asset and API request crosses this boundary.
export const config = { runtime: 'nodejs' };
export default async function middleware(request: Request) {
  if (!updateLocked(process.env, true)) return next();
  const blocked = await checkUpdateLock(request, process.env, { deployed: true, ip: ipAddress(request) });
  return blocked ?? next({ headers: new Headers({ ...updateCacheHeaders, 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Xyvora-Update': 'early-access' }) });
}

import { ipAddress, next } from '@vercel/functions';
import { checkUpdateLock, updateCacheHeaders, updateLocked } from './update-lock.ts';

export default async function middleware(request: Request) {
  if (!updateLocked(process.env, true)) return next();
  const blocked = await checkUpdateLock(request, process.env, { deployed: true, ip: ipAddress(request) });
  return blocked ?? next({ headers: new Headers({ ...updateCacheHeaders, 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'X-Xyvora-Update': 'early-access' }) });
}

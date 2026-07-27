import { NextRequest } from 'next/server';
import { getWorkerToken } from './db';

/* Render-node scripts (Ruby inside SketchUp, Python inside 3dsmaxbatch, or
   this repo's stub-worker.mjs) have no browser session cookie — they
   authenticate with a fixed bearer token instead. */
export function isAuthorizedWorker(req: NextRequest): boolean {
  const auth = req.headers.get('authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return !!token && token === getWorkerToken();
}

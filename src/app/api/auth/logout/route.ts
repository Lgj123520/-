import { NextResponse } from 'next/server';
import { clearAuthCookie } from '@/lib/auth-session';

export async function POST() {
  await clearAuthCookie();
  return NextResponse.json({ success: true });
}

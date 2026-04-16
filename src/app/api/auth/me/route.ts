import { NextResponse } from 'next/server';
import { getAuthTokenFromCookieStore } from '@/lib/auth-session';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { displayAccountFromUser } from '@/lib/auth-identity';

export async function GET() {
  const token = await getAuthTokenFromCookieStore();
  if (!token) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  const supabase = getSupabaseClient(token);
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return NextResponse.json({ authenticated: false }, { status: 401 });
  }

  return NextResponse.json({
    authenticated: true,
    user: {
      id: data.user.id,
      email: data.user.email,
      account: displayAccountFromUser(data.user),
      role: (data.user.user_metadata?.role as string | undefined) ?? 'admin',
    },
  });
}

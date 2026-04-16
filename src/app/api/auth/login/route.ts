import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';
import { setAuthCookie } from '@/lib/auth-session';
import { displayAccountFromUser, resolveLoginEmail } from '@/lib/auth-identity';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { account, password } = await request.json();
    if (!account || !password) {
      return NextResponse.json({ error: '缺少参数：account 或 password' }, { status: 400 });
    }

    const { url, anonKey } = getSupabaseCredentials();
    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: resolveLoginEmail(String(account)),
      password: String(password),
    });

    if (error || !data.session?.access_token) {
      return NextResponse.json({ error: error?.message ?? '登录失败，请检查账号密码' }, { status: 401 });
    }

    await setAuthCookie(data.session.access_token);
    return NextResponse.json({
      success: true,
      user: {
        id: data.user?.id,
        email: data.user?.email,
        account: data.user ? displayAccountFromUser(data.user) : String(account).trim(),
        role: (data.user?.user_metadata?.role as string | undefined) ?? 'admin',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '登录失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

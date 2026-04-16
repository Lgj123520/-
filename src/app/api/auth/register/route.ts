import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';
import { clearAuthCookie, setAuthCookie } from '@/lib/auth-session';
import { displayAccountFromUser, resolveLoginEmail } from '@/lib/auth-identity';
import { createClient } from '@supabase/supabase-js';

export async function POST(request: NextRequest) {
  try {
    const { account, password, role } = await request.json();
    if (!account || !password) {
      return NextResponse.json({ error: '缺少参数：account 或 password' }, { status: 400 });
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: '密码长度至少 6 位' }, { status: 400 });
    }

    const { url, anonKey } = getSupabaseCredentials();
    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await supabase.auth.signUp({
      email: resolveLoginEmail(String(account)),
      password: String(password),
      options: {
        data: {
          role: role === 'assistant' ? 'assistant' : 'admin',
          account: String(account).trim(),
        },
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (!data.session?.access_token) {
      await clearAuthCookie();
      return NextResponse.json({
        success: true,
        needs_email_confirm: true,
        message: '注册成功，请完成邮箱验证后登录。',
      });
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
    const message = error instanceof Error ? error.message : '注册失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

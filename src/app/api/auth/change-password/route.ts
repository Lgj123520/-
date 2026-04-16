import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthTokenFromCookieStore } from '@/lib/auth-session';
import { getSupabaseClient, getSupabaseCredentials } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const token = await getAuthTokenFromCookieStore();
    if (!token) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

    const { currentPassword, newPassword } = await request.json();
    if (!currentPassword || !newPassword) {
      return NextResponse.json({ error: '缺少参数：currentPassword 或 newPassword' }, { status: 400 });
    }
    if (String(newPassword).length < 6) {
      return NextResponse.json({ error: '新密码长度至少 6 位' }, { status: 400 });
    }

    const tokenClient = getSupabaseClient(token);
    const { data: me, error: meError } = await tokenClient.auth.getUser(token);
    if (meError || !me.user?.email) return NextResponse.json({ error: '登录状态无效，请重新登录' }, { status: 401 });

    const { url, anonKey } = getSupabaseCredentials();
    const anonClient = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { error: signInError } = await anonClient.auth.signInWithPassword({
      email: me.user.email,
      password: String(currentPassword),
    });
    if (signInError) return NextResponse.json({ error: '当前密码不正确' }, { status: 400 });

    const { error: updateError } = await tokenClient.auth.updateUser({ password: String(newPassword) });
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 });

    return NextResponse.json({ success: true, message: '密码修改成功' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '修改密码失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

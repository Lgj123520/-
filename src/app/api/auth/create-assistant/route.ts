import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getAuthTokenFromCookieStore } from '@/lib/auth-session';
import { displayAccountFromUser, resolveLoginEmail } from '@/lib/auth-identity';
import { getSupabaseClient, getSupabaseCredentials, getSupabaseServiceRoleKey } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const token = await getAuthTokenFromCookieStore();
    if (!token) return NextResponse.json({ error: '未登录或登录已过期' }, { status: 401 });

    const userClient = getSupabaseClient(token);
    const { data: me, error: meError } = await userClient.auth.getUser(token);
    if (meError || !me.user) return NextResponse.json({ error: '登录状态无效，请重新登录' }, { status: 401 });

    const role = (me.user.user_metadata?.role as string | undefined) ?? 'admin';
    if (role !== 'admin') {
      return NextResponse.json({ error: '仅管理员可创建助教账号' }, { status: 403 });
    }

    const { account, password } = await request.json();
    if (!account || !password) {
      return NextResponse.json({ error: '缺少参数：account 或 password' }, { status: 400 });
    }
    if (String(password).length < 6) {
      return NextResponse.json({ error: '密码长度至少 6 位' }, { status: 400 });
    }

    const serviceRoleKey = getSupabaseServiceRoleKey();
    if (!serviceRoleKey) {
      return NextResponse.json({ error: '未配置 COZE_SUPABASE_SERVICE_ROLE_KEY，无法创建账号' }, { status: 500 });
    }

    const { url } = getSupabaseCredentials();
    const adminClient = createClient(url, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data, error } = await adminClient.auth.admin.createUser({
      email: resolveLoginEmail(String(account)),
      password: String(password),
      email_confirm: true,
      user_metadata: { role: 'assistant', account: String(account).trim() },
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({
      success: true,
      user: {
        id: data.user?.id,
        email: data.user?.email,
        account: data.user ? displayAccountFromUser(data.user) : String(account).trim(),
        role: 'assistant',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '创建助教账号失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

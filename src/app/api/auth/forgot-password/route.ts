import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { isEmailLike } from '@/lib/auth-identity';
import { getSupabaseCredentials } from '@/storage/database/supabase-client';

export async function POST(request: NextRequest) {
  try {
    const { account } = await request.json();
    if (!account) return NextResponse.json({ error: '缺少参数：account' }, { status: 400 });
    if (!isEmailLike(String(account))) {
      return NextResponse.json({ error: '忘记密码需要填写注册邮箱。若使用的是账号，请联系管理员重置密码。' }, { status: 400 });
    }

    const { url, anonKey } = getSupabaseCredentials();
    const supabase = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const redirectTo = `${request.nextUrl.origin}/`;
    const { error } = await supabase.auth.resetPasswordForEmail(String(account).trim(), { redirectTo });
    if (error) return NextResponse.json({ error: error.message }, { status: 400 });

    return NextResponse.json({ success: true, message: '重置密码邮件已发送，请前往邮箱查看。' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : '发送失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

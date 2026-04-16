import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 手动匹配：将目标学期学生与源学期学生视为同一人并统一姓名
export async function POST(request: NextRequest) {
  try {
    const { matches } = await request.json();

    if (!matches || !Array.isArray(matches)) {
      return NextResponse.json(
        { error: '缺少必要参数：matches（数组）' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();
    const results: Array<{ winterStudentId: string; springStudentId: string; success: boolean; error?: string }> = [];

    for (const match of matches) {
      const { winterStudentId, springStudentId } = match;

      if (!winterStudentId || !springStudentId) {
        results.push({
          winterStudentId,
          springStudentId,
          success: false,
          error: '缺少学生ID',
        });
        continue;
      }

      // 获取目标学期对应学生的姓名
      const { data: springStudent, error: springError } = await supabase
        .from('students')
        .select('name')
        .eq('id', springStudentId)
        .single();

      if (springError) {
        results.push({
          winterStudentId,
          springStudentId,
          success: false,
          error: `未找到目标学生：${springError.message}`,
        });
        continue;
      }

      // 更新源学期学生的姓名为目标侧姓名（通常更准确）
      const { error: updateError } = await supabase
        .from('students')
        .update({
          name: springStudent.name,
        })
        .eq('id', winterStudentId);

      if (updateError) {
        results.push({
          winterStudentId,
          springStudentId,
          success: false,
          error: `更新失败: ${updateError.message}`,
        });
        continue;
      }

      results.push({
        winterStudentId,
        springStudentId,
        success: true,
      });
    }

    const successCount = results.filter((r) => r.success).length;

    return NextResponse.json({
      success: true,
      data: {
        total: results.length,
        success_count: successCount,
        results,
      },
    });
  } catch (error: unknown) {
    console.error('手动匹配失败:', error);
    const message = error instanceof Error ? error.message : '匹配失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

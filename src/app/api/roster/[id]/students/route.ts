import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 批量更新学生（上课课时、半免）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: classId } = await params;
    const body = await request.json();
    const { updates } = body as {
      updates?: Array<{
        record_id: string;
        lessons_attended?: number;
        is_half_free?: boolean;
      }>;
    };

    if (!updates || !Array.isArray(updates) || updates.length === 0) {
      return NextResponse.json({ error: '缺少参数：updates' }, { status: 400 });
    }

    const supabase = getSupabaseClient();
    const results: Array<{ record_id: string; success: boolean; error?: string }> = [];

    for (const update of updates) {
      const { record_id, lessons_attended, is_half_free } = update;

      if (!record_id) {
        results.push({ record_id: record_id || 'unknown', success: false, error: '缺少 record_id' });
        continue;
      }

      if (lessons_attended === undefined && is_half_free === undefined) {
        results.push({ record_id, success: false, error: '没有要更新的字段' });
        continue;
      }

      const updateData: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };

      if (lessons_attended !== undefined) {
        const n = Number(lessons_attended);
        if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
          results.push({ record_id, success: false, error: '上课课时必须为非负整数' });
          continue;
        }
        updateData.lessons_attended = n;
      }
      if (is_half_free !== undefined) {
        updateData.is_half_free = !!is_half_free;
      }

      const { error } = await supabase
        .from('attendance_records')
        .update(updateData)
        .eq('id', record_id)
        .eq('class_id', classId);

      if (error) {
        results.push({ record_id, success: false, error: error.message });
      } else {
        results.push({ record_id, success: true });
      }
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
    console.error('批量更新学生失败:', error);
    const message = error instanceof Error ? error.message : '更新失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 批量删除学生
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: classId } = await params;
    const body = await request.json();
    const { record_ids } = body;

    if (!record_ids || !Array.isArray(record_ids) || record_ids.length === 0) {
      return NextResponse.json({ error: '缺少参数：record_ids' }, { status: 400 });
    }

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('attendance_records')
      .delete()
      .eq('class_id', classId)
      .in('id', record_ids);

    if (error) throw new Error(`删除学生失败: ${error.message}`);

    return NextResponse.json({ success: true, deleted_count: record_ids.length });
  } catch (error: unknown) {
    console.error('删除学生失败:', error);
    const message = error instanceof Error ? error.message : '删除失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

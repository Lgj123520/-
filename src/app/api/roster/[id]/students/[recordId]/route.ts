import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 更新单条点名记录（上课课时、半免）
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; recordId: string }> }
) {
  try {
    const { id: classId, recordId } = await params;
    const body = await request.json();
    const { lessons_attended, is_half_free } = body as {
      lessons_attended?: number;
      is_half_free?: boolean;
    };

    if (lessons_attended === undefined && is_half_free === undefined) {
      return NextResponse.json({ error: '没有要更新的字段' }, { status: 400 });
    }

    const updateData: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (lessons_attended !== undefined) {
      const n = Number(lessons_attended);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) {
        return NextResponse.json({ error: '上课课时必须为非负整数' }, { status: 400 });
      }
      updateData.lessons_attended = n;
    }
    if (is_half_free !== undefined) {
      updateData.is_half_free = !!is_half_free;
    }

    const supabase = getSupabaseClient();

    const { error } = await supabase
      .from('attendance_records')
      .update(updateData)
      .eq('id', recordId)
      .eq('class_id', classId);

    if (error) throw new Error(error.message);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('更新学生失败:', error);
    const message = error instanceof Error ? error.message : '更新失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

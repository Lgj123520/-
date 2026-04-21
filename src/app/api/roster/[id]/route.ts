import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

// 获取班级详情和所有学生
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    // 获取班级信息
    const { data: classInfo, error: classError } = await supabase
      .from('classes')
      .select('*')
      .eq('id', id)
      .single();

    if (classError) throw new Error(`获取班级信息失败: ${classError.message}`);
    if (!classInfo) {
      return NextResponse.json({ error: '班级不存在' }, { status: 404 });
    }

    // 获取班级所有学生
    const { data: records, error: recordsError } = await supabase
      .from('attendance_records')
      .select('*, students(*)')
      .eq('class_id', id)
      .order('created_at');

    if (recordsError) throw new Error(`获取学生列表失败: ${recordsError.message}`);

    // 格式化数据
    const oneThird = Math.ceil(classInfo.total_lessons / 3);
    const students = (records || []).map((record) => {
      const lessonsAttended = Math.min(record.lessons_attended, classInfo.total_lessons);
      const isExcludedByAttendance = lessonsAttended < oneThird;
      const isExcluded = record.is_half_free || isExcludedByAttendance;
      let remark = '';
      if (record.is_half_free) {
        const rawRemark = String((record as { remark?: string | null }).remark || '').trim();
        const isFreeLike =
          rawRemark.includes('免费') ||
          rawRemark.includes('全免') ||
          rawRemark.includes('免学费') ||
          rawRemark.includes('减免');
        remark = isFreeLike ? '免费' : '半免';
      } else if (lessonsAttended === 0) {
        remark = '退费/退班';
      } else if (isExcludedByAttendance) {
        remark = '课时不足';
      }
      return {
        id: record.id,
        student_id: record.student_id,
        name: record.students?.name || '未知',
        lessons_attended: record.lessons_attended,
        is_half_free: !!record.is_half_free,
        is_excluded: isExcluded,
        remark: remark,
        original_remark: String((record as { remark?: string | null }).remark || ''),
      };
    });

    return NextResponse.json({
      data: {
        class: classInfo,
        students,
      },
    });
  } catch (error: unknown) {
    console.error('获取班级详情失败:', error);
    const message = error instanceof Error ? error.message : '获取失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 更新班级信息
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const { name, term, total_lessons } = body;

    const supabase = getSupabaseClient();

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (term !== undefined) updates.term = term;
    if (total_lessons !== undefined) updates.total_lessons = total_lessons;

    const { data, error } = await supabase
      .from('classes')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw new Error(`更新班级失败: ${error.message}`);

    return NextResponse.json({ success: true, data });
  } catch (error: unknown) {
    console.error('更新班级失败:', error);
    const message = error instanceof Error ? error.message : '更新失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// 删除班级
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = getSupabaseClient();

    // 先删除该班级的所有点名记录
    const { error: deleteRecordsError } = await supabase
      .from('attendance_records')
      .delete()
      .eq('class_id', id);

    if (deleteRecordsError) throw new Error(`删除点名记录失败: ${deleteRecordsError.message}`);

    // 再删除班级
    const { error: deleteClassError } = await supabase
      .from('classes')
      .delete()
      .eq('id', id);

    if (deleteClassError) throw new Error(`删除班级失败: ${deleteClassError.message}`);

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('删除班级失败:', error);
    const message = error instanceof Error ? error.message : '删除失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

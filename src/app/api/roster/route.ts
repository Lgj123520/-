import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import * as XLSX from 'xlsx';

interface StudentRecord {
  name: string;
  lessons_attended: number;
  is_half_free: boolean;
  remark?: string | null;
  exclude_label?: 'free' | 'half_free' | 'withdraw' | null;
}

interface ParsedRoster {
  class_name: string;
  term: string;
  total_lessons: number;
  students: StudentRecord[];
}

function isMissingClassesUserIdError(message: string): boolean {
  return /user_id/i.test(message) && (/classes/i.test(message) || /schema cache/i.test(message));
}

function rosterErrorForClient(message: string): string {
  if (isMissingClassesUserIdError(message)) {
    return (
      '创建班级失败：数据库表 classes 与当前代码不一致。若无法执行 SQL 迁移，请联系管理员；也可在 Supabase 执行 scripts/sql/add-classes-user-id.sql 后重试。'
    );
  }
  return message;
}

function isValidTermFormat(term: string): boolean {
  const s = String(term || '').replace(/\s+/g, '');
  return (
    /^(20\d{2}|\d{2})(?:年)?(?:学年)?(春|秋|寒|暑|冬)(?:季|假)?$/u.test(s) ||
    /^(春|秋|寒|暑|冬)(?:季|假)?(20\d{2}|\d{2})$/u.test(s) ||
    /^(20\d{2}|\d{2})-(20\d{2}|\d{2})(?:学年)?$/u.test(s)
  );
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const className = formData.get('className') as string;
    const term = formData.get('term') as string;
    const totalLessons = parseInt(formData.get('totalLessons') as string) || 12;

    if (!file || !className || !term) {
      return NextResponse.json(
        { error: '缺少必要参数：file, className, term' },
        { status: 400 }
      );
    }
    if (!isValidTermFormat(term)) {
      return NextResponse.json(
        { error: 'term 格式不正确，请使用如：25秋、25寒、26春、2025寒假、春2026' },
        { status: 400 }
      );
    }

    // 读取文件内容
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as (string | number | boolean | null)[][];

    // 解析点名册数据
    const parsedRoster = parseRosterData(jsonData, className, term, totalLessons);

    // 保存到数据库
    const supabase = getSupabaseClient();

    // 1. 检查是否存在同名同term的班级
    const { data: existingClass } = await supabase
      .from('classes')
      .select('id')
      .eq('name', className)
      .eq('term', term)
      .maybeSingle();

    let classId: string;
    let isUpdate = false;

    if (existingClass) {
      // 存在同名班级，更新现有班级的总课时
      const { error: updateError } = await supabase
        .from('classes')
        .update({ total_lessons: totalLessons })
        .eq('id', existingClass.id);

      if (updateError) throw new Error(`更新班级失败: ${updateError.message}`);
      classId = existingClass.id;
      isUpdate = true;

      // 删除旧的学生点名记录
      const { error: deleteError } = await supabase
        .from('attendance_records')
        .delete()
        .eq('class_id', existingClass.id);

      if (deleteError) throw new Error(`删除旧数据失败: ${deleteError.message}`);
    } else {
      // 不存在同名班级，创建新班级（兼容尚未迁移 user_id 列的旧库）
      let insertResult = await supabase
        .from('classes')
        .insert({
          user_id: 'shared',
          name: className,
          term: term,
          total_lessons: totalLessons,
        })
        .select('id')
        .single();

      if (insertResult.error && isMissingClassesUserIdError(insertResult.error.message)) {
        insertResult = await supabase
          .from('classes')
          .insert({
            name: className,
            term: term,
            total_lessons: totalLessons,
          })
          .select('id')
          .single();
      }

      if (insertResult.error) throw new Error(`创建班级失败: ${insertResult.error.message}`);
      classId = insertResult.data!.id;
    }

    // 2. 处理学生数据
    let usedRemarkFallback = false;
    for (const student of parsedRoster.students) {
      // 查找或创建学生
      let { data: existingStudent } = await supabase
        .from('students')
        .select('id')
        .eq('name', student.name)
        .maybeSingle();

      if (!existingStudent) {
        const { data: newStudent, error: studentError } = await supabase
          .from('students')
          .insert({ name: student.name })
          .select('id')
          .single();

        if (studentError) throw new Error(`创建学生失败: ${studentError.message}`);
        existingStudent = newStudent;
      }

      // 创建点名记录：优先携带 remark（用于区分免费/半免展示），旧库无该列时自动回退
      let recordResult = await supabase
        .from('attendance_records')
        .insert({
          class_id: classId,
          student_id: existingStudent.id,
          lessons_attended: student.lessons_attended,
          is_half_free: student.is_half_free,
          remark: student.remark ?? (student.exclude_label === 'free' ? '免费' : student.exclude_label === 'half_free' ? '半免' : null),
        });

      if (recordResult.error && /remark/i.test(recordResult.error.message)) {
        usedRemarkFallback = true;
        recordResult = await supabase
          .from('attendance_records')
          .insert({
            class_id: classId,
            student_id: existingStudent.id,
            lessons_attended: student.lessons_attended,
            is_half_free: student.is_half_free,
          });
      }

      if (recordResult.error) throw new Error(`创建点名记录失败: ${recordResult.error.message}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        class_name: className,
        term: term,
        total_lessons: totalLessons,
        student_count: parsedRoster.students.length,
        is_update: isUpdate,
        warning: usedRemarkFallback
          ? '当前数据库未启用 attendance_records.remark 字段，免费/半免将无法长期精确区分。建议在 Supabase 执行 scripts/sql/add-attendance-remark.sql。'
          : undefined,
      },
    });
  } catch (error: unknown) {
    console.error('上传点名册失败:', error);
    const raw = error instanceof Error ? error.message : '上传失败';
    return NextResponse.json(
      { error: rosterErrorForClient(raw) },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const supabase = getSupabaseClient();

    // 获取所有班级
    const { data: classes, error: classesError } = await supabase
      .from('classes')
      .select('*')
      .order('created_at', { ascending: false });

    if (classesError) throw new Error(`获取班级列表失败: ${classesError.message}`);

    // 获取每个班级的学生数
    const classesWithCount = await Promise.all(
      (classes || []).map(async (cls) => {
        const { count } = await supabase
          .from('attendance_records')
          .select('*', { count: 'exact', head: true })
          .eq('class_id', cls.id);

        return {
          ...cls,
          student_count: count || 0,
        };
      })
    );

    return NextResponse.json({ data: classesWithCount });
  } catch (error: unknown) {
    console.error('获取班级列表失败:', error);
    const message = error instanceof Error ? error.message : '获取失败';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

function parseRosterData(
  data: (string | number | boolean | null)[][],
  className: string,
  term: string,
  totalLessons: number
): ParsedRoster {
  const students: StudentRecord[] = [];

  // 假设第一行是表头
  const headers = data[0] || [];
  
  // 查找姓名、课时、备注对应的列索引
  let nameIndex = -1;
  let lessonsIndex = -1;
  let remarkIndex = -1;
  // 兼容旧格式的半免列
  let halfFreeIndex = -1;

  headers.forEach((header, index) => {
    const headerStr = String(header || '').toLowerCase().trim();
    if (headerStr.includes('姓名') || headerStr.includes('名字') || headerStr === 'name') {
      nameIndex = index;
    } else if (
      headerStr.includes('课时') ||
      headerStr.includes('上课') ||
      headerStr.includes('出勤') ||
      headerStr.includes('lessons')
    ) {
      lessonsIndex = index;
    } else if (
      headerStr.includes('备注') ||
      headerStr.includes('remark') ||
      headerStr.includes('note') ||
      headerStr.includes('说明')
    ) {
      remarkIndex = index;
    } else if (
      headerStr.includes('半免') ||
      headerStr.includes('优惠') ||
      headerStr.includes('折扣') ||
      headerStr.includes('half')
    ) {
      halfFreeIndex = index;
    }
  });

  // 默认索引（如果没找到）
  if (nameIndex === -1) nameIndex = 0;
  if (lessonsIndex === -1) lessonsIndex = 1;
  // remarkIndex 和 halfFreeIndex 可选，不设默认值

  const freeKeywords = ['免费', '全免', '免学费'];
  const halfFreeKeywords = ['半免', '优惠', '折扣', 'half'];
  const withdrawKeywords = ['退费', '试听', '休学', '退学', '退款', '取消', '退'];

  function parseExcludeFlags(
    remarkValue: string | number | boolean | null,
    halfFreeValue?: string | number | boolean | null
  ): { isHalfFree: boolean; isWithdrawLike: boolean; label: 'free' | 'half_free' | 'withdraw' | null } {
    const remark = String(remarkValue || '').toLowerCase().trim();
    const halfValue = String(halfFreeValue || '').toLowerCase().trim();

    const isFreeByRemark = freeKeywords.some((keyword) => remark.includes(keyword.toLowerCase()));
    const isFreeByColumn = freeKeywords.some((keyword) => halfValue.includes(keyword.toLowerCase()));
    const isFree = isFreeByRemark || isFreeByColumn;
    const isHalfFreeByRemark = halfFreeKeywords.some((keyword) => remark.includes(keyword.toLowerCase()));
    const isWithdrawByRemark = withdrawKeywords.some((keyword) => remark.includes(keyword.toLowerCase()));

    const isHalfFreeByColumn =
      halfValue === '是' ||
      halfValue === '半免' ||
      halfValue === 'yes' ||
      halfValue === 'true' ||
      halfValue === '1' ||
      halfFreeKeywords.some((keyword) => halfValue.includes(keyword.toLowerCase()));

    const isWithdrawByColumn = withdrawKeywords.some((keyword) => halfValue.includes(keyword.toLowerCase()));

    return {
      isHalfFree: isFree || isHalfFreeByRemark || isHalfFreeByColumn,
      isWithdrawLike: isWithdrawByRemark || isWithdrawByColumn,
      label: isWithdrawByRemark || isWithdrawByColumn ? 'withdraw' : isFree ? 'free' : isHalfFreeByRemark || isHalfFreeByColumn ? 'half_free' : null,
    };
  }

  // 从第二行开始读取数据
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    if (!row || row.length === 0) continue;

    const name = String(row[nameIndex] || '').trim();
    if (!name) continue;

    // 解析课时数
    let lessonsAttended = 0;
    const lessonsValue = row[lessonsIndex];
    if (typeof lessonsValue === 'number') {
      lessonsAttended = lessonsValue;
    } else if (typeof lessonsValue === 'string') {
      lessonsAttended = parseInt(lessonsValue) || 0;
    }

    // 解析备注列，区分「半免类」和「退费/退学类」
    let remarkValue: string | null = null;
    let halfFreeValue: string | null = null;
    
    if (remarkIndex >= 0 && remarkIndex < row.length) {
      remarkValue = String(row[remarkIndex] || '').trim();
    }
    if (halfFreeIndex >= 0 && halfFreeIndex < row.length) {
      halfFreeValue = row[halfFreeIndex] !== null ? String(row[halfFreeIndex]) : '';
    }
    
    const flags = parseExcludeFlags(remarkValue, halfFreeValue);
    const isWithdrawLike = flags.isWithdrawLike && !flags.isHalfFree;
    // 退费/退学类学生按业务应排除，且不应显示为“半免”。
    if (isWithdrawLike) {
      lessonsAttended = 0;
    }

    students.push({
      name,
      lessons_attended: lessonsAttended,
      is_half_free: flags.isHalfFree,
      remark: remarkValue,
      exclude_label: flags.label,
    });
  }

  return {
    class_name: className,
    term,
    total_lessons: totalLessons,
    students,
  };
}

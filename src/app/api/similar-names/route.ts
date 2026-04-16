import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';

function joinStudentName(students: { name?: string } | { name?: string }[] | null | undefined): string {
  if (!students) return '未知';
  if (Array.isArray(students)) return students[0]?.name ?? '未知';
  return students.name ?? '未知';
}

// 改进的中文姓名相似度计算
function calculateNameSimilarity(str1: string, str2: string): number {
  const s1 = str1.trim().toLowerCase();
  const s2 = str2.trim().toLowerCase();
  
  if (s1 === s2) return 1;
  if (s1.length === 0 || s2.length === 0) return 0;
  
  // 长度差异过大，相似度降低
  const lengthDiff = Math.abs(s1.length - s2.length);
  if (lengthDiff > 2) return 0;
  
  // 计算公共字符数
  const chars1 = s1.split('');
  const chars2 = s2.split('');
  let commonCount = 0;
  
  for (const c1 of chars1) {
    const idx = chars2.indexOf(c1);
    if (idx !== -1) {
      commonCount++;
      chars2.splice(idx, 1); // 移除已匹配的字符
    }
  }
  
  // 公共字符比例
  const maxLen = Math.max(s1.length, s2.length);
  const charSimilarity = (2 * commonCount) / (s1.length + s2.length);
  
  // 检查顺序一致的字符
  let orderScore = 0;
  let matchLen = 0;
  for (let i = 0; i < s1.length && i < s2.length; i++) {
    if (s1[i] === s2[i]) {
      matchLen++;
      orderScore = matchLen;
    } else {
      matchLen = 0;
    }
  }
  const orderSimilarity = orderScore / maxLen;
  
  // 综合相似度：字符相似度权重更高，顺序相似度作为补充
  return charSimilarity * 0.7 + orderSimilarity * 0.3;
}

export async function POST(request: NextRequest) {
  try {
    const { fromTerm, toTerm, similarityThreshold = 0.6 } = await request.json();

    if (!fromTerm || !toTerm) {
      return NextResponse.json(
        { error: '缺少必要参数：fromTerm, toTerm' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // 获取源学期的有效学生（排除半免和上课不足的）
    const { data: sourceClasses, error: sourceError } = await supabase
      .from('classes')
      .select('*')
      .eq('term', fromTerm);

    if (sourceError) throw new Error(`获取源班级失败: ${sourceError.message}`);

    const sourceClassIds = sourceClasses.map((c) => c.id);
    const { data: sourceRecords, error: recordsError } = await supabase
      .from('attendance_records')
      .select('*, students(name), classes(total_lessons)')
      .in('class_id', sourceClassIds);

    if (recordsError) throw new Error(`获取源学生失败: ${recordsError.message}`);

    // 获取目标学期的学生
    const { data: targetClasses, error: targetError } = await supabase
      .from('classes')
      .select('*')
      .eq('term', toTerm);

    if (targetError) throw new Error(`获取目标班级失败: ${targetError.message}`);

    const targetClassIds = targetClasses.map((c) => c.id);
    const { data: targetRecords, error: targetError2 } = await supabase
      .from('attendance_records')
      .select('student_id, students(name)')
      .in('class_id', targetClassIds);

    if (targetError2) throw new Error(`获取目标学生失败: ${targetError2.message}`);

    // 构建源学生和目标学生集合
    const validSourceStudents = new Map<string, { id: string; name: string; className: string }>();
    for (const record of sourceRecords || []) {
      const totalLessons = record.classes?.total_lessons || 12;
      const oneThird = Math.ceil(totalLessons / 3);
      if (record.is_half_free) continue;
      if (record.lessons_attended < oneThird) continue;
      
      validSourceStudents.set(record.student_id, {
        id: record.student_id,
        name: joinStudentName(record.students as { name?: string } | { name?: string }[] | null),
        className: record.classes?.name || '未知',
      });
    }

    const targetStudents = new Map<string, string>();
    for (const record of targetRecords || []) {
      targetStudents.set(
        record.student_id,
        joinStudentName(record.students as { name?: string } | { name?: string }[] | null)
      );
    }

    // 找出已经续班的学生（在目标学期存在的）
    const renewedStudentIds = new Set<string>();
    for (const record of sourceRecords || []) {
      if (targetStudents.has(record.student_id)) {
        renewedStudentIds.add(record.student_id);
      }
    }

    // 查找相似姓名
    const similarNames: Array<{
      winter_student_id: string;
      winter_name: string;
      winter_class: string;
      spring_names: Array<{ student_id: string; name: string; similarity: number }>;
      is_renewed: boolean;
    }> = [];

    for (const [studentId, student] of validSourceStudents) {
      // 跳过已经续班的学生
      if (renewedStudentIds.has(studentId)) continue;

      const similarSpringStudents: Array<{ student_id: string; name: string; similarity: number }> = [];

      for (const [targetId, targetName] of targetStudents) {
        // 跳过已续班学生
        if (renewedStudentIds.has(targetId)) continue;

        // 直接使用改进的中文姓名相似度计算
        const similarity = calculateNameSimilarity(student.name, targetName);

        if (similarity >= similarityThreshold) {
          similarSpringStudents.push({
            student_id: targetId,
            name: targetName,
            similarity: Math.round(similarity * 100) / 100,
          });
        }
      }

      if (similarSpringStudents.length > 0) {
        similarSpringStudents.sort((a, b) => b.similarity - a.similarity);
        similarNames.push({
          winter_student_id: studentId,
          winter_name: student.name,
          winter_class: student.className,
          spring_names: similarSpringStudents,
          is_renewed: false,
        });
      }
    }

    // 按相似度排序
    similarNames.sort((a, b) => b.spring_names[0].similarity - a.spring_names[0].similarity);

    return NextResponse.json({
      data: {
        from_term: fromTerm,
        to_term: toTerm,
        total_similar: similarNames.length,
        similar_names: similarNames,
      },
    });
  } catch (error: unknown) {
    console.error('查找相似姓名失败:', error);
    const message = error instanceof Error ? error.message : '查找失败';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

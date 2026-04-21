import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { compareGradeLabels, extractGradeFromClassName } from '@/lib/class-grade';

function pickNameField(v: { name?: string } | { name?: string }[] | null | undefined): string {
  if (!v) return '未知';
  if (Array.isArray(v)) return v[0]?.name || '未知';
  return v.name || '未知';
}

function pickTotalLessonsField(
  v: { total_lessons?: number } | { total_lessons?: number }[] | null | undefined,
  fallback = 12
): number {
  if (!v) return fallback;
  if (Array.isArray(v)) return v[0]?.total_lessons || fallback;
  return v.total_lessons || fallback;
}

export async function POST(request: NextRequest) {
  try {
    const {
      fromTerm,
      toTerm,
      fromTerms,
      toTerms,
      sourceClassIds: sourceClassIdsParam,
      targetClassIds: targetClassIdsParam,
      fromTermLabel,
      toTermLabel,
    } = await request.json();

    const sourceTerms: string[] = Array.isArray(fromTerms) && fromTerms.length
      ? fromTerms
      : fromTerm
      ? [fromTerm]
      : [];
    const targetTerms: string[] = Array.isArray(toTerms) && toTerms.length
      ? toTerms
      : toTerm
      ? [toTerm]
      : [];

    const sourceIds: string[] = Array.isArray(sourceClassIdsParam) ? sourceClassIdsParam.filter(Boolean) : [];
    const targetIds: string[] = Array.isArray(targetClassIdsParam) ? targetClassIdsParam.filter(Boolean) : [];

    const hasClassScope = sourceIds.length > 0 || targetIds.length > 0;
    if (!hasClassScope && (sourceTerms.length === 0 || targetTerms.length === 0)) {
      return NextResponse.json(
        { error: '缺少必要参数：fromTerm/toTerm、fromTerms/toTerms，或 sourceClassIds/targetClassIds' },
        { status: 400 }
      );
    }

    const supabase = getSupabaseClient();

    // 1. 获取源学期（如"寒假"）的所有班级
    const sourceQuery = supabase.from('classes').select('*');
    const { data: sourceClasses, error: sourceError } =
      sourceIds.length > 0 ? await sourceQuery.in('id', sourceIds) : await sourceQuery.in('term', sourceTerms);

    if (sourceError) throw new Error(`获取源班级失败: ${sourceError.message}`);

    if (!sourceClasses || sourceClasses.length === 0) {
      return NextResponse.json({
        data: {
          from_term: fromTermLabel || (sourceTerms.length ? sourceTerms.join('、') : '源范围'),
          to_term: toTermLabel || (targetTerms.length ? targetTerms.join('、') : '目标范围'),
          source_class_count: 0,
          source_total_students: 0,
          valid_students: 0, // 排除半免和上课不足1/3后的有效学生数
          renewed_students: 0,
          renewal_rate: 0,
          details: [],
          class_stats: [],
          grade_stats: [],
        },
      });
    }

    // 2. 获取目标学期（如"春季"）的所有班级
    const targetQuery = supabase.from('classes').select('*');
    const { data: targetClasses, error: targetError } =
      targetIds.length > 0 ? await targetQuery.in('id', targetIds) : await targetQuery.in('term', targetTerms);

    if (targetError) throw new Error(`获取目标班级失败: ${targetError.message}`);

    // 3. 获取所有源班级的学生点名记录（排除半免和上课不足1/3的）
    const sourceClassIds = sourceClasses.map((c) => c.id);
    const sourceClassNameById = new Map(sourceClasses.map((c) => [c.id, c.name]));
    const { data: sourceRecords, error: recordsError } = await supabase
      .from('attendance_records')
      .select('*, students(name), classes(name, total_lessons)')
      .in('class_id', sourceClassIds);

    if (recordsError) throw new Error(`获取点名记录失败: ${recordsError.message}`);
    const sourceAllStudentIds = new Set<string>((sourceRecords || []).map((r) => r.student_id));

    // 4. 计算源学期有效学生（排除半免 + 上课不足1/3）
    const validSourceStudentIds = new Set<string>();
    const sourceStudentDetails: Record<string, { name: string; lessons_attended: number; total_lessons: number }> = {};

    for (const record of sourceRecords || []) {
      const totalLessons = record.classes?.total_lessons || 12;
      const oneThird = Math.ceil(totalLessons / 3);
      // 修正异常数据：上课课时不能超过总课时
      const lessonsAttended = Math.min(record.lessons_attended, totalLessons);

      // 排除半免或上课不足1/3的学生
      if (record.is_half_free) continue;
      if (lessonsAttended < oneThird) continue;

      validSourceStudentIds.add(record.student_id);
      sourceStudentDetails[record.student_id] = {
        name: record.students?.name || '未知',
        lessons_attended: lessonsAttended,
        total_lessons: totalLessons,
      };
    }

    // 5. 获取所有目标班级的学生点名记录（含班级，用于续报至哪班）
    const targetClassIds = targetClasses.map((c) => c.id);
    const targetStudentIds = new Set<string>();
    const targetClassNameById = new Map<string, string>(
      (targetClasses || []).map((c) => [c.id, c.name])
    );
    const renewedToClassNamesByStudent = new Map<string, Set<string>>();
    const targetStudentDetails = new Map<string, { name: string; lessons_attended: number; total_lessons: number }>();

    if (targetClasses.length > 0) {
      const { data: targetRecords, error: targetRecordsError } = await supabase
        .from('attendance_records')
        .select('student_id, class_id, lessons_attended, students(name), classes(total_lessons)')
        .in('class_id', targetClassIds);

      if (targetRecordsError) throw new Error(`获取目标班级记录失败: ${targetRecordsError.message}`);

      for (const record of targetRecords || []) {
        targetStudentIds.add(record.student_id);
        const cname = targetClassNameById.get(record.class_id);
        if (!cname) continue;
        let set = renewedToClassNamesByStudent.get(record.student_id);
        if (!set) {
          set = new Set();
          renewedToClassNamesByStudent.set(record.student_id, set);
        }
        set.add(cname);
        if (!targetStudentDetails.has(record.student_id)) {
          const totalLessons = pickTotalLessonsField(
            record.classes as { total_lessons?: number } | { total_lessons?: number }[] | null,
            12
          );
          targetStudentDetails.set(record.student_id, {
            name: pickNameField(record.students as { name?: string } | { name?: string }[] | null),
            lessons_attended: Math.min(record.lessons_attended, totalLessons),
            total_lessons: totalLessons,
          });
        }
      }
    }

    const getRenewedToClassLabel = (studentId: string): string => {
      const set = renewedToClassNamesByStudent.get(studentId);
      if (!set || set.size === 0) return '';
      return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN')).join('、');
    };

    // 6. 计算续读学生和未续读学生
    let renewedCount = 0;
    const renewedDetails: {
      student_id: string;
      name: string;
      lessons_attended: number;
      total_lessons: number;
      class_name?: string;
      source_term?: string;
      renewed_to_class?: string;
      target_term?: string;
    }[] = [];
    const notRenewedDetails: {
      student_id: string;
      name: string;
      lessons_attended: number;
      total_lessons: number;
      class_name: string;
      source_term?: string;
    }[] = [];
    const newStudentDetails: {
      student_id: string;
      name: string;
      lessons_attended: number;
      total_lessons: number;
      class_name: string;
      target_term?: string;
    }[] = [];

    // 获取学生对应的班级信息
    const studentClassMap: Record<string, string> = {};
    for (const record of sourceRecords || []) {
      if (!record.is_half_free) {
        const totalLessons = record.classes?.total_lessons || 12;
        const oneThird = Math.ceil(totalLessons / 3);
        if (record.lessons_attended >= oneThird) {
          studentClassMap[record.student_id] =
            record.classes?.name ||
            sourceClassNameById.get(record.class_id as string) ||
            '未知班级';
        }
      }
    }

    for (const studentId of validSourceStudentIds) {
      if (targetStudentIds.has(studentId)) {
        renewedCount++;
        renewedDetails.push({
          student_id: studentId,
          ...sourceStudentDetails[studentId],
          class_name: studentClassMap[studentId],
          source_term: sourceTerms.join('、'),
          renewed_to_class: getRenewedToClassLabel(studentId),
          target_term: targetTerms.join('、'),
        });
      } else {
        notRenewedDetails.push({
          student_id: studentId,
          ...sourceStudentDetails[studentId],
          class_name: studentClassMap[studentId] || '未知班级',
          source_term: sourceTerms.join('、'),
        });
      }
    }

    // 6.5 计算新生：目标学期有、源学期没有（按学生ID）
    for (const studentId of targetStudentIds) {
      if (sourceAllStudentIds.has(studentId)) continue;
      const detail = targetStudentDetails.get(studentId);
      if (!detail) continue;
      newStudentDetails.push({
        student_id: studentId,
        name: detail.name,
        lessons_attended: detail.lessons_attended,
        total_lessons: detail.total_lessons,
        class_name: getRenewedToClassLabel(studentId) || '未知班级',
        target_term: targetTerms.join('、'),
      });
    }

    // 7. 统计每个源班级的情况（含从班级名称解析的年级，便于按年级分层）
    const classStats = sourceClasses.map((cls) => {
      const classRecords = (sourceRecords || []).filter((r) => r.class_id === cls.id);
      const totalStudents = classRecords.length;
      
      // 计算有效学生（上课课时不超过总课时）
      const oneThird = Math.ceil((cls.total_lessons || 12) / 3);
      const validStudents = classRecords.filter(
        (r) => !r.is_half_free && Math.min(r.lessons_attended, cls.total_lessons || 12) >= oneThird
      );
      const validCount = validStudents.length;

      // 计算续读（使用修正后的上课课时）
      const renewedInClass = validStudents.filter((r) =>
        targetStudentIds.has(r.student_id)
      ).length;

      const grade = extractGradeFromClassName(cls.name);

      return {
        class_id: cls.id,
        class_name: cls.name,
        grade,
        total_lessons: cls.total_lessons,
        total_students: totalStudents,
        valid_students: validCount,
        renewed_students: renewedInClass,
        renewal_rate: validCount > 0 ? ((renewedInClass / validCount) * 100).toFixed(1) + '%' : '0%',
      };
    });

    // 按年级汇总（同一源学期下所有班级按年级聚合）
    const gradeAgg = new Map<
      string,
      { class_count: number; valid_students: number; renewed_students: number }
    >();
    for (const row of classStats) {
      const g = row.grade;
      const prev = gradeAgg.get(g) ?? {
        class_count: 0,
        valid_students: 0,
        renewed_students: 0,
      };
      prev.class_count += 1;
      prev.valid_students += row.valid_students;
      prev.renewed_students += row.renewed_students;
      gradeAgg.set(g, prev);
    }
    const grade_stats = [...gradeAgg.entries()]
      .map(([grade, v]) => ({
        grade,
        class_count: v.class_count,
        valid_students: v.valid_students,
        renewed_students: v.renewed_students,
        renewal_rate:
          v.valid_students > 0
            ? ((v.renewed_students / v.valid_students) * 100).toFixed(1) + '%'
            : '0%',
      }))
      .sort((a, b) => compareGradeLabels(a.grade, b.grade));

    // 8. 计算总续班率
    const validTotal = validSourceStudentIds.size;
    const renewalRate = validTotal > 0 ? (renewedCount / validTotal) * 100 : 0;

    return NextResponse.json({
      data: {
        from_term:
          fromTermLabel ||
          (sourceIds.length > 0
            ? [...new Set((sourceClasses || []).map((c) => c.term))].join('、')
            : sourceTerms.join('、')),
        to_term:
          toTermLabel ||
          (targetIds.length > 0
            ? [...new Set((targetClasses || []).map((c) => c.term))].join('、')
            : targetTerms.join('、')),
        source_class_count: sourceClasses.length,
        source_total_students: sourceRecords?.length || 0,
        valid_students: validTotal,
        renewed_students: renewedCount,
        not_renewed_students: validTotal - renewedCount,
        new_students: newStudentDetails.length,
        renewal_rate: renewalRate.toFixed(1) + '%',
        renewed_details: renewedDetails,
        not_renewed_details: notRenewedDetails,
        new_student_details: newStudentDetails,
        class_stats: classStats,
        grade_stats,
      },
    });
  } catch (error: unknown) {
    console.error('续班率统计失败:', error);
    const message = error instanceof Error ? error.message : '统计失败';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

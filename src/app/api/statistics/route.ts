import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseClient } from '@/storage/database/supabase-client';
import { compareGradeLabels, extractGradeFromClassName } from '@/lib/class-grade';
import { effectiveRowTotalLessons } from '@/lib/roster-columns';
import { isWithdrawalRemark } from '@/lib/withdraw-remark';

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

type SourceRecordRow = {
  class_id: string;
  student_id: string;
  is_half_free: boolean;
  lessons_attended: number;
  remark?: string | null;
  sheet_total_lessons?: number | null;
  students?: { name?: string } | { name?: string }[] | null;
  classes?: { name?: string; total_lessons?: number } | { name?: string; total_lessons?: number }[] | null;
};

function rowClassTotal(record: SourceRecordRow): number {
  return pickTotalLessonsField(record.classes, 12);
}

/** 该条点名是否计为「有效生源」（半免/退费退班/不足 1/3 排除） */
function sourceRecordMeetsValidCohort(record: SourceRecordRow): boolean {
  if (record.is_half_free) return false;
  if (isWithdrawalRemark(record.remark)) return false;
  const classTotal = rowClassTotal(record);
  const eff = effectiveRowTotalLessons(record.sheet_total_lessons, classTotal);
  const oneThird = Math.ceil(eff / 3);
  const lessonsAttended = Math.min(record.lessons_attended, eff);
  return lessonsAttended >= oneThird;
}

function validStudentIdsInClassSubset(records: SourceRecordRow[], classIdSubset: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const record of records) {
    if (!classIdSubset.has(record.class_id)) continue;
    if (!sourceRecordMeetsValidCohort(record)) continue;
    out.add(record.student_id);
  }
  return out;
}

function studentIdsWithAnyRecordInSubset(records: SourceRecordRow[], classIdSubset: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const record of records) {
    if (classIdSubset.has(record.class_id)) out.add(record.student_id);
  }
  return out;
}

function intersectSets(sets: Set<string>[]): Set<string> {
  if (sets.length === 0) return new Set();
  const [first, ...rest] = sets;
  const out = new Set<string>();
  outer: for (const id of first) {
    for (const s of rest) {
      if (!s.has(id)) continue outer;
    }
    out.add(id);
  }
  return out;
}

function pickClassDisplayName(
  record: SourceRecordRow,
  sourceClassNameById: Map<string, string>
): string {
  const joined = record.classes as { name?: string } | { name?: string }[] | null | undefined;
  if (joined) {
    if (Array.isArray(joined)) return joined[0]?.name || '';
    return joined.name || '';
  }
  return sourceClassNameById.get(record.class_id) || '';
}

/**
 * 双源（秋+寒 / 春+暑）名单里的「源班级」展示：按阶段分组，汇总该生在每阶段出现过的全部班级
 *（含退费/退班备注行，只要在该阶段源班有点名册即展示，与是否计入有效生源无关）。
 */
function dualPhaseSourceClassLabel(
  studentId: string,
  records: SourceRecordRow[],
  phaseGroups: Set<string>[],
  sourceClassNameById: Map<string, string>
): string {
  const phaseLabels: string[] = [];
  for (const gset of phaseGroups) {
    const names = new Set<string>();
    for (const r of records) {
      if (r.student_id !== studentId) continue;
      if (!gset.has(r.class_id)) continue;
      const cn = pickClassDisplayName(r, sourceClassNameById);
      if (cn) names.add(cn);
    }
    if (names.size > 0) {
      phaseLabels.push([...names].sort((a, b) => a.localeCompare(b, 'zh-CN')).join('、'));
    }
  }
  return phaseLabels.length > 0 ? phaseLabels.join('；') : '未知班级';
}

type SeasonTag = 'spring' | 'autumn' | 'winter' | 'summer' | 'unknown';

function detectSeasonTagFromClass(term: string, name: string): SeasonTag {
  const t = `${term} ${name}`;
  if (t.includes('春')) return 'spring';
  if (t.includes('秋')) return 'autumn';
  if (t.includes('寒') || t.includes('冬')) return 'winter';
  if (t.includes('暑')) return 'summer';
  return 'unknown';
}

function inferAutumnWinterClassGroups(
  sourceClasses: Array<{ id: string; name: string; term: string }>
): Set<string>[] | null {
  const autumnIds: string[] = [];
  const winterIds: string[] = [];
  for (const c of sourceClasses) {
    const s = detectSeasonTagFromClass(c.term, c.name);
    if (s === 'autumn') autumnIds.push(c.id);
    else if (s === 'winter') winterIds.push(c.id);
  }
  if (autumnIds.length === 0 || winterIds.length === 0) return null;
  return [new Set(autumnIds), new Set(winterIds)];
}

function inferSpringSummerClassGroups(
  sourceClasses: Array<{ id: string; name: string; term: string }>
): Set<string>[] | null {
  const springIds: string[] = [];
  const summerIds: string[] = [];
  for (const c of sourceClasses) {
    const s = detectSeasonTagFromClass(c.term, c.name);
    if (s === 'spring') springIds.push(c.id);
    else if (s === 'summer') summerIds.push(c.id);
  }
  if (springIds.length === 0 || summerIds.length === 0) return null;
  return [new Set(springIds), new Set(summerIds)];
}

/** 名单「源班级」列：双源交集模式用请求分组；否则在目标为春/秋时从源班级列表推断秋+寒 / 春+暑 */
function resolvePhaseGroupsForSourceClassDisplay(
  dualIntersectionMode: boolean,
  normalizedIntersectionGroups: Set<string>[],
  sourceClasses: Array<{ id: string; name: string; term: string }>,
  targetClasses: Array<{ id: string; name: string; term: string }>
): Set<string>[] | null {
  if (dualIntersectionMode && normalizedIntersectionGroups.length >= 2) {
    return normalizedIntersectionGroups;
  }
  const targetTags = new Set(
    (targetClasses || []).map((c) => detectSeasonTagFromClass(c.term, c.name))
  );
  if (targetTags.has('spring')) {
    const aw = inferAutumnWinterClassGroups(sourceClasses || []);
    if (aw) return aw;
  }
  if (targetTags.has('autumn')) {
    const ss = inferSpringSummerClassGroups(sourceClasses || []);
    if (ss) return ss;
  }
  return null;
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
      sourceIntersectionGroups: sourceIntersectionGroupsParam,
      dualSourceCohortLabel: dualSourceCohortLabelParam,
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
          not_renewed_students: 0,
          returnee_renewed_count: 0,
          renewed_details: [],
          not_renewed_details: [],
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

    const records = (sourceRecords || []) as SourceRecordRow[];
    const sourceClassIdSet = new Set(sourceClassIds);

    const rawIntersection = Array.isArray(sourceIntersectionGroupsParam) ? sourceIntersectionGroupsParam : [];
    const sourceIntersectionGroups = rawIntersection
      .filter((g: unknown): g is string[] => Array.isArray(g))
      .map((g) => [...new Set(g.filter((id): id is string => Boolean(id)))])
      .filter((g) => g.length > 0);
    const normalizedIntersectionGroups =
      sourceIntersectionGroups.length >= 2
        ? sourceIntersectionGroups.map((ids) => new Set(ids.filter((id) => sourceClassIdSet.has(id))))
        : [];
    const dualIntersectionMode =
      normalizedIntersectionGroups.length >= 2 && normalizedIntersectionGroups.every((s) => s.size > 0);
    const dualSourceCohortLabel =
      typeof dualSourceCohortLabelParam === 'string' && dualSourceCohortLabelParam.trim()
        ? dualSourceCohortLabelParam.trim()
        : '两阶段联合';

    const presenceByGroup = dualIntersectionMode
      ? normalizedIntersectionGroups.map((gset) => studentIdsWithAnyRecordInSubset(records, gset))
      : [];
    const intersectionPresence = dualIntersectionMode ? intersectSets(presenceByGroup) : new Set<string>();

    const phaseGroupsForDisplay = resolvePhaseGroupsForSourceClassDisplay(
      dualIntersectionMode,
      normalizedIntersectionGroups,
      sourceClasses || [],
      targetClasses || []
    );

    // 4. 计算源学期有效学生（排除半免 + 上课不足 1/3）；双阶段口径为各阶段均有效者的交集
    const validSourceStudentIds = new Set<string>();
    const sourceStudentDetails: Record<string, { name: string; lessons_attended: number; total_lessons: number }> =
      {};

    if (dualIntersectionMode) {
      const validPerGroup = normalizedIntersectionGroups.map((gset) =>
        validStudentIdsInClassSubset(records, gset)
      );
      for (const id of intersectSets(validPerGroup)) {
        validSourceStudentIds.add(id);
      }
    } else {
      for (const record of records) {
        if (!sourceRecordMeetsValidCohort(record)) continue;
        const sid = record.student_id;
        validSourceStudentIds.add(sid);
        const classTotal = rowClassTotal(record);
        const eff = effectiveRowTotalLessons(record.sheet_total_lessons, classTotal);
        const lessonsAttended = Math.min(record.lessons_attended, eff);
        const prev = sourceStudentDetails[sid];
        const name = pickNameField(record.students);
        if (!prev || lessonsAttended > prev.lessons_attended) {
          sourceStudentDetails[sid] = {
            name,
            lessons_attended: lessonsAttended,
            total_lessons: eff,
          };
        } else if (!prev.name || prev.name === '未知') {
          sourceStudentDetails[sid] = { ...prev, name: name || prev.name };
        }
      }
    }

    if (dualIntersectionMode) {
      for (const sid of validSourceStudentIds) {
        let name = '未知';
        let maxLessons = 0;
        let maxTotal = 12;
        for (const record of records) {
          if (record.student_id !== sid) continue;
          if (!sourceRecordMeetsValidCohort(record)) continue;
          const classTotal = rowClassTotal(record);
          const eff = effectiveRowTotalLessons(record.sheet_total_lessons, classTotal);
          const lessonsAttended = Math.min(record.lessons_attended, eff);
          name = pickNameField(record.students) || name;
          if (lessonsAttended > maxLessons) maxLessons = lessonsAttended;
          if (eff > maxTotal) maxTotal = eff;
        }
        sourceStudentDetails[sid] = { name, lessons_attended: maxLessons, total_lessons: maxTotal };
      }
    }

    // 5. 获取所有目标班级的学生点名记录（含班级，用于续报至哪班）
    const targetClassIds = targetClasses.map((c) => c.id);
    const targetStudentIds = new Set<string>();
    const targetClassNameById = new Map<string, string>(
      (targetClasses || []).map((c) => [c.id, c.name])
    );
    const renewedToClassNamesByStudent = new Map<string, Set<string>>();
    const targetStudentDetails = new Map<string, { name: string; lessons_attended: number; total_lessons: number }>();
    type TargetEnrollmentLabel = '半免' | '退费' | '正常';
    const targetEnrollmentStatus = new Map<string, TargetEnrollmentLabel>();
    const rankEnrollmentLabel = (s: TargetEnrollmentLabel) => (s === '半免' ? 3 : s === '退费' ? 2 : 1);

    if (targetClasses.length > 0) {
      const { data: targetRecords, error: targetRecordsError } = await supabase
        .from('attendance_records')
        .select(
          'student_id, class_id, lessons_attended, sheet_total_lessons, is_half_free, remark, students(name), classes(total_lessons)'
        )
        .in('class_id', targetClassIds);

      if (targetRecordsError) throw new Error(`获取目标班级记录失败: ${targetRecordsError.message}`);

      for (const record of targetRecords || []) {
        const rowLabel: TargetEnrollmentLabel = record.is_half_free
          ? '半免'
          : isWithdrawalRemark((record as { remark?: string | null }).remark)
            ? '退费'
            : '正常';
        const prevLabel = targetEnrollmentStatus.get(record.student_id);
        if (!prevLabel || rankEnrollmentLabel(rowLabel) > rankEnrollmentLabel(prevLabel)) {
          targetEnrollmentStatus.set(record.student_id, rowLabel);
        }

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
          const classTotal = pickTotalLessonsField(
            record.classes as { total_lessons?: number } | { total_lessons?: number }[] | null,
            12
          );
          const eff = effectiveRowTotalLessons(
            (record as { sheet_total_lessons?: number | null }).sheet_total_lessons,
            classTotal
          );
          targetStudentDetails.set(record.student_id, {
            name: pickNameField(record.students as { name?: string } | { name?: string }[] | null),
            lessons_attended: Math.min(record.lessons_attended, eff),
            total_lessons: eff,
          });
        }
      }
    }

    const getRenewedToClassLabel = (studentId: string): string => {
      const set = renewedToClassNamesByStudent.get(studentId);
      if (!set || set.size === 0) return '';
      return [...set].sort((a, b) => a.localeCompare(b, 'zh-CN')).join('、');
    };

    // 6. 计算续读学生和未续读学生（含：源学期退费/退班但新学期又点名的「回流续读」）
    let renewedStrictCount = 0;
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
      /** 源学期为退费/退班备注，新学期仍出现 */
      returnee_after_withdraw?: boolean;
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
      /** 目标学期名单状态：半免 / 退费（备注含退费等）/ 正常；多班取优先级最高的一条 */
      enrollment_status?: '半免' | '退费' | '正常';
    }[] = [];

    // 获取学生对应的班级信息（续读/未续读名单中的「源班级」展示）
    const studentClassMap: Record<string, string> = {};
    if (phaseGroupsForDisplay) {
      for (const sid of validSourceStudentIds) {
        studentClassMap[sid] = dualPhaseSourceClassLabel(
          sid,
          records,
          phaseGroupsForDisplay,
          sourceClassNameById
        );
      }
    } else {
      for (const record of records) {
        if (!sourceRecordMeetsValidCohort(record)) continue;
        const cn = pickClassDisplayName(record, sourceClassNameById);
        if (cn) studentClassMap[record.student_id] = cn;
      }
    }

    for (const studentId of validSourceStudentIds) {
      if (targetStudentIds.has(studentId)) {
        renewedStrictCount++;
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

    const returneePushed = new Set<string>();
    for (const record of records) {
      if (record.is_half_free) continue;
      if (!isWithdrawalRemark(record.remark)) continue;
      if (!targetStudentIds.has(record.student_id)) continue;
      if (dualIntersectionMode && !intersectionPresence.has(record.student_id)) continue;
      if (validSourceStudentIds.has(record.student_id)) continue;
      if (returneePushed.has(record.student_id)) continue;
      returneePushed.add(record.student_id);

      const classTotal = rowClassTotal(record);
      const eff = effectiveRowTotalLessons(
        (record as { sheet_total_lessons?: number | null }).sheet_total_lessons,
        classTotal
      );
      const lessonsAttended = Math.min(record.lessons_attended, eff);
      renewedCount++;
      renewedDetails.push({
        student_id: record.student_id,
        name: pickNameField(record.students),
        lessons_attended: lessonsAttended,
        total_lessons: eff,
        class_name: phaseGroupsForDisplay
          ? dualPhaseSourceClassLabel(
              record.student_id,
              records,
              phaseGroupsForDisplay,
              sourceClassNameById
            )
          : pickClassDisplayName(record, sourceClassNameById) || '未知班级',
        source_term: sourceTerms.join('、'),
        renewed_to_class: getRenewedToClassLabel(record.student_id),
        target_term: targetTerms.join('、'),
        returnee_after_withdraw: true,
      });
    }

    // 纯新生（与续班率「源/统计口径」无关）：出现在本次统计所选「目标班级」点名中，且在全库已上传的任意「非目标班级」中无任何点名记录
    const targetClassIdSetForPureNew = new Set(targetClassIds);
    const studentsWithNonTargetAttendance = new Set<string>();
    const { data: allClassRows, error: allClsErr } = await supabase.from('classes').select('id');
    if (!allClsErr && allClassRows?.length) {
      const nonTargetClassIds = allClassRows.map((c) => c.id).filter((id) => !targetClassIdSetForPureNew.has(id));
      const chunkSize = 300;
      for (let i = 0; i < nonTargetClassIds.length; i += chunkSize) {
        const chunk = nonTargetClassIds.slice(i, i + chunkSize);
        const { data: nonTgtRecs, error: ntErr } = await supabase
          .from('attendance_records')
          .select('student_id')
          .in('class_id', chunk);
        if (ntErr) continue;
        for (const r of nonTgtRecs || []) studentsWithNonTargetAttendance.add(r.student_id as string);
      }
    }

    // 6.5 计算新生：目标班级有点名，且全库无非目标班级的点名
    for (const studentId of targetStudentIds) {
      if (studentsWithNonTargetAttendance.has(studentId)) continue;
      const detail = targetStudentDetails.get(studentId);
      if (!detail) continue;
      newStudentDetails.push({
        student_id: studentId,
        name: detail.name,
        lessons_attended: detail.lessons_attended,
        total_lessons: detail.total_lessons,
        class_name: getRenewedToClassLabel(studentId) || '未知班级',
        target_term: targetTerms.join('、'),
        enrollment_status: targetEnrollmentStatus.get(studentId) ?? '正常',
      });
    }

    // 7. 统计每个源班级 / 双阶段联合按年级 cohort
    const inferStudentGradeFromSource = (studentId: string): string => {
      for (const record of records) {
        if (record.student_id !== studentId) continue;
        if (!sourceClassIdSet.has(record.class_id)) continue;
        const cn = pickClassDisplayName(record, sourceClassNameById);
        if (cn) {
          const g = extractGradeFromClassName(cn);
          if (g) return g;
        }
      }
      return '未标注年级';
    };

    let classStats: Array<{
      class_id: string;
      class_name: string;
      grade?: string;
      total_lessons: number;
      total_students: number;
      valid_students: number;
      renewed_students: number;
      renewal_rate: string;
    }>;

    if (dualIntersectionMode) {
      type GradeBucket = {
        presence: Set<string>;
        valid: Set<string>;
        renewedStrict: Set<string>;
        returnees: Set<string>;
      };
      const gradeBuckets = new Map<string, GradeBucket>();
      const getBucket = (g: string): GradeBucket => {
        let b = gradeBuckets.get(g);
        if (!b) {
          b = { presence: new Set(), valid: new Set(), renewedStrict: new Set(), returnees: new Set() };
          gradeBuckets.set(g, b);
        }
        return b;
      };

      for (const sid of intersectionPresence) {
        const g = inferStudentGradeFromSource(sid);
        getBucket(g).presence.add(sid);
      }
      for (const sid of validSourceStudentIds) {
        const g = inferStudentGradeFromSource(sid);
        const b = getBucket(g);
        b.valid.add(sid);
        if (targetStudentIds.has(sid)) b.renewedStrict.add(sid);
      }
      for (const sid of returneePushed) {
        const g = inferStudentGradeFromSource(sid);
        getBucket(g).returnees.add(sid);
      }

      classStats = [...gradeBuckets.entries()]
        .filter(([, b]) => b.presence.size > 0 || b.valid.size > 0)
        .map(([grade, b]) => {
          const validC = b.valid.size;
          const renewedC = b.renewedStrict.size + b.returnees.size;
          return {
            class_id: `cohort:${grade}`,
            class_name: `${grade}（${dualSourceCohortLabel}）`,
            grade,
            total_lessons: 12,
            total_students: b.presence.size,
            valid_students: validC,
            renewed_students: renewedC,
            renewal_rate: validC > 0 ? ((renewedC / validC) * 100).toFixed(1) + '%' : '0%',
          };
        })
        .sort((a, b) => compareGradeLabels(a.grade ?? '', b.grade ?? ''));
    } else {
      classStats = sourceClasses.map((cls) => {
        const classRecords = records.filter((r) => r.class_id === cls.id);
        const totalStudents = classRecords.length;

        const clsTotal = cls.total_lessons || 12;
        const validStudents = classRecords.filter((r) => {
          if (r.is_half_free) return false;
          if (isWithdrawalRemark(r.remark)) return false;
          const eff = effectiveRowTotalLessons(r.sheet_total_lessons, clsTotal);
          const oneThird = Math.ceil(eff / 3);
          return Math.min(r.lessons_attended, eff) >= oneThird;
        });
        const validCount = validStudents.length;

        const renewedStrictInClass = validStudents.filter((r) => targetStudentIds.has(r.student_id)).length;
        const returneeIdSet = new Set(
          classRecords
            .filter(
              (r) =>
                !r.is_half_free &&
                isWithdrawalRemark(r.remark) &&
                targetStudentIds.has(r.student_id) &&
                !validSourceStudentIds.has(r.student_id)
            )
            .map((r) => r.student_id)
        );
        const renewedInClass = renewedStrictInClass + returneeIdSet.size;

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
    }

    // 按年级汇总（同一源学期下所有班级按年级聚合）
    const gradeAgg = new Map<
      string,
      { class_count: number; valid_students: number; renewed_students: number }
    >();
    for (const row of classStats) {
      const g = row.grade ?? '未标注年级';
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

    // 8. 计算总续班率（续读含回流时，续班率可能高于 100%，因分母仍为「有效生源」）
    const validTotal = validSourceStudentIds.size;
    const returneeRenewedCount = returneePushed.size;
    const notRenewedFromValid = validTotal - renewedStrictCount;
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
        source_total_students: dualIntersectionMode
          ? intersectionPresence.size
          : new Set(records.map((r) => r.student_id)).size,
        valid_students: validTotal,
        renewed_students: renewedCount,
        not_renewed_students: notRenewedFromValid,
        returnee_renewed_count: returneeRenewedCount,
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

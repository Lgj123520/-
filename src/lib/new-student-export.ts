/** 新生名单 CSV：与统计页导出列一致（含名单状态），供前端与 API 共用 */

export type NewStudentExportRow = {
  name: string;
  class_name?: string;
  enrollment_status?: string;
  lessons_attended: number;
  total_lessons: number;
};

function csvEscapeCell(cell: string | number): string {
  return `"${String(cell).replace(/"/g, '""')}"`;
}

export function buildNewStudentListCsv(rows: NewStudentExportRow[]): string {
  const BOM = '\uFEFF';
  const headers = ['序号', '姓名', '目标班级', '名单状态', '已上课时', '总课时', '出勤率'];
  const headerLine = headers.map(csvEscapeCell).join(',');
  const bodyLines = rows.map((student, index) => {
    const tl = Math.max(1, Number(student.total_lessons) || 1);
    const attended = Number(student.lessons_attended) || 0;
    return [
      index + 1,
      student.name,
      student.class_name || '未知班级',
      student.enrollment_status || '正常',
      attended,
      student.total_lessons,
      `${((attended / tl) * 100).toFixed(1)}%`,
    ]
      .map(csvEscapeCell)
      .join(',');
  });
  return BOM + [headerLine, ...bodyLines].join('\n');
}

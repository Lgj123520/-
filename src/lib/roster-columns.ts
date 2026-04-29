/**
 * 点名册表头列识别：区分「总课时」与「已上课时 / 考勤」等列，避免「总课时」因含「课时」被误判为出勤列。
 */

export type RosterColumnIndexes = {
  nameIndex: number;
  /** 已上课时、考勤、出勤等 */
  attendedIndex: number;
  /** 表内「总课时」列，用于推断班级 total_lessons；-1 表示无 */
  totalLessonsColumnIndex: number;
  remarkIndex: number;
  halfFreeIndex: number;
};

/**
 * 表头规范化：去 BOM、去首尾空白，并去掉中间空格（Excel 常见「总 课时」「考 勤」导致关键词匹配失败）。
 */
function headerNorm(h: string | number | boolean | null | undefined): string {
  return String(h ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[\s\u3000\u00a0]+/g, '')
    .toLowerCase();
}

/** 从单元格解析非负整数课时（兼容全角数字、21节 等） */
export function parseLessonCountCell(value: string | number | boolean | null | undefined): number {
  if (value == null || value === '') return 0;
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.trunc(value));
  let s = String(value)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xff10 + 0x30));
  const m = s.match(/^(\d+)/);
  if (!m) return 0;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * 表头不一定在第 1 行（常见第 1 行为班级标题）。在前若干行中找同时含「姓名」与课时相关列的那一行。
 */
export function findRosterHeaderRowIndex(data: (string | number | boolean | null)[][]): number {
  const maxScan = Math.min(15, data.length);
  for (let r = 0; r < maxScan; r++) {
    const row = data[r];
    if (!row?.length) continue;
    const cells = row.map((c) => headerNorm(c));
    const hasNameCol = cells.some((t) => t.includes('姓名') || t.includes('名字') || t === 'name');
    const hasLessonHint = cells.some(
      (t) =>
        t.includes('课时') ||
        t.includes('课次') ||
        t.includes('考勤') ||
        t.includes('出勤') ||
        t.includes('上课') ||
        t.includes('签到') ||
        t.includes('实到') ||
        /lesson|attend|present/i.test(t)
    );
    if (hasNameCol && hasLessonHint) return r;
  }
  return 0;
}

function isTotalLessonsHeader(h: string): boolean {
  return (
    h.includes('总课时') ||
    h.includes('总课次') ||
    h.includes('计划课时') ||
    h.includes('计划课次') ||
    (h.includes('标准') && h.includes('课时')) ||
    // 「应上课时」等作计划总课时（与「已上课时」区分：已上/实上 不算总）
    (h.includes('应上') && h.includes('课') && !h.includes('已上') && !h.includes('实上'))
  );
}

export function detectRosterColumnIndexes(
  headers: (string | number | boolean | null)[]
): RosterColumnIndexes {
  let nameIndex = -1;
  let totalLessonsColumnIndex = -1;
  let attendedIndex = -1;
  let remarkIndex = -1;
  let halfFreeIndex = -1;

  headers.forEach((header, index) => {
    const h = headerNorm(header);
    if (h.includes('姓名') || h.includes('名字') || h === 'name') {
      nameIndex = index;
    }
  });
  if (nameIndex === -1) nameIndex = 0;

  headers.forEach((header, index) => {
    const h = headerNorm(header);
    if (totalLessonsColumnIndex < 0 && isTotalLessonsHeader(h)) {
      totalLessonsColumnIndex = index;
    }
  });

  // 顺序很重要：先认「考勤 / 出勤 / 签到」等，再认泛化的「上课」「课时」，避免误把「总课时」当出勤列
  const attendedPredicates: ((h: string) => boolean)[] = [
    (h) => h.includes('已上课时') || h.includes('实上课时'),
    (h) => h.includes('上课次数'),
    (h) => h.includes('考勤') && !h.includes('总'),
    (h) => h.includes('出勤次数'),
    (h) => h.includes('出勤') && !h.includes('出勤率'),
    (h) => h.includes('签到') || h.includes('实到'),
    (h) => h.includes('到课'),
    (h) => /lesson|attendance|present/i.test(h),
    (h) => h.includes('上课') && !h.includes('总') && !h.includes('计划'),
    (h) =>
      h.includes('课时') &&
      !h.includes('总') &&
      !h.includes('计划') &&
      !(h.includes('标准') && h.includes('课')),
  ];

  for (const pred of attendedPredicates) {
    for (let i = 0; i < headers.length; i++) {
      if (i === nameIndex) continue;
      const h = headerNorm(headers[i]);
      if (pred(h)) {
        attendedIndex = i;
        break;
      }
    }
    if (attendedIndex >= 0) break;
  }

  if (attendedIndex < 0) {
    for (let i = 0; i < headers.length; i++) {
      if (i === nameIndex || i === totalLessonsColumnIndex || i === remarkIndex || i === halfFreeIndex) continue;
      const h = headerNorm(headers[i]);
      if (!h) continue;
      attendedIndex = i;
      break;
    }
  }
  if (attendedIndex < 0 && totalLessonsColumnIndex >= 0) {
    attendedIndex = totalLessonsColumnIndex;
  }
  if (attendedIndex < 0) {
    attendedIndex = nameIndex === 0 ? 1 : 0;
  }

  headers.forEach((header, index) => {
    const h = headerNorm(header);
    if (
      h.includes('备注') ||
      h.includes('remark') ||
      h.includes('note') ||
      h.includes('说明') ||
      h.includes('标签') ||
      h.includes('类型') ||
      h.includes('学费') ||
      h.includes('缴费') ||
      h.includes('性质')
    ) {
      remarkIndex = index;
    } else if (
      h.includes('半免') ||
      h.includes('优惠') ||
      h.includes('折扣') ||
      h.includes('half')
    ) {
      halfFreeIndex = index;
    }
  });

  return {
    nameIndex,
    attendedIndex,
    totalLessonsColumnIndex,
    remarkIndex,
    halfFreeIndex,
  };
}

/** 从「总课时」列取各班应有总课时：取所有有效行中的最大值（同班应一致）。 */
export function inferTotalLessonsFromSheetColumn(
  data: (string | number | boolean | null)[][],
  colIndex: number,
  startRow = 1
): number | null {
  if (colIndex < 0) return null;
  let maxVal = 0;
  let found = false;
  for (let i = startRow; i < data.length; i++) {
    const row = data[i];
    if (!row || colIndex >= row.length) continue;
    const n = parseLessonCountCell(row[colIndex]);
    if (n <= 0) continue;
    found = true;
    maxVal = Math.max(maxVal, n);
  }
  return found ? maxVal : null;
}

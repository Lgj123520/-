/**
 * 从班级名称中解析「年级」标签，用于续班率按年级分层展示。
 * 命名中若包含「一年级」「高一」「初一」等关键词会优先匹配。
 */
export function extractGradeFromClassName(className: string): string {
  const s = className.trim();
  if (!s) return '未标注年级';

  const ordered = [
    '学前',
    '托班',
    '小班',
    '中班',
    '大班',
    '小学一年级',
    '小学二年级',
    '小学三年级',
    '小学四年级',
    '小学五年级',
    '小学六年级',
    '一年级',
    '二年级',
    '三年级',
    '四年级',
    '五年级',
    '六年级',
    '七年级',
    '八年级',
    '九年级',
    '初一',
    '初二',
    '初三',
    '高一',
    '高二',
    '高三',
  ];

  for (const g of ordered) {
    if (s.includes(g)) return g;
  }

  const m = s.match(/([一二三四五六七八九十两〇零\d]{1,4})年级/);
  if (m) return `${m[1]}年级`;

  return '未标注年级';
}

/** 年级排序：未标注放最后，其余按常见学段顺序近似排序 */
const GRADE_ORDER: Record<string, number> = Object.fromEntries(
  [
    '学前',
    '托班',
    '小班',
    '中班',
    '大班',
    '小学一年级',
    '小学二年级',
    '小学三年级',
    '小学四年级',
    '小学五年级',
    '小学六年级',
    '一年级',
    '二年级',
    '三年级',
    '四年级',
    '五年级',
    '六年级',
    '七年级',
    '八年级',
    '九年级',
    '初一',
    '初二',
    '初三',
    '高一',
    '高二',
    '高三',
  ].map((g, i) => [g, i])
);

export function compareGradeLabels(a: string, b: string): number {
  const oa = GRADE_ORDER[a];
  const ob = GRADE_ORDER[b];
  if (oa !== undefined && ob !== undefined) return oa - ob;
  if (oa !== undefined) return -1;
  if (ob !== undefined) return 1;
  if (a === '未标注年级' && b !== '未标注年级') return 1;
  if (b === '未标注年级' && a !== '未标注年级') return -1;
  return a.localeCompare(b, 'zh-CN');
}

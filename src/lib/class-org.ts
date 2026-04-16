import { compareGradeLabels, extractGradeFromClassName } from '@/lib/class-grade';

/** 班级列表项：至少含 name、term */
export interface ClassLikeForOrg {
  name: string;
  term: string;
}

/**
 * 学年/届次标签排序：优先按名称中出现的首个四位年份降序（新学年靠前），无年份则按中文排序。
 * `term` 字段在库中存的是「学年或届次」标签（如 2025 学年、2024 秋），旧数据也可能是「寒假」等。
 */
export function compareSchoolYearLabels(a: string, b: string): number {
  const firstYear = (s: string): number | null => {
    const m = s.trim().match(/\d{4}/);
    return m ? parseInt(m[0], 10) : null;
  };
  const ya = firstYear(a);
  const yb = firstYear(b);
  if (ya !== null && yb !== null && ya !== yb) return yb - ya;
  if (ya !== null && yb === null) return -1;
  if (ya === null && yb !== null) return 1;
  return a.localeCompare(b, 'zh-CN');
}

export interface YearGradeClassGroup<T extends ClassLikeForOrg = ClassLikeForOrg> {
  term: string;
  grades: { grade: string; classes: T[] }[];
}

/** 按数据库中的 term（学年/届次）分组，再按班级名称解析出的年级分组 */
export function groupClassesBySchoolYearAndGrade<T extends ClassLikeForOrg>(classes: T[]): YearGradeClassGroup<T>[] {
  const terms = [...new Set(classes.map((c) => c.term))];
  terms.sort(compareSchoolYearLabels);

  return terms.map((term) => {
    const termClasses = classes.filter((c) => c.term === term);
    const byGrade = new Map<string, T[]>();
    for (const c of termClasses) {
      const g = extractGradeFromClassName(c.name);
      const list = byGrade.get(g) ?? [];
      list.push(c);
      byGrade.set(g, list);
    }
    const grades = [...byGrade.entries()]
      .sort(([ga], [gb]) => compareGradeLabels(ga, gb))
      .map(([grade, cls]) => ({
        grade,
        classes: cls.sort((x, y) => x.name.localeCompare(y.name, 'zh-CN')),
      }));
    return { term, grades };
  });
}

'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Upload, BarChart3, FileSpreadsheet, CheckCircle2, XCircle, Loader2, Download, UserX, Users, UserCheck, Eye, Trash2, Edit, Search, X, Pencil, LogOut } from 'lucide-react';
import { compareGradeLabels } from '@/lib/class-grade';
import { compareSchoolYearLabels, groupClassesBySchoolYearAndGrade } from '@/lib/class-org';

/** 上传「学年/届次」输入框的下拉建议（可与已有数据合并） */
const SCHOOL_TERM_SUGGESTIONS = [
  '2024学年',
  '2025学年',
  '2026学年',
  '2024秋',
  '2025秋',
  '2024春',
  '2025春',
  '寒假',
  '春季',
  '暑假',
  '秋季',
];

const EXPORT_CLASS_FILTER_ALL = '__all__';

/** 页面日期、文件名中的日期均使用中文区域格式 */
const ZH_LOCALE = 'zh-CN' as const;

function formatZhDate(d: string | number | Date, opts?: Intl.DateTimeFormatOptions): string {
  return new Date(d).toLocaleDateString(ZH_LOCALE, opts ?? { year: 'numeric', month: 'numeric', day: 'numeric' });
}

function sanitizeCsvFilenamePart(s: string): string {
  return s.replace(/[/\\:*?"<>|]/g, '_').trim().slice(0, 80);
}

/** 将常见英文网络错误转为中文，便于用户理解（如未启动 dev 时的 Failed to fetch） */
function clientErrorToZhMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error)) return fallback;
  const m = error.message.trim();
  if (!m) return fallback;
  const ml = m.toLowerCase();
  if (ml === 'failed to fetch' || ml.includes('networkerror') || ml.includes('load failed')) {
    return '无法连接服务器，请确认本地开发服务已启动（在项目目录执行 pnpm dev 或 coze dev）。';
  }
  if (ml.includes('aborted') || ml.includes('abort')) {
    return '请求已中断';
  }
  return m;
}

interface ClassInfo {
  id: string;
  name: string;
  term: string;
  total_lessons: number;
  student_count: number;
  created_at: string;
}

interface ClassStat {
  class_id: string;
  class_name: string;
  grade?: string;
  total_lessons: number;
  total_students: number;
  valid_students: number;
  renewed_students: number;
  renewal_rate: string;
}

interface GradeStat {
  grade: string;
  class_count: number;
  valid_students: number;
  renewed_students: number;
  renewal_rate: string;
}

interface StudentDetail {
  student_id: string;
  name: string;
  lessons_attended: number;
  total_lessons: number;
  class_name?: string;
  /** 续读学生所在目标学年班级名称，多班用顿号连接 */
  renewed_to_class?: string;
}

interface RenewalResult {
  from_term: string;
  to_term: string;
  source_class_count: number;
  source_total_students: number;
  valid_students: number;
  renewed_students: number;
  not_renewed_students: number;
  renewal_rate: string;
  renewed_details: StudentDetail[];
  not_renewed_details: StudentDetail[];
  class_stats: ClassStat[];
  grade_stats?: GradeStat[];
}

interface SimilarName {
  winter_student_id: string;
  winter_name: string;
  winter_class: string;
  spring_names: Array<{ student_id: string; name: string; similarity: number }>;
  is_renewed: boolean;
}

interface SimilarNamesResult {
  from_term: string;
  to_term: string;
  total_similar: number;
  similar_names: SimilarName[];
}

interface ClassDetail {
  id: string;
  student_id: string;
  name: string;
  lessons_attended: number;
  is_half_free: boolean;
  is_excluded: boolean;
  remark: string;
}

interface ClassWithStudents {
  class: {
    id: string;
    name: string;
    term: string;
    total_lessons: number;
    created_at?: string;
  };
  students: ClassDetail[];
}

interface EditedStudent {
  record_id: string;
  lessons_attended: number;
  is_half_free: boolean;
}

interface AuthUser {
  id: string;
  account?: string;
  email?: string;
  role?: 'admin' | 'assistant';
}

export default function Home() {
  const [authChecking, setAuthChecking] = useState(true);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [authSubmitting, setAuthSubmitting] = useState(false);
  const [authEmail, setAuthEmail] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [registerRole, setRegisterRole] = useState<'admin' | 'assistant'>('assistant');
  const [showChangePassword, setShowChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCreateAssistant, setShowCreateAssistant] = useState(false);
  const [assistantEmail, setAssistantEmail] = useState('');
  const [assistantPassword, setAssistantPassword] = useState('');

  const [activeTab, setActiveTab] = useState('upload');
  const [classes, setClasses] = useState<ClassInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // 上传表单
  const [file, setFile] = useState<File | null>(null);
  const [className, setClassName] = useState('');
  const [term, setTerm] = useState('');
  const [totalLessons, setTotalLessons] = useState('12');
  const [uploading, setUploading] = useState(false);

  // 统计表单
  const [fromTerm, setFromTerm] = useState('');
  const [toTerm, setToTerm] = useState('');
  const [result, setResult] = useState<RenewalResult | null>(null);
  const [calculating, setCalculating] = useState(false);
  /** 续读名单导出：按源班级 / 续读目标班级筛选 */
  const [renewedExportSourceClass, setRenewedExportSourceClass] = useState<string>(EXPORT_CLASS_FILTER_ALL);
  const [renewedExportTargetClass, setRenewedExportTargetClass] = useState<string>(EXPORT_CLASS_FILTER_ALL);
  /** 未续班名单导出：按源班级筛选 */
  const [notRenewedExportSourceClass, setNotRenewedExportSourceClass] = useState<string>(EXPORT_CLASS_FILTER_ALL);

  // 相似姓名匹配
  const [matchFromTerm, setMatchFromTerm] = useState('');
  const [matchToTerm, setMatchToTerm] = useState('');
  const [similarNames, setSimilarNames] = useState<SimilarNamesResult | null>(null);
  const [searchingSimilar, setSearchingSimilar] = useState(false);
  const [selectedMatches, setSelectedMatches] = useState<Map<string, string>>(new Map());
  const [matching, setMatching] = useState(false);

  // 班级详情弹窗
  const [showClassDetail, setShowClassDetail] = useState(false);
  const [selectedClass, setSelectedClass] = useState<ClassWithStudents | null>(null);
  const [loadingClassDetail, setLoadingClassDetail] = useState(false);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const [editingStudentId, setEditingStudentId] = useState<string | null>(null);
  const [editedStudent, setEditedStudent] = useState<EditedStudent | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [studentFilter, setStudentFilter] = useState<'all' | 'normal' | 'excluded'>('all');
  const [lessonDrafts, setLessonDrafts] = useState<Record<string, string>>({});
  const [batchLessonInput, setBatchLessonInput] = useState('');
  const [batchApplying, setBatchApplying] = useState(false);

  // 编辑班级
  const [showEditClass, setShowEditClass] = useState(false);
  const [editingClass, setEditingClass] = useState<ClassInfo | null>(null);
  const [editClassName, setEditClassName] = useState('');
  const [editClassLessons, setEditClassLessons] = useState('');
  const [savingClass, setSavingClass] = useState(false);

  useEffect(() => {
    const checkAuth = async () => {
      setAuthChecking(true);
      try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (res.ok && data.authenticated) {
          setAuthUser(data.user);
          await fetchClasses();
        } else {
          setAuthUser(null);
        }
      } catch (error) {
        console.error('获取登录状态失败', error);
        setAuthUser(null);
      } finally {
        setAuthChecking(false);
      }
    };
    void checkAuth();
  }, []);

  useEffect(() => {
    if (!selectedClass?.class.id) return;
    setLessonDrafts({});
    setBatchLessonInput('');
  }, [selectedClass?.class.id]);

  /** 按年级分组后的班级续班率，用于首页与统计表格展示 */
  const groupClassStatsByGrade = useMemo(() => {
    if (!result?.class_stats?.length) return [] as { grade: string; rows: ClassStat[] }[];
    const map = new Map<string, ClassStat[]>();
    for (const row of result.class_stats) {
      const g = row.grade ?? '未标注年级';
      const list = map.get(g) ?? [];
      list.push(row);
      map.set(g, list);
    }
    return [...map.entries()]
      .sort(([a], [b]) => compareGradeLabels(a, b))
      .map(([grade, rows]) => ({ grade, rows }));
  }, [result]);

  /** 按年级汇总；若 API 返回 grade_stats 则优先使用该数据 */
  const gradeSummary = useMemo((): GradeStat[] => {
    if (result?.grade_stats && result.grade_stats.length > 0) {
      return result.grade_stats;
    }
    if (!groupClassStatsByGrade.length) return [];
    return groupClassStatsByGrade.map(({ grade, rows }) => {
      const valid = rows.reduce((s, r) => s + r.valid_students, 0);
      const renewed = rows.reduce((s, r) => s + r.renewed_students, 0);
      return {
        grade,
        class_count: rows.length,
        valid_students: valid,
        renewed_students: renewed,
        renewal_rate: valid > 0 ? ((renewed / valid) * 100).toFixed(1) + '%' : '0%',
      };
    });
  }, [result?.grade_stats, groupClassStatsByGrade]);

  useEffect(() => {
    if (!result) return;
    setRenewedExportSourceClass(EXPORT_CLASS_FILTER_ALL);
    setRenewedExportTargetClass(EXPORT_CLASS_FILTER_ALL);
    setNotRenewedExportSourceClass(EXPORT_CLASS_FILTER_ALL);
  }, [result]);

  const renewedExportSourceOptions = useMemo(() => {
    if (!result?.renewed_details?.length) return [];
    const s = new Set<string>();
    for (const d of result.renewed_details) {
      if (d.class_name) s.add(d.class_name);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [result?.renewed_details]);

  const renewedExportTargetOptions = useMemo(() => {
    if (!result?.renewed_details?.length) return [];
    const s = new Set<string>();
    for (const d of result.renewed_details) {
      const parts = (d.renewed_to_class || '').split('、').map((x) => x.trim()).filter(Boolean);
      for (const p of parts) s.add(p);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [result?.renewed_details]);

  const notRenewedExportSourceOptions = useMemo(() => {
    if (!result?.not_renewed_details?.length) return [];
    const s = new Set<string>();
    for (const d of result.not_renewed_details) {
      if (d.class_name) s.add(d.class_name);
    }
    return [...s].sort((a, b) => a.localeCompare(b, 'zh-CN'));
  }, [result?.not_renewed_details]);

  const filteredRenewedDetails = useMemo(() => {
    if (!result?.renewed_details) return [];
    return result.renewed_details.filter((d) => {
      if (renewedExportSourceClass !== EXPORT_CLASS_FILTER_ALL && d.class_name !== renewedExportSourceClass) {
        return false;
      }
      if (renewedExportTargetClass !== EXPORT_CLASS_FILTER_ALL) {
        const parts = (d.renewed_to_class || '').split('、').map((x) => x.trim());
        if (!parts.includes(renewedExportTargetClass)) return false;
      }
      return true;
    });
  }, [result?.renewed_details, renewedExportSourceClass, renewedExportTargetClass]);

  const filteredNotRenewedDetails = useMemo(() => {
    if (!result?.not_renewed_details) return [];
    return result.not_renewed_details.filter((d) => {
      if (notRenewedExportSourceClass !== EXPORT_CLASS_FILTER_ALL && d.class_name !== notRenewedExportSourceClass) {
        return false;
      }
      return true;
    });
  }, [result?.not_renewed_details, notRenewedExportSourceClass]);

  const fetchClasses = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/roster');
      const data = await res.json();
      if (res.status === 401) {
        setAuthUser(null);
        setMessage({ type: 'error', text: '登录已过期，请重新登录' });
        return;
      }
      if (data.data) {
        setClasses(data.data);
      }
    } catch (error) {
      console.error('未知班级列表失败:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleAuthSubmit = async () => {
    if (authMode === 'forgot') {
      await handleForgotPassword();
      return;
    }
    if (!authEmail.trim() || !authPassword.trim()) {
      setMessage({ type: 'error', text: '请输入账号和密码' });
      return;
    }
    setAuthSubmitting(true);
    setMessage(null);
    try {
      const endpoint = authMode === 'login' ? '/api/auth/login' : '/api/auth/register';
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: authEmail.trim(),
          password: authPassword,
          role: authMode === 'register' ? registerRole : undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || '登录失败' });
        return;
      }

      if (data.needs_email_confirm) {
        setMessage({ type: 'success', text: data.message || '注册成功，请先验证邮箱后再登录。' });
        setAuthMode('login');
        return;
      }

      setAuthUser(data.user);
      setMessage({ type: 'success', text: authMode === 'login' ? '登录成功' : '注册并登录成功' });
      setAuthPassword('');
      await fetchClasses();
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '登录失败') });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleForgotPassword = async () => {
    if (!authEmail.trim()) {
      setMessage({ type: 'error', text: '请输入注册邮箱（账号用户请联系管理员）' });
      return;
    }
    setAuthSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: authEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || '发送失败' });
        return;
      }
      setMessage({ type: 'success', text: data.message || '重置邮件已发送，请查收邮箱。' });
      setAuthMode('login');
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '发送失败') });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword.trim() || !newPassword.trim()) {
      setMessage({ type: 'error', text: '请输入当前密码和新密码' });
      return;
    }
    setAuthSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || '修改密码失败' });
        return;
      }
      setMessage({ type: 'success', text: data.message || '密码修改成功' });
      setCurrentPassword('');
      setNewPassword('');
      setShowChangePassword(false);
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '修改密码失败') });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleCreateAssistant = async () => {
    if (!assistantEmail.trim() || !assistantPassword.trim()) {
      setMessage({ type: 'error', text: '请输入助教账号和密码' });
      return;
    }
    setAuthSubmitting(true);
    setMessage(null);
    try {
      const res = await fetch('/api/auth/create-assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: assistantEmail.trim(), password: assistantPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage({ type: 'error', text: data.error || '创建助教账号失败' });
        return;
      }
      setMessage({ type: 'success', text: `已创建助教账号：${data.user?.account || assistantEmail.trim()}` });
      setAssistantEmail('');
      setAssistantPassword('');
      setShowCreateAssistant(false);
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '创建助教账号失败') });
    } finally {
      setAuthSubmitting(false);
    }
  };

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthUser(null);
      setClasses([]);
      setResult(null);
      setSimilarNames(null);
      setMessage({ type: 'success', text: '已退出登录' });
    }
  };

  const existingTerms = useMemo(
    () => [...new Set(classes.map((c) => c.term))].sort(compareSchoolYearLabels),
    [classes]
  );

  const classesByYearAndGrade = useMemo(() => groupClassesBySchoolYearAndGrade(classes), [classes]);

  const termInputSuggestions = useMemo(() => {
    const s = new Set<string>([...SCHOOL_TERM_SUGGESTIONS, ...existingTerms]);
    return [...s].sort(compareSchoolYearLabels);
  }, [existingTerms]);

  useEffect(() => {
    if (!fromTerm) return;
    if (toTerm === fromTerm) {
      const next = existingTerms.find((t) => t !== fromTerm);
      setToTerm(next ?? '');
    }
  }, [fromTerm, existingTerms, toTerm]);

  useEffect(() => {
    if (!matchFromTerm) return;
    if (matchToTerm === matchFromTerm) {
      const next = existingTerms.find((t) => t !== matchFromTerm);
      setMatchToTerm(next ?? '');
    }
  }, [matchFromTerm, existingTerms, matchToTerm]);

  // 上传点名册
  const handleUpload = async () => {
    if (!file || !className || !term) {
      setMessage({ type: 'error', text: '请填写完整信息并选择文件' });
      return;
    }

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append('file', file);
    formData.append('className', className);
    formData.append('term', term);
    formData.append('totalLessons', totalLessons);

    try {
      const res = await fetch('/api/roster', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        const msg = data.data.is_update
          ? `已更新！${data.data.class_name} 现共包含 ${data.data.student_count} 名学生`
          : `上传成功！已导入 ${data.data.student_count} 名学生`;
        setMessage({ type: 'success', text: msg });
        setFile(null);
        setClassName('');
        fetchClasses();
      } else {
        setMessage({ type: 'error', text: data.error || '上传失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '上传失败') });
    } finally {
      setUploading(false);
    }
  };

  // 计算续班率
  const handleCalculate = async () => {
    if (!fromTerm || !toTerm) {
      setMessage({ type: 'error', text: '请选择源学年与目标学年（届次）' });
      return;
    }

    setCalculating(true);
    setResult(null);
    setMessage(null);

    try {
      const res = await fetch('/api/statistics', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromTerm, toTerm }),
      });
      const data = await res.json();

      if (res.ok && data.data) {
        setResult(data.data);
        setActiveTab('result');
      } else {
        setMessage({ type: 'error', text: data.error || '计算失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '计算失败') });
    } finally {
      setCalculating(false);
    }
  };

  // 查找相似姓名
  const handleSearchSimilar = async () => {
    if (!matchFromTerm || !matchToTerm) {
      setMessage({ type: 'error', text: '请选择源学年与目标学年（届次）' });
      return;
    }

    setSearchingSimilar(true);
    setSimilarNames(null);
    setSelectedMatches(new Map());
    setMessage(null);

    try {
      const res = await fetch('/api/similar-names', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fromTerm: matchFromTerm, toTerm: matchToTerm }),
      });
      const data = await res.json();

      if (res.ok && data.data) {
        setSimilarNames(data.data);
      } else {
        setMessage({ type: 'error', text: data.error || '查找失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '查找失败') });
    } finally {
      setSearchingSimilar(false);
    }
  };

  // 切换选中匹配
  const handleSelectMatch = (winterStudentId: string, springStudentId: string) => {
    const newMatches = new Map(selectedMatches);
    if (newMatches.get(winterStudentId) === springStudentId) {
      newMatches.delete(winterStudentId);
    } else {
      newMatches.set(winterStudentId, springStudentId);
    }
    setSelectedMatches(newMatches);
  };

  // 确认匹配
  const handleConfirmMatches = async () => {
    if (selectedMatches.size === 0) {
      setMessage({ type: 'error', text: '请至少选择一个匹配项' });
      return;
    }

    setMatching(true);
    setMessage(null);

    const matches = Array.from(selectedMatches.entries()).map(([winterStudentId, springStudentId]) => ({
      winterStudentId,
      springStudentId,
    }));

    try {
      const res = await fetch('/api/manual-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matches }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        setMessage({ type: 'success', text: `已成功匹配 ${data.data.success_count} 名学生` });
        setSelectedMatches(new Map());
        // 重新查找相似姓名
        handleSearchSimilar();
        // 若已选统计学年则自动重新计算续班率
        if (fromTerm && toTerm) {
          setFromTerm(fromTerm);
          setToTerm(toTerm);
          setTimeout(() => {
            handleCalculate();
          }, 500);
        }
      } else {
        setMessage({ type: 'error', text: data.error || '匹配失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '匹配失败') });
    } finally {
      setMatching(false);
    }
  };

  // 查看班级详情
  const handleViewClass = async (classId: string) => {
    setLoadingClassDetail(true);
    setShowClassDetail(true);
    setSelectedClass(null);
    setSelectedStudents(new Set());
    setSearchTerm('');

    try {
      const res = await fetch(`/api/roster/${classId}`);
      const data = await res.json();
      if (data.data) {
        setSelectedClass(data.data);
      } else {
        setMessage({ type: 'error', text: data.error || '加载班级详情失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '加载班级详情失败') });
    } finally {
      setLoadingClassDetail(false);
    }
  };

  // 删除班级
  const handleDeleteClass = async (classId: string, className: string) => {
    if (!confirm(`确定要删除班级「${className}」吗？\n此操作不可恢复。`)) {
      return;
    }

    try {
      const res = await fetch(`/api/roster/${classId}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '班级已删除' });
        fetchClasses();
      } else {
        setMessage({ type: 'error', text: data.error || '删除失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '删除失败') });
    }
  };

  // 打开编辑班级
  const handleOpenEditClass = (cls: ClassInfo) => {
    setEditingClass(cls);
    setEditClassName(cls.name);
    setEditClassLessons(cls.total_lessons.toString());
    setShowEditClass(true);
  };

  // 保存编辑后的班级
  const handleSaveEditClass = async () => {
    if (!editingClass || !editClassName.trim()) {
      setMessage({ type: 'error', text: '请填写班级名称' });
      return;
    }

    const lessons = parseInt(editClassLessons);
    if (isNaN(lessons) || lessons <= 0) {
      setMessage({ type: 'error', text: '请填写有效的总课时数' });
      return;
    }

    setSavingClass(true);
    try {
      const res = await fetch(`/api/roster/${editingClass.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editClassName.trim(), total_lessons: lessons }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '班级信息已更新' });
        setShowEditClass(false);
        fetchClasses();
      } else {
        setMessage({ type: 'error', text: data.error || '保存失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '保存失败') });
    } finally {
      setSavingClass(false);
    }
  };

  // 导出班级学生名单
  const handleExportClass = async (cls?: ClassInfo) => {
    if (cls) {
      try {
        const res = await fetch(`/api/roster/${cls.id}`);
        const data = await res.json();
        if (data.data) {
          exportStudentsToCsv(data.data.students, data.data.class);
        }
      } catch {
        setMessage({ type: 'error', text: '获取学生数据失败' });
      }
      return;
    }

    if (!selectedClass || selectedClass.students.length === 0) return;
    exportStudentsToCsv(selectedClass.students, selectedClass.class);
  };

  // 导出学生列表为 CSV
  const exportStudentsToCsv = (students: ClassDetail[], classInfo: { name: string; total_lessons: number; term: string }) => {
    const headers = ['序号', '姓名', '已上课时', '总课时', '出勤率', '半免', '备注'];
    const rows = students.map((student, index) => [
      index + 1,
      student.name,
      student.lessons_attended,
      classInfo.total_lessons,
      `${((student.lessons_attended / classInfo.total_lessons) * 100).toFixed(1)}%`,
      student.is_excluded ? '已排除' : '正常',
      student.remark || (student.is_excluded ? '系统' : ''),
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${classInfo.name}_学生名单_${formatZhDate(Date.now()).replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 单选/取消单选学生
  const handleSelectStudent = (recordId: string) => {
    const newSelected = new Set(selectedStudents);
    if (newSelected.has(recordId)) {
      newSelected.delete(recordId);
    } else {
      newSelected.add(recordId);
    }
    setSelectedStudents(newSelected);
  };

  // 全选/取消全选学生
  const handleSelectAll = () => {
    if (selectedStudents.size === filteredStudents.length) {
      setSelectedStudents(new Set());
    } else {
      setSelectedStudents(new Set(filteredStudents.map((s) => s.id)));
    }
  };

  // 导出已排除学生名单
  const exportExcludedStudents = () => {
    if (!selectedClass || excludedStudents.length === 0) return;

    const headers = ['序号', '姓名', '已上课时', '总课时', '出勤率', '备注'];
    const rows = excludedStudents.map((student, index) => [
      index + 1,
      student.name,
      student.lessons_attended,
      selectedClass.class.total_lessons,
      `${((Math.min(student.lessons_attended, selectedClass.class.total_lessons) / selectedClass.class.total_lessons) * 100).toFixed(1)}%`,
      student.remark || '已排除',
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedClass.class.name}_已排除名单_${formatZhDate(Date.now()).replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 批量删除选中学生
  const handleBatchDelete = async () => {
    if (selectedStudents.size === 0) return;
    if (!confirm(`确定要删除选中的 ${selectedStudents.size} 名学生吗？`)) return;

    try {
      const res = await fetch(`/api/roster/${selectedClass?.class.id}/students`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ record_ids: Array.from(selectedStudents) }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: `已删除 ${data.deleted_count} 名学生` });
        handleViewClass(selectedClass!.class.id);
      } else {
        setMessage({ type: 'error', text: data.error || '删除失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '删除失败') });
    }
  };

  const lessonsForRowDisplay = (student: ClassDetail) => {
    const raw = lessonDrafts[student.id];
    if (raw !== undefined && raw.trim() !== '') {
      const n = parseInt(raw, 10);
      if (!Number.isNaN(n)) return n;
    }
    return student.lessons_attended;
  };

  const commitLessonOnBlur = async (student: ClassDetail) => {
    if (!selectedClass) return;
    const raw = lessonDrafts[student.id];
    if (raw === undefined) return;
    const trimmed = raw.trim();
    if (trimmed === '') {
      setLessonDrafts((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      return;
    }
    const n = parseInt(trimmed, 10);
    if (Number.isNaN(n) || n < 0) {
      setMessage({ type: 'error', text: '上课次数须为非负整数' });
      setLessonDrafts((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      return;
    }
    if (n === student.lessons_attended) {
      setLessonDrafts((prev) => {
        const next = { ...prev };
        delete next[student.id];
        return next;
      });
      return;
    }
    try {
      const res = await fetch(`/api/roster/${selectedClass.class.id}/students/${student.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lessons_attended: n }),
      });
      const data = await res.json();
      if (data.success) {
        setLessonDrafts((prev) => {
          const next = { ...prev };
          delete next[student.id];
          return next;
        });
        await handleViewClass(selectedClass.class.id);
      } else {
        setMessage({ type: 'error', text: data.error || '保存失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '保存失败') });
    }
  };

  const handleBatchApplyLessons = async () => {
    if (!selectedClass || selectedStudents.size === 0) return;
    const n = parseInt(batchLessonInput.trim(), 10);
    if (Number.isNaN(n) || n < 0) {
      setMessage({ type: 'error', text: '请输入有效的上课次数（非负整数）' });
      return;
    }
    setBatchApplying(true);
    try {
      const updates = Array.from(selectedStudents).map((recordId) => ({
        record_id: recordId,
        lessons_attended: n,
      }));
      const res = await fetch(`/api/roster/${selectedClass.class.id}/students`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ updates }),
      });
      const data = await res.json();
      if (data.success) {
        const sc = data.data?.success_count ?? 0;
        setMessage({ type: 'success', text: `已更新 ${sc} 名学生的上课次数` });
        setLessonDrafts({});
        setBatchLessonInput('');
        await handleViewClass(selectedClass.class.id);
      } else {
        setMessage({ type: 'error', text: data.error || '批量更新失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '批量更新失败') });
    } finally {
      setBatchApplying(false);
    }
  };

  // 编辑学生
  const handleStartEdit = (student: ClassDetail) => {
    setEditingStudentId(student.id);
    setEditedStudent({
      record_id: student.id,
      lessons_attended: student.lessons_attended,
      is_half_free: student.is_half_free,
    });
  };

  // 保存修改
  const handleSaveEdit = async () => {
    if (!editingStudentId || !editedStudent) return;

    try {
      const res = await fetch(`/api/roster/${selectedClass?.class.id}/students/${editingStudentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          lessons_attended: editedStudent.lessons_attended,
          is_half_free: editedStudent.is_half_free,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setMessage({ type: 'success', text: '修改成功' });
        setEditingStudentId(null);
        setEditedStudent(null);
        handleViewClass(selectedClass!.class.id);
      } else {
        setMessage({ type: 'error', text: data.error || '修改失败' });
      }
    } catch (error: unknown) {
      setMessage({ type: 'error', text: clientErrorToZhMessage(error, '修改失败') });
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingStudentId(null);
    setEditedStudent(null);
  };

  // 筛选学生
  const filteredStudents = selectedClass?.students.filter((student) => {
    const matchSearch = student.name.toLowerCase().includes(searchTerm.toLowerCase());
    const matchFilter = studentFilter === 'all' || 
      (studentFilter === 'normal' && !student.is_excluded) ||
      (studentFilter === 'excluded' && student.is_excluded);
    return matchSearch && matchFilter;
  }) || [];

  // 统计被排除的学生
  const excludedStudents = selectedClass?.students.filter((s) => s.is_excluded) || [];

  const getTermClasses = (t: string) => classes.filter((c) => c.term === t);

  // 导出未续班学生名单，可按源班级筛选
  const exportNotRenewedList = () => {
    if (!result || !filteredNotRenewedDetails.length) return;

    const headers = ['序号', '姓名', '源班级', '已上课时', '总课时', '出勤率'];
    const rows = filteredNotRenewedDetails.map((student, index) => [
      index + 1,
      student.name,
      student.class_name || '未知班级',
      student.lessons_attended,
      student.total_lessons,
      `${((student.lessons_attended / student.total_lessons) * 100).toFixed(1)}%`,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const srcPart =
      notRenewedExportSourceClass !== EXPORT_CLASS_FILTER_ALL
        ? `_${sanitizeCsvFilenamePart(notRenewedExportSourceClass)}`
        : '';
    link.download = `${result.from_term}_未续班学生名单${srcPart}_${formatZhDate(Date.now()).replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // 导出续班学生名单，可按源班级 + 续读目标班级筛选
  const exportRenewedList = () => {
    if (!result || !filteredRenewedDetails.length) return;

    const headers = ['序号', '姓名', '源班级', '续读班级', '已上课时', '总课时', '出勤率'];
    const rows = filteredRenewedDetails.map((student, index) => [
      index + 1,
      student.name,
      student.class_name || '未知班级',
      student.renewed_to_class || '—',
      student.lessons_attended,
      student.total_lessons,
      `${((student.lessons_attended / student.total_lessons) * 100).toFixed(1)}%`,
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.map((cell) => `"${cell}"`).join(',')),
    ].join('\n');

    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const srcPart =
      renewedExportSourceClass !== EXPORT_CLASS_FILTER_ALL
        ? `_${sanitizeCsvFilenamePart(renewedExportSourceClass)}`
        : '';
    const tgtPart =
      renewedExportTargetClass !== EXPORT_CLASS_FILTER_ALL
        ? `_续读至_${sanitizeCsvFilenamePart(renewedExportTargetClass)}`
        : '';
    link.download = `${result.from_term}_续班学生名单${srcPart}${tgtPart}_${formatZhDate(Date.now()).replace(/\//g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (authChecking) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100 dark:from-orange-950 dark:via-amber-950 dark:to-orange-900">
        <div className="flex items-center gap-2 text-slate-600">
          <Loader2 className="h-5 w-5 animate-spin" />
          正在验证登录状态...
        </div>
      </div>
    );
  }

  if (!authUser) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100 dark:from-orange-950 dark:via-amber-950 dark:to-orange-900 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-blue-600">续班率统计系统登录</CardTitle>
            <CardDescription>
              请先登录后再使用班级管理与续班率统计功能。
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {message && (
              <Alert className={message.type === 'success' ? 'border-green-500 bg-green-50' : 'border-red-500 bg-red-50'}>
                <AlertDescription>{message.text}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <Label>账号</Label>
              <Input
                type="text"
                placeholder="请输入账号（旧用户也可输入邮箱）"
                value={authEmail}
                onChange={(e) => setAuthEmail(e.target.value)}
              />
            </div>
            {authMode !== 'forgot' && (
              <div className="space-y-2">
                <Label>密码</Label>
                <Input
                  type="password"
                  placeholder="请输入密码"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !authSubmitting) void handleAuthSubmit();
                  }}
                />
              </div>
            )}
            {authMode === 'register' && (
              <div className="space-y-2">
                <Label>角色</Label>
                <Select value={registerRole} onValueChange={(v: 'admin' | 'assistant') => setRegisterRole(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">管理员</SelectItem>
                    <SelectItem value="assistant">助教</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button className="w-full" onClick={() => void handleAuthSubmit()} disabled={authSubmitting}>
              {authSubmitting ? '提交中...' : authMode === 'login' ? '登录' : authMode === 'register' ? '注册并登录' : '发送重置邮件'}
            </Button>
            <div className="grid grid-cols-3 gap-2">
              <Button variant={authMode === 'login' ? 'default' : 'outline'} onClick={() => setAuthMode('login')} disabled={authSubmitting}>
                登录
              </Button>
              <Button variant={authMode === 'register' ? 'default' : 'outline'} onClick={() => setAuthMode('register')} disabled={authSubmitting}>
                注册
              </Button>
              <Button variant={authMode === 'forgot' ? 'default' : 'outline'} onClick={() => setAuthMode('forgot')} disabled={authSubmitting}>
                忘记密码
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-orange-50 via-amber-50 to-orange-100 dark:from-orange-950 dark:via-amber-950 dark:to-orange-900">
      <div className="container mx-auto px-4 py-8 max-w-6xl">
        {/* 标题 */}
        <div className="mb-8">
          <div className="flex items-start justify-between gap-4">
            <div className="text-center flex-1">
              <h1 className="text-3xl font-bold text-blue-600 dark:text-blue-400 mb-2">
                续班率统计系统
              </h1>
              <p className="text-blue-500 dark:text-blue-500">
                按学年、年级组织班级，上传点名册并计算续班率，支持排除半免和上课不足学生。
              </p>
              <p className="text-xs text-slate-500 mt-2">
                当前登录：{authUser.account || authUser.email || authUser.id}
                {authUser.role ? `（${authUser.role === 'admin' ? '管理员' : '助教'}）` : ''}
              </p>
            </div>
            <div className="flex flex-col gap-2 shrink-0">
              {authUser.role === 'admin' && (
                <Button variant="outline" onClick={() => setShowCreateAssistant((v) => !v)} className="shrink-0">
                  添加助教
                </Button>
              )}
              <Button variant="outline" onClick={() => setShowChangePassword((v) => !v)} className="shrink-0">
                修改密码
              </Button>
              <Button variant="outline" onClick={() => void handleLogout()} className="shrink-0">
                <LogOut className="h-4 w-4 mr-2" />
                退出登录
              </Button>
            </div>
          </div>
          {showChangePassword && (
            <Card className="mt-4 max-w-md ml-auto">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">修改密码</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input type="password" placeholder="当前密码" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
                <Input type="password" placeholder="新密码（至少6位）" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
                <Button onClick={() => void handleChangePassword()} disabled={authSubmitting} className="w-full">
                  {authSubmitting ? '提交中...' : '确认修改'}
                </Button>
              </CardContent>
            </Card>
          )}
          {authUser.role === 'admin' && showCreateAssistant && (
            <Card className="mt-4 max-w-md ml-auto">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">管理员添加助教账号</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <Input type="text" placeholder="助教账号（英文/数字）" value={assistantEmail} onChange={(e) => setAssistantEmail(e.target.value)} />
                <Input type="password" placeholder="助教初始密码（至少6位）" value={assistantPassword} onChange={(e) => setAssistantPassword(e.target.value)} />
                <Button onClick={() => void handleCreateAssistant()} disabled={authSubmitting} className="w-full">
                  {authSubmitting ? '提交中...' : '创建助教账号'}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>

        {/* 消息提示 */}
        {message && (
          <Alert className={`mb-6 ${message.type === 'success' ? 'border-green-500 bg-green-50 dark:bg-green-900/20' : 'border-red-500 bg-red-50 dark:bg-red-900/20'}`}>
            {message.type === 'success' ? (
              <CheckCircle2 className="h-4 w-4 text-green-500" />
            ) : (
              <XCircle className="h-4 w-4 text-red-500" />
            )}
            <AlertDescription className={message.type === 'success' ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}>
              {message.text}
            </AlertDescription>
          </Alert>
        )}

        {/* 主内容 */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 mb-6">
            <TabsTrigger value="upload" className="flex items-center gap-2 data-[state=active]:text-blue-600 data-[state=active]:bg-blue-50">
              <Upload className="h-4 w-4" />
              上传点名册
            </TabsTrigger>
            <TabsTrigger value="statistics" className="flex items-center gap-2 data-[state=active]:text-blue-600 data-[state=active]:bg-blue-50">
              <BarChart3 className="h-4 w-4" />
              续班率统计
            </TabsTrigger>
            <TabsTrigger value="match" className="flex items-center gap-2 data-[state=active]:text-blue-600 data-[state=active]:bg-blue-50">
              <UserCheck className="h-4 w-4" />
              姓名匹配
            </TabsTrigger>
            <TabsTrigger value="classes" className="flex items-center gap-2 data-[state=active]:text-blue-600 data-[state=active]:bg-blue-50">
              <FileSpreadsheet className="h-4 w-4" />
              班级列表
            </TabsTrigger>
          </TabsList>

          {/* 上传点名册 */}
          <TabsContent value="upload">
            <Card>
              <CardHeader>
                <CardTitle className="text-blue-600">上传点名册</CardTitle>
                <CardDescription>
                  上传 Excel 或 CSV 格式的点名册文件，系统自动解析学生信息。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">班级名称</label>
                    <Input
                      placeholder="例如：高一1班、三年级2班"
                      value={className}
                      onChange={(e) => setClassName(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">学年 / 届次</label>
                    <Input
                      list="school-term-suggestions"
                      placeholder="例如：2025学年、2024秋"
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                    />
                    <datalist id="school-term-suggestions">
                      {termInputSuggestions.map((t) => (
                        <option key={t} value={t} />
                      ))}
                    </datalist>
                    <p className="text-xs text-slate-500">与统计、续班对比中的「源 / 目标」一致；旧数据若仍用「寒假」等也可继续填写。</p>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">总课时数</label>
                    <Input
                      type="number"
                      placeholder="默认12"
                      value={totalLessons}
                      onChange={(e) => setTotalLessons(e.target.value)}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">选择点名文件</label>
                  <div className="border-2 border-dashed border-slate-200 dark:border-slate-700 rounded-lg p-8 text-center hover:border-slate-300 dark:hover:border-slate-600 transition-colors">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      onChange={(e) => setFile(e.target.files?.[0] || null)}
                      className="hidden"
                      id="file-upload"
                    />
                    <label htmlFor="file-upload" className="cursor-pointer">
                      <Upload className="h-12 w-12 mx-auto text-slate-400 mb-4" />
                      <p className="text-slate-600 dark:text-slate-400">
                        {file ? file.name : '点击选择文件或将文件拖放到此处'}
                      </p>
                      <p className="text-sm text-slate-500 mt-2">支持 Excel (.xlsx, .xls) 与 CSV 格式</p>
                    </label>
                  </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-4">
                  <h4 className="font-medium mb-2">文件格式要求</h4>
                  <ul className="text-sm text-slate-600 dark:text-slate-400 space-y-1">
                    <li>第一行为表头，包含姓名、上课次数或出勤次数、备注</li>
                    <li>姓名列必须填写；上课次数列填写数字，表示实际上课次数</li>
                    <li>备注列包含以下关键词：<strong>半免、免费、退费、试听、休学、退学、退款、取消</strong></li>
                    <li>备注中包含以上关键词的学生将被自动排除，不计入有效人数</li>
                  </ul>
                  <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                    <p className="text-sm text-blue-700 dark:text-blue-300 font-medium">示例表头：</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">姓名 | 上课次数 | 备注</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">张三 | 15 | —</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">李四 | 12 | 半免</p>
                    <p className="text-sm text-blue-600 dark:text-blue-400">王五 | 10 | 退费</p>
                  </div>
                </div>

                <Button
                  onClick={handleUpload}
                  disabled={uploading || !file || !className || !term}
                  className="w-full"
                >
                  {uploading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      上传中...
                    </>
                  ) : (
                    <>
                      <Upload className="h-4 w-4 mr-2" />
                      上传点名册
                    </>
                  )}
                </Button>
              </CardContent>
            </Card>

            {result && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-blue-600">续班率统计（首页摘要）</CardTitle>
                  <CardDescription>
                    当前统计：{result.from_term} → {result.to_term}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-6">
                    <div className="text-center mb-4">
                      <span className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                        {result.renewal_rate}
                      </span>
                      <p className="text-sm text-slate-500 mt-2">整体续班率</p>
                    </div>
                    <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                      <div className="text-center">
                        <p className="text-slate-500">源班级数</p>
                        <p className="font-medium">{result.source_class_count}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-500">源班人数</p>
                        <p className="font-medium">{result.source_total_students}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-500">有效人数</p>
                        <p className="font-medium">{result.valid_students}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-500">续读人数</p>
                        <p className="font-medium text-green-600">{result.renewed_students}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-slate-500">未续读人数</p>
                        <p className="font-medium text-red-600">{result.not_renewed_students}</p>
                      </div>
                    </div>
                  </div>

                  {gradeSummary.length > 0 && (
                    <div>
                      <h4 className="font-medium mb-3">按年级汇总</h4>
                      <div className="border rounded-lg overflow-hidden">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>年级</TableHead>
                              <TableHead className="text-center">班级数</TableHead>
                              <TableHead className="text-center">有效人数</TableHead>
                              <TableHead className="text-center">续读人数</TableHead>
                              <TableHead className="text-center">续班率</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {gradeSummary.map((g) => (
                              <TableRow key={`home-${g.grade}`}>
                                <TableCell className="font-medium">{g.grade}</TableCell>
                                <TableCell className="text-center">{g.class_count}</TableCell>
                                <TableCell className="text-center">{g.valid_students}</TableCell>
                                <TableCell className="text-center text-green-600">{g.renewed_students}</TableCell>
                                <TableCell className="text-center">
                                  <Badge
                                    variant={
                                      parseFloat(g.renewal_rate) >= 70
                                        ? 'default'
                                        : parseFloat(g.renewal_rate) >= 50
                                        ? 'secondary'
                                        : 'destructive'
                                    }
                                  >
                                    {g.renewal_rate}
                                  </Badge>
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </div>
                    </div>
                  )}

                  <div>
                    <h4 className="font-medium mb-3">各班级续班率（按年级 · 班级）</h4>
                    <div className="space-y-4">
                      {groupClassStatsByGrade.map(({ grade, rows }) => (
                        <div key={`home-${grade}`} className="border rounded-lg overflow-hidden">
                          <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-sm font-medium border-b">
                            年级：{grade}
                            <span className="font-normal text-slate-500 ml-2">共 {rows.length} 个班级</span>
                          </div>
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>班级名称</TableHead>
                                <TableHead className="text-center">有效人数</TableHead>
                                <TableHead className="text-center">续读人数</TableHead>
                                <TableHead className="text-center">续班率</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {rows.map((stat) => (
                                <TableRow key={`home-row-${stat.class_id}`}>
                                  <TableCell className="font-medium">{stat.class_name}</TableCell>
                                  <TableCell className="text-center">{stat.valid_students}</TableCell>
                                  <TableCell className="text-center text-green-600">{stat.renewed_students}</TableCell>
                                  <TableCell className="text-center">
                                    <Badge
                                      variant={
                                        parseFloat(stat.renewal_rate) >= 70
                                          ? 'default'
                                          : parseFloat(stat.renewal_rate) >= 50
                                          ? 'secondary'
                                          : 'destructive'
                                      }
                                    >
                                      {stat.renewal_rate}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-3">
                    <Button variant="outline" onClick={() => setActiveTab('statistics')}>
                      去统计页查看明细与筛选
                    </Button>
                    <Button variant="outline" onClick={exportRenewedList} disabled={!filteredRenewedDetails.length}>
                      <Download className="h-4 w-4 mr-2" />
                      导出续读名单
                    </Button>
                    <Button variant="destructive" onClick={exportNotRenewedList} disabled={!filteredNotRenewedDetails.length}>
                      <Download className="h-4 w-4 mr-2" />
                      导出未续班名单
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* 续班率统计 */}
          <TabsContent value="statistics">
            <Card>
              <CardHeader>
                <CardTitle className="text-blue-600">续班率统计</CardTitle>
                <CardDescription>
                  选择源学年与目标学年（届次），计算续班率；结果中可按年级查看班级明细。自动排除半免与上课不足总课时1/3的学生。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">源学年 / 届次</label>
                    <Select value={fromTerm} onValueChange={setFromTerm}>
                      <SelectTrigger>
                        <SelectValue placeholder="请选择源学年" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingTerms.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}（{getTermClasses(t).length}个班级）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">目标学年 / 届次（续读所在）</label>
                    <Select value={toTerm} onValueChange={setToTerm}>
                      <SelectTrigger>
                        <SelectValue placeholder="请选择目标学年" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingTerms
                          .filter((t) => t !== fromTerm)
                          .map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}（{getTermClasses(t).length}个班级）
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  onClick={handleCalculate}
                  disabled={calculating || !fromTerm || !toTerm}
                  className="w-full"
                >
                  {calculating ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      计算中...
                    </>
                  ) : (
                    <>
                      <BarChart3 className="h-4 w-4 mr-2" />
                      计算续班率
                    </>
                  )}
                </Button>

                {/* 统计结果 */}
                {result && (
                  <div className="space-y-6 mt-8">
                    <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 rounded-xl p-6">
                      <h3 className="text-lg font-semibold mb-4 text-center">
                        {result.from_term} → {result.to_term} 续班率
                      </h3>
                      <div className="text-center mb-4">
                        <span className="text-5xl font-bold text-blue-600 dark:text-blue-400">
                          {result.renewal_rate}
                        </span>
                      </div>
                      <div className="flex justify-center gap-8 text-sm">
                        <div>
                          <span className="text-slate-500">源班级数：</span>
                          <span className="font-medium">{result.source_class_count}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">源班人数：</span>
                          <span className="font-medium">{result.source_total_students}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">有效人数：</span>
                          <span className="font-medium">{result.valid_students}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">续读人数：</span>
                          <span className="font-medium text-green-600">{result.renewed_students}</span>
                        </div>
                        <div>
                          <span className="text-slate-500">未续读人数：</span>
                          <span className="font-medium text-red-600">{result.not_renewed_students}</span>
                        </div>
                      </div>
                    </div>

                    {/* 按年级汇总 */}
                    {gradeSummary.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-3">按年级汇总</h4>
                        <p className="text-sm text-slate-500 mb-2">
                          年级根据班级名称解析；名称中含有“X年级/初X/高X”等关键词时会自动归类，未识别时显示为“未标注年级”。
                        </p>
                        <div className="border rounded-lg overflow-hidden">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>年级</TableHead>
                                <TableHead className="text-center">班级数</TableHead>
                                <TableHead className="text-center">有效人数</TableHead>
                                <TableHead className="text-center">续读人数</TableHead>
                                <TableHead className="text-center">续班率</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {gradeSummary.map((g) => (
                                <TableRow key={g.grade}>
                                  <TableCell className="font-medium">{g.grade}</TableCell>
                                  <TableCell className="text-center">{g.class_count}</TableCell>
                                  <TableCell className="text-center">{g.valid_students}</TableCell>
                                  <TableCell className="text-center text-green-600">{g.renewed_students}</TableCell>
                                  <TableCell className="text-center">
                                    <Badge
                                      variant={
                                        parseFloat(g.renewal_rate) >= 70
                                          ? 'default'
                                          : parseFloat(g.renewal_rate) >= 50
                                          ? 'secondary'
                                          : 'destructive'
                                      }
                                    >
                                      {g.renewal_rate}
                                    </Badge>
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {/* 各班级统计（按年级分组） */}
                    <div>
                      <h4 className="font-medium mb-3">各班级续班率（按年级 · 班级）</h4>
                      <div className="space-y-4">
                        {groupClassStatsByGrade.map(({ grade, rows }) => (
                          <div key={grade} className="border rounded-lg overflow-hidden">
                            <div className="bg-slate-50 dark:bg-slate-800/50 px-4 py-2 text-sm font-medium border-b">
                              年级：{grade}
                              <span className="font-normal text-slate-500 ml-2">
                                共 {rows.length} 个班级
                              </span>
                            </div>
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>年级</TableHead>
                                  <TableHead>班级名称</TableHead>
                                  <TableHead className="text-center">总课时</TableHead>
                                  <TableHead className="text-center">源班人数</TableHead>
                                  <TableHead className="text-center">有效人数</TableHead>
                                  <TableHead className="text-center">续读人数</TableHead>
                                  <TableHead className="text-center">续班率</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {rows.map((stat) => (
                                  <TableRow key={stat.class_id}>
                                    <TableCell className="text-slate-600 whitespace-nowrap">
                                      {stat.grade ?? grade}
                                    </TableCell>
                                    <TableCell className="font-medium">{stat.class_name}</TableCell>
                                    <TableCell className="text-center">{stat.total_lessons}</TableCell>
                                    <TableCell className="text-center">{stat.total_students}</TableCell>
                                    <TableCell className="text-center">{stat.valid_students}</TableCell>
                                    <TableCell className="text-center text-green-600">{stat.renewed_students}</TableCell>
                                    <TableCell className="text-center">
                                      <Badge
                                        variant={
                                          parseFloat(stat.renewal_rate) >= 70
                                            ? 'default'
                                            : parseFloat(stat.renewal_rate) >= 50
                                            ? 'secondary'
                                            : 'destructive'
                                        }
                                      >
                                        {stat.renewal_rate}
                                      </Badge>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 续读学生明细 */}
                    {result.renewed_details.length > 0 && (
                      <div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                          <h4 className="font-medium">
                            续读学生名单（共 {result.renewed_details.length} 人，当前显示 {filteredRenewedDetails.length} 人）
                          </h4>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={exportRenewedList}
                            disabled={!filteredRenewedDetails.length}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            导出 CSV
                          </Button>
                        </div>
                        <p className="text-sm text-slate-500 mb-2">
                          可按源班级与续读所在目标班级筛选，导出文件名会带上筛选条件。
                        </p>
                        <div className="flex flex-wrap gap-3 mb-3">
                          <div className="flex flex-col gap-1 min-w-[200px]">
                            <span className="text-xs text-slate-500">源班级（源学年）</span>
                            <Select value={renewedExportSourceClass} onValueChange={setRenewedExportSourceClass}>
                              <SelectTrigger className="w-full sm:w-[240px]">
                                <SelectValue placeholder="全部源班级" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={EXPORT_CLASS_FILTER_ALL}>全部源班级</SelectItem>
                                {renewedExportSourceOptions.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="flex flex-col gap-1 min-w-[200px]">
                            <span className="text-xs text-slate-500">续读所在目标学年班级</span>
                            <Select value={renewedExportTargetClass} onValueChange={setRenewedExportTargetClass}>
                              <SelectTrigger className="w-full sm:w-[240px]">
                                <SelectValue placeholder="全部续读班级" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={EXPORT_CLASS_FILTER_ALL}>全部续读班级</SelectItem>
                                {renewedExportTargetOptions.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {filteredRenewedDetails.length === 0 ? (
                          <p className="text-sm text-amber-700 dark:text-amber-400 py-4">当前筛选条件下没有学生，请调整筛选项。</p>
                        ) : (
                          <div className="border rounded-lg overflow-hidden max-h-96 overflow-y-auto">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>序号</TableHead>
                                  <TableHead>姓名</TableHead>
                                  <TableHead>源班级</TableHead>
                                  <TableHead>续读班级</TableHead>
                                  <TableHead className="text-center">已上课时</TableHead>
                                  <TableHead className="text-center">总课时</TableHead>
                                  <TableHead className="text-center">出勤率</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredRenewedDetails.map((student, index) => (
                                  <TableRow key={student.student_id}>
                                    <TableCell>{index + 1}</TableCell>
                                    <TableCell className="font-medium">{student.name}</TableCell>
                                    <TableCell>{student.class_name}</TableCell>
                                    <TableCell className="text-sm max-w-[200px] break-words">
                                      {student.renewed_to_class || '—'}
                                    </TableCell>
                                    <TableCell className="text-center">{student.lessons_attended}</TableCell>
                                    <TableCell className="text-center">{student.total_lessons}</TableCell>
                                    <TableCell className="text-center">
                                      {((student.lessons_attended / student.total_lessons) * 100).toFixed(0)}%
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    )}

                    {/* 未续班学生明细 */}
                    {result.not_renewed_details.length > 0 && (
                      <div>
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-3">
                          <h4 className="font-medium text-red-600 flex items-center gap-2">
                            <UserX className="h-4 w-4" />
                            未续班学生名单（共 {result.not_renewed_details.length} 人，当前显示 {filteredNotRenewedDetails.length} 人）
                          </h4>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={exportNotRenewedList}
                            disabled={!filteredNotRenewedDetails.length}
                          >
                            <Download className="h-4 w-4 mr-1" />
                            导出 CSV
                          </Button>
                        </div>
                        <p className="text-sm text-slate-500 mb-2">可按源班级筛选后导出。</p>
                        <div className="flex flex-wrap gap-3 mb-3">
                          <div className="flex flex-col gap-1 min-w-[200px]">
                            <span className="text-xs text-slate-500">源班级（源学年）</span>
                            <Select value={notRenewedExportSourceClass} onValueChange={setNotRenewedExportSourceClass}>
                              <SelectTrigger className="w-full sm:w-[240px]">
                                <SelectValue placeholder="全部源班级" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value={EXPORT_CLASS_FILTER_ALL}>全部源班级</SelectItem>
                                {notRenewedExportSourceOptions.map((name) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>
                        {filteredNotRenewedDetails.length === 0 ? (
                          <p className="text-sm text-amber-700 dark:text-amber-400 py-4">当前筛选条件下没有学生，请调整筛选项。</p>
                        ) : (
                          <div className="border border-red-200 dark:border-red-800 rounded-lg overflow-hidden max-h-96 overflow-y-auto bg-red-50/50 dark:bg-red-900/10">
                            <Table>
                              <TableHeader>
                                <TableRow>
                                  <TableHead>序号</TableHead>
                                  <TableHead>姓名</TableHead>
                                  <TableHead>源班级</TableHead>
                                  <TableHead className="text-center">已上课时</TableHead>
                                  <TableHead className="text-center">总课时</TableHead>
                                  <TableHead className="text-center">出勤率</TableHead>
                                </TableRow>
                              </TableHeader>
                              <TableBody>
                                {filteredNotRenewedDetails.map((student, index) => (
                                  <TableRow key={student.student_id}>
                                    <TableCell>{index + 1}</TableCell>
                                    <TableCell className="font-medium">{student.name}</TableCell>
                                    <TableCell>{student.class_name}</TableCell>
                                    <TableCell className="text-center">{student.lessons_attended}</TableCell>
                                    <TableCell className="text-center">{student.total_lessons}</TableCell>
                                    <TableCell className="text-center">
                                      {((student.lessons_attended / student.total_lessons) * 100).toFixed(0)}%
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </TableBody>
                            </Table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 班级列表 */}
          <TabsContent value="classes">
            <Card>
              <CardHeader>
                <CardTitle className="text-blue-600">已上传班级列表</CardTitle>
                <CardDescription>
                  共 {classes.length} 个班级，{classes.reduce((sum, c) => sum + c.student_count, 0)} 名学生；按学年、年级折叠展示。
                </CardDescription>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : classes.length === 0 ? (
                  <div className="text-center py-12 text-slate-500">
                    <FileSpreadsheet className="h-16 w-16 mx-auto mb-4 text-slate-300" />
                    <p>暂无数据，请先上传点名册</p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {classesByYearAndGrade.map(({ term: yearTerm, grades }) => {
                      const termClasses = getTermClasses(yearTerm);
                      return (
                        <div key={yearTerm} className="space-y-4">
                          <h4 className="font-medium flex flex-wrap items-center gap-2 border-b pb-2">
                            <Badge variant="outline" className="text-base">
                              {yearTerm}
                            </Badge>
                            <span className="text-sm text-slate-500">
                              {termClasses.length} 个班级，{termClasses.reduce((sum, c) => sum + c.student_count, 0)} 名学生
                            </span>
                          </h4>
                          {grades.map(({ grade, classes: gradeClasses }) => (
                            <div key={`${yearTerm}-${grade}`} className="ml-0 md:ml-3 space-y-3">
                              <h5 className="text-sm font-medium text-slate-600 dark:text-slate-400 flex items-center gap-2">
                                <span className="inline-block w-1 h-4 rounded bg-blue-400" aria-hidden />
                                {grade}
                                <span className="font-normal text-slate-400">
                                  （{gradeClasses.length} 班）
                                </span>
                              </h5>
                              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                {gradeClasses.map((cls) => (
                                  <div
                                    key={cls.id}
                                    className="border rounded-lg p-4 hover:shadow-md transition-shadow"
                                  >
                                    <div className="flex justify-between items-start mb-2">
                                      <h5 className="font-medium">{cls.name}</h5>
                                      <Badge variant="secondary">{cls.student_count}人</Badge>
                                    </div>
                                    <p className="text-sm text-slate-500">总课时数 {cls.total_lessons}</p>
                                    <p className="text-xs text-slate-400 mt-1">
                                      创建时间：{formatZhDate(cls.created_at)}
                                    </p>
                                    <div className="flex items-center gap-2 mt-3 pt-3 border-t">
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="flex-1 h-8"
                                        onClick={() => handleViewClass(cls.id)}
                                      >
                                        <Eye className="h-3 w-3 mr-1" />
                                        预览
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="flex-1 h-8"
                                        onClick={() => handleExportClass(cls)}
                                      >
                                        <Download className="h-3 w-3 mr-1" />
                                        导出
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 hover:bg-blue-50 hover:text-blue-600"
                                        onClick={() => handleOpenEditClass(cls)}
                                      >
                                        <Pencil className="h-3 w-3" />
                                      </Button>
                                      <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-8 px-2 text-red-500 hover:text-red-600 hover:bg-red-50"
                                        onClick={() => handleDeleteClass(cls.id, cls.name)}
                                      >
                                        <Trash2 className="h-3 w-3" />
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* 姓名匹配 */}
          <TabsContent value="match">
            <Card>
              <CardHeader>
                <CardTitle className="text-blue-600">姓名匹配</CardTitle>
                <CardDescription>
                  查找源学年与目标学年中姓名相似的学生，减少同名不同人带来的续班率误差。
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-sm font-medium">源学年 / 届次</label>
                    <Select value={matchFromTerm} onValueChange={setMatchFromTerm}>
                      <SelectTrigger>
                        <SelectValue placeholder="请选择源学年" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingTerms.map((t) => (
                          <SelectItem key={t} value={t}>
                            {t}（{getTermClasses(t).length}个班级）
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-sm font-medium">目标学年 / 届次</label>
                    <Select value={matchToTerm} onValueChange={setMatchToTerm}>
                      <SelectTrigger>
                        <SelectValue placeholder="请选择目标学年" />
                      </SelectTrigger>
                      <SelectContent>
                        {existingTerms
                          .filter((t) => t !== matchFromTerm)
                          .map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}（{getTermClasses(t).length}个班级）
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <Button
                  onClick={handleSearchSimilar}
                  disabled={searchingSimilar || !matchFromTerm || !matchToTerm}
                  className="w-full"
                >
                  {searchingSimilar ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      查找中...
                    </>
                  ) : (
                    <>
                      <Users className="h-4 w-4 mr-2" />
                      查找相似姓名
                    </>
                  )}
                </Button>

                {/* 相似姓名列表 */}
                {similarNames && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="font-medium">
                        共 {similarNames.total_similar} 组相似姓名学生
                      </h4>
                      {selectedMatches.size > 0 && (
                        <Button onClick={handleConfirmMatches} disabled={matching} size="sm">
                          {matching ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              提交中...
                            </>
                          ) : (
                            <>
                              <CheckCircle2 className="h-4 w-4 mr-1" />
                              确认匹配 ({selectedMatches.size})
                            </>
                          )}
                        </Button>
                      )}
                    </div>

                    {similarNames.total_similar === 0 ? (
                      <div className="text-center py-8 text-slate-500">
                        <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-400" />
                        <p>没有发现相似姓名，说明学生已正确匹配</p>
                      </div>
                    ) : (
                      <div className="space-y-3 max-h-96 overflow-y-auto">
                        {similarNames.similar_names.map((item) => (
                          <div
                            key={item.winter_student_id}
                            className={`border rounded-lg p-4 transition-colors ${
                              selectedMatches.has(item.winter_student_id)
                                ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                                : 'border-slate-200 dark:border-slate-700'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <input
                                type="checkbox"
                                checked={selectedMatches.has(item.winter_student_id)}
                                onChange={() => handleSelectMatch(item.winter_student_id, item.spring_names[0].student_id)}
                                className="mt-1 w-4 h-4 accent-green-500"
                              />
                              <div className="flex-1">
                                <div className="flex items-center gap-2 mb-2">
                                  <Badge variant="outline" className="text-blue-600 border-blue-300">
                                    预览
                                  </Badge>
                                  <span className="font-medium">{item.winter_name}</span>
                                  <span className="text-sm text-slate-500">（{item.winter_class}）</span>
                                </div>
                                <div className="text-sm text-slate-400 mb-2">↓ 可能的匹配 ↓</div>
                                <div className="space-y-2">
                                  {item.spring_names.slice(0, 3).map((spring) => (
                                    <div
                                      key={spring.student_id}
                                      className={`flex items-center gap-2 p-2 rounded ${
                                        selectedMatches.get(item.winter_student_id) === spring.student_id
                                          ? 'bg-green-100 dark:bg-green-900/30'
                                          : 'bg-slate-50 dark:bg-slate-800'
                                      }`}
                                      onClick={() => handleSelectMatch(item.winter_student_id, spring.student_id)}
                                    >
                                      <Badge variant="outline" className="text-orange-600 border-orange-300">
                                        目标
                                      </Badge>
                                      <span className="font-medium">{spring.name}</span>
                                      <Badge
                                        variant={
                                          spring.similarity >= 0.9
                                            ? 'default'
                                            : spring.similarity >= 0.8
                                            ? 'secondary'
                                            : 'outline'
                                        }
                                        className="ml-auto"
                                      >
                                        相似度 {Math.round(spring.similarity * 100)}%
                                      </Badge>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
                  <h4 className="font-medium text-amber-800 dark:text-amber-200 mb-2">使用说明</h4>
                  <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
                    <li>系统会自动对比源学年与目标学年中姓名相似的学生，例如“魏文煜”和“魏文钰”。</li>
                    <li>勾选你认为正确的对应关系后，点击“确认匹配”即可。</li>
                    <li>匹配关系会写回数据，并影响续班率统计结果。</li>
                    <li>请仔细核对，确保匹配关系正确。</li>
                  </ul>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="result">
            <Card>
              <CardHeader>
                <CardTitle className="text-blue-600">续班率统计结果</CardTitle>
                <CardDescription>
                  {result ? `${result.from_term} → ${result.to_term}` : '暂无数据'}
                </CardDescription>
              </CardHeader>
              <CardContent>
                {result ? (
                  <div className="space-y-6">
                    <div className="text-center">
                      <div className="inline-flex items-center justify-center w-32 h-32 rounded-full bg-blue-100 dark:bg-blue-900/30 mb-4">
                        <span className="text-4xl font-bold text-blue-600">{result.renewal_rate}</span>
                      </div>
                      <p className="text-slate-500">整体续班率</p>
                    </div>

                    <div className="grid grid-cols-5 gap-4">
                      <div className="text-center p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="text-2xl font-bold">{result.source_class_count}</div>
                        <div className="text-sm text-slate-500">源班级数</div>
                      </div>
                      <div className="text-center p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="text-2xl font-bold">{result.source_total_students}</div>
                        <div className="text-sm text-slate-500">源班人数</div>
                      </div>
                      <div className="text-center p-4 bg-slate-50 dark:bg-slate-800 rounded-lg">
                        <div className="text-2xl font-bold">{result.valid_students}</div>
                        <div className="text-sm text-slate-500">有效人数</div>
                      </div>
                      <div className="text-center p-4 bg-green-50 dark:bg-green-900/20 rounded-lg">
                        <div className="text-2xl font-bold text-green-600">{result.renewed_students}</div>
                        <div className="text-sm text-slate-500">续读人数</div>
                      </div>
                      <div className="text-center p-4 bg-red-50 dark:bg-red-900/20 rounded-lg">
                        <div className="text-2xl font-bold text-red-600">{result.not_renewed_students}</div>
                        <div className="text-sm text-slate-500">未续读人数</div>
                      </div>
                    </div>

                    {gradeSummary.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-3">按年级汇总</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
                          {gradeSummary.map((g) => (
                            <div key={g.grade} className="border rounded-lg p-3 bg-slate-50/80 dark:bg-slate-800/40">
                              <div className="flex justify-between items-center mb-2">
                                <span className="font-medium text-sm">{g.grade}</span>
                                <Badge
                                  variant={
                                    parseFloat(g.renewal_rate) >= 70
                                      ? 'default'
                                      : parseFloat(g.renewal_rate) >= 50
                                      ? 'secondary'
                                      : 'destructive'
                                  }
                                >
                                  {g.renewal_rate}
                                </Badge>
                              </div>
                              <Progress value={parseFloat(g.renewal_rate)} className="h-2 mb-2" />
                              <div className="text-xs text-slate-500 flex justify-between">
                                <span>{g.class_count} 个班</span>
                                <span>有效 {g.valid_students}</span>
                                <span>续读 {g.renewed_students}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div>
                      <h4 className="font-medium mb-3">各班级进度（按年级）</h4>
                      <div className="space-y-4">
                        {groupClassStatsByGrade.map(({ grade, rows }) => (
                          <div key={`result-${grade}`}>
                            <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-2">
                              年级：{grade}
                            </p>
                            <div className="space-y-3">
                              {rows.map((stat) => (
                                <div key={stat.class_id} className="border rounded-lg p-4">
                                  <div className="flex justify-between items-center mb-2">
                                    <span className="font-medium">
                                      <span className="text-slate-500 text-sm mr-2">{stat.grade ?? grade}</span>
                                      {stat.class_name}
                                    </span>
                                    <Badge
                                      variant={
                                        parseFloat(stat.renewal_rate) >= 70
                                          ? 'default'
                                          : parseFloat(stat.renewal_rate) >= 50
                                          ? 'secondary'
                                          : 'destructive'
                                      }
                                    >
                                      {stat.renewal_rate}
                                    </Badge>
                                  </div>
                                  <Progress
                                    value={parseFloat(stat.renewal_rate)}
                                    className="h-2"
                                  />
                                  <div className="flex justify-between text-sm text-slate-500 mt-2">
                                    <span>源班 {stat.total_students} 人</span>
                                    <span>有效 {stat.valid_students} 人</span>
                                    <span>续读 {stat.renewed_students} 人</span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="rounded-lg border bg-slate-50/80 dark:bg-slate-900/30 p-4 space-y-3 mb-4">
                      <p className="text-sm text-slate-600 dark:text-slate-400">
                        导出前可按班级筛选；续读名单支持源班级 + 续读目标班级组合筛选。
                      </p>
                      <div className="flex flex-wrap gap-3">
                        <div className="flex flex-col gap-1 min-w-[180px]">
                          <span className="text-xs text-slate-500">续读·源班级</span>
                          <Select value={renewedExportSourceClass} onValueChange={setRenewedExportSourceClass}>
                            <SelectTrigger className="w-full sm:w-[220px]">
                              <SelectValue placeholder="全部源班级" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EXPORT_CLASS_FILTER_ALL}>全部源班级</SelectItem>
                              {renewedExportSourceOptions.map((name) => (
                                <SelectItem key={`r-src-${name}`} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1 min-w-[180px]">
                          <span className="text-xs text-slate-500">续读·目标班级</span>
                          <Select value={renewedExportTargetClass} onValueChange={setRenewedExportTargetClass}>
                            <SelectTrigger className="w-full sm:w-[220px]">
                              <SelectValue placeholder="全部续读班级" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EXPORT_CLASS_FILTER_ALL}>全部续读班级</SelectItem>
                              {renewedExportTargetOptions.map((name) => (
                                <SelectItem key={`r-tgt-${name}`} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex flex-col gap-1 min-w-[180px]">
                          <span className="text-xs text-slate-500">未续班·源班级</span>
                          <Select value={notRenewedExportSourceClass} onValueChange={setNotRenewedExportSourceClass}>
                            <SelectTrigger className="w-full sm:w-[220px]">
                              <SelectValue placeholder="全部源班级" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={EXPORT_CLASS_FILTER_ALL}>全部源班级</SelectItem>
                              {notRenewedExportSourceOptions.map((name) => (
                                <SelectItem key={`nr-src-${name}`} value={name}>
                                  {name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      <p className="text-xs text-slate-500">
                        当前可导出：续读 {filteredRenewedDetails.length} 人 · 未续班 {filteredNotRenewedDetails.length} 人
                      </p>
                    </div>

                    <div className="flex gap-4">
                      <Button
                        variant="outline"
                        onClick={exportRenewedList}
                        disabled={!filteredRenewedDetails.length}
                        className="flex-1"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        导出续读名单
                      </Button>
                      <Button
                        variant="destructive"
                        onClick={exportNotRenewedList}
                        disabled={!filteredNotRenewedDetails.length}
                        className="flex-1"
                      >
                        <Download className="h-4 w-4 mr-2" />
                        导出未续班名单
                      </Button>
                    </div>

                    <div className="flex gap-4">
                      <Button
                        variant="outline"
                        onClick={() => setActiveTab('statistics')}
                        className="flex-1"
                      >
                        返回统计
                      </Button>
                      <Button
                        onClick={() => setActiveTab('upload')}
                        className="flex-1"
                      >
                        继续上传点名册
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    <BarChart3 className="h-16 w-16 mx-auto mb-4 text-slate-300" />
                    <p>暂无统计数据</p>
                    <Button
                      variant="link"
                      onClick={() => setActiveTab('statistics')}
                      className="mt-2"
                    >
                      去统计
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* 班级详情弹窗 */}
        {showClassDetail && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <Card className="w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
              <CardHeader className="flex-shrink-0">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>
                      {selectedClass?.class.name || '班级详情'}
                    </CardTitle>
                    <CardDescription>
                      {selectedClass && (
                        <>
                          学年 / 届次：{selectedClass.class.term} | 总课时：{selectedClass.class.total_lessons} | 学生数：{selectedClass.students.length}
                        </>
                      )}
                    </CardDescription>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setShowClassDetail(false);
                      setSelectedClass(null);
                      setSelectedStudents(new Set());
                      setEditingStudentId(null);
                    }}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="flex-1 overflow-hidden flex flex-col gap-4">
                {loadingClassDetail ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-8 w-8 animate-spin text-slate-400" />
                  </div>
                ) : selectedClass ? (
                  <>
                    {/* 工具栏 */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="relative flex-1 min-w-[200px]">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
                        <Input
                          placeholder="搜索学生姓名..."
                          value={searchTerm}
                          onChange={(e) => setSearchTerm(e.target.value)}
                          className="pl-9"
                        />
                      </div>
                      {/* 学生筛选 */}
                      <Select value={studentFilter} onValueChange={(v: 'all' | 'normal' | 'excluded') => setStudentFilter(v)}>
                        <SelectTrigger className="w-32">
                          <SelectValue placeholder="学生范围" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">全部学生</SelectItem>
                          <SelectItem value="normal">正常学生</SelectItem>
                          <SelectItem value="excluded">已排除</SelectItem>
                        </SelectContent>
                      </Select>
                      {excludedStudents.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-orange-600 border-orange-200 hover:bg-orange-50"
                          onClick={() => exportExcludedStudents()}
                        >
                          <Download className="h-4 w-4 mr-1" />
                          导出已排除 ({excludedStudents.length})
                        </Button>
                      )}
                      <div className="flex items-center gap-2">
                        <Checkbox
                          checked={selectedStudents.size === filteredStudents.length && filteredStudents.length > 0}
                          onCheckedChange={handleSelectAll}
                          id="select-all"
                        />
                        <label htmlFor="select-all" className="text-sm cursor-pointer">
                          全选 ({selectedStudents.size}/{filteredStudents.length})
                        </label>
                      </div>
                      {selectedStudents.size > 0 && (
                        <>
                          <div className="flex items-center gap-1">
                            <Input
                              type="number"
                              min={0}
                              step={1}
                              placeholder="课时"
                              className="w-20 h-9"
                              value={batchLessonInput}
                              onChange={(e) => setBatchLessonInput(e.target.value)}
 disabled={batchApplying}
                            />
                            <Button
                              variant="secondary"
                              size="sm"
                              disabled={batchApplying}
                              onClick={() => void handleBatchApplyLessons()}
                            >
                              {batchApplying ? (
                                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                              ) : null}
                              批量填入课时
                            </Button>
                          </div>
                          <Button
                            variant="destructive"
                            size="sm"
                            onClick={handleBatchDelete}
                          >
                            <Trash2 className="h-4 w-4 mr-1" />
                            删除选中 ({selectedStudents.size})
                          </Button>
                        </>
                      )}
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleExportClass()}
                      >
                        <Download className="h-4 w-4 mr-1" />
                        导出名单
                      </Button>
                    </div>

                    {/* 学生列表 */}
                    <div className="border rounded-lg overflow-hidden flex-1 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="w-10"></TableHead>
                            <TableHead>姓名</TableHead>
                            <TableHead className="text-center">已上课时</TableHead>
                            <TableHead className="text-center">总课时</TableHead>
                            <TableHead className="text-center">出勤率</TableHead>
                            <TableHead className="text-center">半免</TableHead>
                            <TableHead className="text-center w-24">操作</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {filteredStudents.map((student) => (
                            <TableRow
                              key={student.id}
                              className={student.is_excluded ? 'bg-red-50/50 dark:bg-red-900/10' : ''}
                            >
                              <TableCell>
                                <Checkbox
                                  checked={selectedStudents.has(student.id)}
                                  onCheckedChange={() => handleSelectStudent(student.id)}
                                />
                              </TableCell>
                              <TableCell className="font-medium">{student.name}</TableCell>
                              <TableCell className="text-center">
                                {editingStudentId === student.id ? (
                                  <Input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={editedStudent?.lessons_attended ?? 0}
                                    onChange={(e) =>
                                      setEditedStudent((prev) =>
                                        prev
                                          ? { ...prev, lessons_attended: parseInt(e.target.value, 10) || 0 }
                                          : null
                                      )
                                    }
                                    className="w-20 mx-auto text-center"
                                  />
                                ) : (
                                  <Input
                                    type="number"
                                    min={0}
                                    step={1}
                                    value={lessonDrafts[student.id] ?? String(student.lessons_attended)}
                                    onChange={(e) =>
                                      setLessonDrafts((prev) => ({ ...prev, [student.id]: e.target.value }))
                                    }
                                    onBlur={() => void commitLessonOnBlur(student)}
                                    className="w-20 mx-auto text-center"
                                  />
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                {selectedClass.class.total_lessons}
                              </TableCell>
                              <TableCell className="text-center">
                                {(
                                  (Math.min(
                                    editingStudentId === student.id && editedStudent
                                      ? editedStudent.lessons_attended
                                      : lessonsForRowDisplay(student),
                                    selectedClass.class.total_lessons
                                  ) /
                                    selectedClass.class.total_lessons) *
                                  100
                                ).toFixed(0)}
                                %
                              </TableCell>
                              <TableCell className="text-center">
                                {editingStudentId === student.id ? (
                                  <Checkbox
                                    checked={editedStudent?.is_half_free || false}
                                    onCheckedChange={(checked) => setEditedStudent((prev) => prev ? { ...prev, is_half_free: !!checked } : null)}
                                  />
                                ) : (
                                  <Badge variant={student.is_excluded ? 'destructive' : 'secondary'}>
                                    {student.is_excluded ? '已排除' : '正常'}
                                  </Badge>
                                )}
                              </TableCell>
                              <TableCell className="text-center">
                                {editingStudentId === student.id ? (
                                  <div className="flex items-center justify-center gap-1">
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      onClick={handleSaveEdit}
                                    >
                                      <CheckCircle2 className="h-4 w-4 text-green-500" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-8 w-8 p-0"
                                      onClick={handleCancelEdit}
                                    >
                                      <XCircle className="h-4 w-4 text-red-500" />
                                    </Button>
                                  </div>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    className="h-8"
                                    onClick={() => handleStartEdit(student)}
                                  >
                                    <Edit className="h-4 w-4" />
                                  </Button>
                                )}
                              </TableCell>
                            </TableRow>
                          ))}
                          {filteredStudents.length === 0 && (
                            <TableRow>
                              <TableCell colSpan={7} className="text-center py-8 text-slate-500">
                                {searchTerm ? '没有找到符合条件的学生' : '暂无学生数据'}
                              </TableCell>
                            </TableRow>
                          )}
                        </TableBody>
                      </Table>
                    </div>
                  </>
                ) : (
                  <div className="text-center py-12 text-slate-500">
                    加载失败
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* 编辑班级 */}
        <Dialog open={showEditClass} onOpenChange={setShowEditClass}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>编辑班级信息</DialogTitle>
              <DialogDescription>
                修改班级名称与总课时数
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label htmlFor="edit-class-name">班级名称</Label>
                <Input
                  id="edit-class-name"
                  value={editClassName}
                  onChange={(e) => setEditClassName(e.target.value)}
                  placeholder="例如：寒假提高班"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-class-lessons">总课时数</Label>
                <Input
                  id="edit-class-lessons"
                  type="number"
                  min="1"
                  value={editClassLessons}
                  onChange={(e) => setEditClassLessons(e.target.value)}
                  placeholder="例如：12"
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowEditClass(false)} disabled={savingClass}>
                取消
              </Button>
              <Button onClick={handleSaveEditClass} disabled={savingClass}>
                {savingClass && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                保存修改
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

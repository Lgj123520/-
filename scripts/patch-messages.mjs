import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '..', 'src', 'app', 'page.tsx');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

const byLine = {
  138: '  /** 续读名单导出：按源班级 / 续读目标班级筛选 */',
  141: '  /** 未续班名单导出：按源班级筛选 */',
  144: '  // 相似姓名匹配',
  188: "      const g = row.grade ?? '未标注年级';",
  198: '  /** 按年级汇总；若 API 返回 grade_stats 则优先使用该数据 */',
  291: '  // 删除学生',
  326: "        setMessage({ type: 'error', text: data.error || '上传失败' });",
  329: "      setMessage({ type: 'error', text: error instanceof Error ? error.message : '上传失败' });",
  338: "      setMessage({ type: 'error', text: '请选择源学期与目标学期' });",
  367: '  // 查找相似姓名',
  370: "      setMessage({ type: 'error', text: '请选择源学期与目标学期' });",
  390: "        setMessage({ type: 'error', text: data.error || '查找失败' });",
  393: "      setMessage({ type: 'error', text: error instanceof Error ? error.message : '查找失败' });",
  399: '  // 切换选中匹配',
  413: "      setMessage({ type: 'error', text: '请至少选择一个匹配项' });",
  436: '        // 重新查找相似姓名',
  438: '        // 若已选统计学期则自动重新计算续班率',
  447: "        setMessage({ type: 'error', text: data.error || '匹配失败' });",
  450: "      setMessage({ type: 'error', text: error instanceof Error ? error.message : '匹配失败' });",
  456: '  // 查看班级详情',
  479: '  // 删除班级',
  481: '    if (!confirm(`确定要删除班级「${className}」吗？\\n此操作不可恢复。`)) {',
  489: "        setMessage({ type: 'success', text: '班级已删除' });",
  492: "        setMessage({ type: 'error', text: data.error || '删除失败' });",
  495: "      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除失败' });",
  533: "        setMessage({ type: 'error', text: data.error || '保存失败' });",
  536: "      setMessage({ type: 'error', text: error instanceof Error ? error.message : '保存失败' });",
  563: "    const headers = ['序号', '姓名', '已上课时', '总课时', '出勤率', '半免', '备注'];",
  602: '  // 全选/取消全选学生',
  615: "    const headers = ['序号', '姓名', '已上课时', '总课时', '出勤率', '备注'];",
  642: '  // 批量删除选中学生',
  645: '    if (!confirm(`确定要删除选中的 ${selectedStudents.size} 名学生吗？`)) return;',
  655: '        setMessage({ type: \'success\', text: `已删除 ${data.deleted_count} 名学生` });',
  658: "        setMessage({ type: 'error', text: data.error || '删除失败' });",
  661: "      setMessage({ type: 'error', text: error instanceof Error ? error.message : '删除失败' });",
  731: "      setMessage({ type: 'error', text: '请输入有效的上课次数（非负整数）' });",
  748: '        setMessage({ type: \'success\', text: `已更新 ${sc} 名学生的上课次数` });',
  753: "        setMessage({ type: 'error', text: data.error || '批量更新失败' });",
  756: "      setMessage({ type: 'error', text: error instanceof Error ? error.message : '批量更新失败' });",
  787: "        setMessage({ type: 'success', text: '修改成功' });",
  814: '  // 统计被排除的学生',
  819: '  // 导出未续班学生名单，可按源班级筛选',
  823: "    const headers = ['序号', '姓名', '源班级', '已上课时', '总课时', '出勤率'];",
  827: "      student.class_name || '未知班级',",
  854: '  // 导出续班学生名单，可按源班级 + 续读目标班级筛选',
  858: "    const headers = ['序号', '姓名', '源班级', '续读班级', '已上课时', '总课时', '出勤率'];",
};

for (const [ln, text] of Object.entries(byLine)) {
  const i = Number(ln) - 1;
  lines[i] = text;
}

fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('patched', Object.keys(byLine).length, 'lines');

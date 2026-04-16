import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '..', 'src', 'app', 'page.tsx');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

const byLine = {
  59: '  /** 续读学生所在目标学期班级名称，多班用顿号连接 */',
  903: '            上传点名册，自动计算续班率，支持排除半免和上课不足学生。',
  934: '              姓名匹配',
  948: '                  上传 Excel 或 CSV 格式的点名册文件，系统自动解析学生信息。',
  976: '                    <label className="text-sm font-medium">总课时数</label>',
  987: '                  <label className="text-sm font-medium">选择点名文件</label>',
  999: "                        {file ? file.name : '点击选择文件或将文件拖放到此处'}",
  1001: '                      <p className="text-sm text-slate-500 mt-2">支持 Excel (.xlsx, .xls) 与 CSV 格式</p>',
  1009: '                    <li>第一行为表头，包含姓名、上课次数或出勤次数、备注</li>',
  1010: '                    <li>姓名列必须填写；上课次数列填写数字，表示实际上课次数</li>',
  1011:
      '                    <li>备注列包含以下关键词：<strong>半免、免费、退费、试听、休学、退学、退款、取消</strong></li>',
  1012: '                    <li>备注中包含以上关键词的学生将被自动排除，不计入有效人数</li>',
};

for (const [ln, text] of Object.entries(byLine)) {
  const i = Number(ln) - 1;
  lines[i] = text;
}

fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('patched', Object.keys(byLine).length, 'lines');

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const p = path.join(__dirname, '..', 'src', 'app', 'page.tsx');
const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);

const edits = {
  /* 1-based line numbers */
  1195: '                  选择源学期与目标学期，计算续班率，自动排除半免与上课不足总课时1/3的学生。',
  1219: '                        <SelectValue placeholder="请选择目标学期" />',
  1657: '          {/* 姓名匹配 */}',
  1661: '                <CardTitle className="text-blue-600">姓名匹配</CardTitle>',
  1663: '                  查找源学期与目标学期中学生姓名相似的情况，解决同名不同人导致的续班率统计误差。',
  1687: '                        <SelectValue placeholder="请选择目标学期" />',
};

for (const [ln, content] of Object.entries(edits)) {
  const i = Number(ln) - 1;
  if (lines[i] === undefined) throw new Error('missing line ' + ln);
  lines[i] = content;
}

fs.writeFileSync(p, lines.join('\n'), 'utf8');
console.log('patched', Object.keys(edits).length, 'lines');

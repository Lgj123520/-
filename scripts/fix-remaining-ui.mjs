import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'page.tsx');
let s = fs.readFileSync(p, 'utf8');

const reps = [
  [/操作\uFFFD源班级/g, '全部源班级'],
  [/操作\uFFFD续读班级/g, '全部续读班级'],
  [/操作\uFFFD→/g, '出勤率'],
  [
    `                            <TableHead className="text-center">操作\uFFFD→</TableHead>
                            <TableHead className="text-center">操作\uFFFD</TableHead>
                            <TableHead className="text-center w-24">操作</TableHead>`,
    `                            <TableHead className="text-center">出勤率</TableHead>
                            <TableHead className="text-center">半免</TableHead>
                            <TableHead className="text-center w-24">操作</TableHead>`,
  ],
];

for (const [a, b] of reps) {
  s = s.replace(a, b);
}

fs.writeFileSync(p, s, 'utf8');
console.log('ok');

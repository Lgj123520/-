import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const p = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'page.tsx');
let s = fs.readFileSync(p, 'utf8');
s = s.replace(/student\.class_name \|\| '操作[\s\S]{0,3}班级'/g, "student.class_name || '未知班级'");
fs.writeFileSync(p, s, 'utf8');
console.log('ok');

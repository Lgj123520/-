/**
 * 使用 .env.local 中的 DATABASE_URL 执行迁移（与 Supabase 网页无关）。
 * 用法：在项目根目录执行 pnpm db:add-sheet-total
 */
const path = require('path');
const { Client } = require('pg');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const sql = `
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS sheet_total_lessons integer;

COMMENT ON COLUMN attendance_records.sheet_total_lessons IS '点名表该行「总课时」；NULL 表示未从表识别，使用班级总课时';
`;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url || !String(url).startsWith('postgresql')) {
    console.error('错误：.env.local 里没有有效的 DATABASE_URL（应以 postgresql:// 开头）');
    process.exit(1);
  }
  const client = new Client({
    connectionString: url,
    ssl: url.includes('sslmode=require') ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await client.connect();
    await client.query(sql);
    console.log('成功：已为 attendance_records 添加 sheet_total_lessons 列（若已存在则跳过）。');
  } catch (e) {
    console.error('执行失败：', e.message || e);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
}

main();

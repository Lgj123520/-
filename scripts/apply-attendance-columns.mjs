import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env.local' });

const { Client } = pg;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  await client.query('alter table if exists public.attendance_records add column if not exists remark varchar(255);');
  await client.query('alter table if exists public.attendance_records add column if not exists is_full_free boolean not null default false;');
  await client.query("notify pgrst, 'reload schema';");
  const res = await client.query(
    "select column_name from information_schema.columns where table_schema='public' and table_name='attendance_records' and column_name in ('remark','is_full_free') order by column_name;"
  );
  console.log('columns:', res.rows.map((r) => r.column_name).join(','));
  await client.end();
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

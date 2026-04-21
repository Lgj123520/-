-- 可选迁移：为 attendance_records 增加备注字段，便于区分“免费/半免/退费”等标签
-- 在 Supabase SQL Editor 执行

alter table if exists public.attendance_records
  add column if not exists remark varchar(255);

create index if not exists attendance_remark_idx on public.attendance_records(remark);

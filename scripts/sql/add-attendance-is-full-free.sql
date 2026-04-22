-- 区分「全免/免费」与「半免」：无 remark 列时仍可根据该字段正确展示与筛选
-- 在 Supabase SQL Editor 执行（可与 add-attendance-remark.sql 分开执行）

alter table if exists public.attendance_records
  add column if not exists is_full_free boolean not null default false;

comment on column public.attendance_records.is_full_free is '是否全免（免费）；与 is_half_free 同时为真表示按免费生统计排除';

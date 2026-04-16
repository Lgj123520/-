-- 为 classes 增加 user_id，用于按登录用户隔离数据
-- 在 Supabase SQL Editor 执行本文件

alter table if exists public.classes
  add column if not exists user_id varchar(36);

-- 给历史数据兜底：如果已有班级但无 user_id，可先填占位值，后续由管理员迁移
update public.classes
set user_id = coalesce(user_id, 'legacy')
where user_id is null;

alter table public.classes
  alter column user_id set not null;

create index if not exists classes_user_idx on public.classes(user_id);
create index if not exists classes_user_term_idx on public.classes(user_id, term);

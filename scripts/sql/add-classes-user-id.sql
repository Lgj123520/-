-- classes 表需要 user_id 列（应用上传/创建班级时会写入 'shared'）
-- 在 Supabase：Project → SQL Editor → New query → 粘贴本文件 → Run

-- 1) 若无该列则新增（先可空，便于兼容已有库）
alter table if exists public.classes
  add column if not exists user_id varchar(36);

-- 2) 历史行填空；新数据默认走 shared（与当前应用一致）
update public.classes
set user_id = coalesce(nullif(trim(user_id), ''), 'legacy')
where user_id is null;

alter table public.classes
  alter column user_id set default 'shared';

alter table public.classes
  alter column user_id set not null;

create index if not exists classes_user_idx on public.classes(user_id);
create index if not exists classes_user_term_idx on public.classes(user_id, term);

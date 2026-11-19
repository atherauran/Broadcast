-- The hosted database refuses an UPDATE without a WHERE clause, so set_lesson_bells names the table's one row.
create or replace function public.set_lesson_bells(p_days jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) <> 5
    or exists(select 1 from jsonb_array_elements(p_days) d
      where case when jsonb_typeof(d) = 'array' then jsonb_array_length(d) > 12 else true end) then
    raise exception '作息表格式无效';
  end if;
  if exists(select 1 from jsonb_array_elements(p_days) d, jsonb_array_elements(d) s
    where jsonb_typeof(s) <> 'string' or (s #>> '{}') !~ '^([01][0-9]|2[0-3]):[0-5][0-9]-([01][0-9]|2[0-3]):[0-5][0-9]$') then
    raise exception '时间格式无效';
  end if;
  -- Each lesson starts before it ends and after the previous one has ended.
  if exists(select 1 from jsonb_array_elements(p_days) d, jsonb_array_elements_text(d) with ordinality as t(s, k)
    where substr(s, 1, 5) >= substr(s, 7, 5) or (k > 1 and substr(s, 1, 5) < substr(d->>(k::int - 2), 7, 5))) then
    raise exception '时间需按先后排列且不重叠';
  end if;
  update public.lesson_bells set days = p_days, updated_by = auth.uid(), updated_at = clock_timestamp() where only_row;
end $$;

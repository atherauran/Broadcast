-- 信息科技 IT joins the subjects a schedule may use.
create or replace function public.set_schedule(p_classroom text, p_days jsonb, p_teacher_name text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if not exists(select 1 from public.classrooms where id = p_classroom) then raise exception '班级无效'; end if;
  if char_length(btrim(coalesce(p_teacher_name, ''))) not between 1 and 40 then raise exception '老师姓名无效'; end if;
  if jsonb_typeof(p_days) is distinct from 'array' or jsonb_array_length(p_days) <> 5
    or exists(select 1 from jsonb_array_elements(p_days) d
      where case when jsonb_typeof(d) = 'array' then jsonb_array_length(d) > 12 else true end) then
    raise exception '课程表格式无效';
  end if;
  if exists(select 1 from jsonb_array_elements(p_days) d, jsonb_array_elements(d) s
    where case when jsonb_typeof(s) = 'string' then s #>> '{}' not in ('english','chinese','math','physics','biology','chemistry',
      'history','pe','morality','art','it','elective','club','lunch') else true end) then
    raise exception '课程无效';
  end if;
  insert into public.schedules(classroom_id, days, teacher_name, updated_by, updated_at)
    values (p_classroom, p_days, btrim(p_teacher_name), auth.uid(), clock_timestamp())
    on conflict (classroom_id) do update set days = excluded.days, teacher_name = excluded.teacher_name,
      updated_by = excluded.updated_by, updated_at = excluded.updated_at;
end $$;

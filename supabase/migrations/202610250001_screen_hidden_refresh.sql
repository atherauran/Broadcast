-- Classroom apps that predate the classrooms subscription refetch their desktop only on a display_items, schedules or
-- birthdays change (or the two-minute status check), so switching screen_hidden also touches one row of the class they can see.
-- A class with none of these rows has nothing on its desktop to hide.
create or replace function public.set_screen_hidden(p_classroom text, p_hidden boolean) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_hidden is null then raise exception '隐藏选项无效'; end if;
  update public.classrooms set screen_hidden = p_hidden where id = p_classroom;
  if not found then raise exception '班级无效'; end if;
  update public.schedules set classroom_id = classroom_id where classroom_id = p_classroom;
  if not found then update public.birthdays set classroom_id = classroom_id where classroom_id = p_classroom; end if;
  if not found then
    update public.display_items set classroom_id = classroom_id
    where id = (select id from public.display_items where classroom_id = p_classroom order by created_at desc limit 1);
  end if;
end $$;

-- The test classroom is called Test instead of 测试; nothing was sent to or bound under the old name.
delete from public.classrooms where id = '测试';
alter table public.classrooms drop constraint classrooms_id_check;
alter table public.classrooms add constraint classrooms_id_check check (id in ('8-1','8-2','8-3','8-4','8-5','8-6','Test'));
insert into public.classrooms(id) values ('Test');

-- Limit new uploads and sends to 10 MiB. Keep the existing ledger constraint
-- and downloads compatible with files already sent under the former 20 MiB limit.
update storage.buckets set file_size_limit = 10485760 where id = 'classroom-files';

create or replace function public.prepare_file_transfer(p_id uuid, p_filename text, p_size bigint, p_classrooms text[], p_teacher_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.file_transfers;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_filename is null or char_length(p_filename) not between 1 and 180
    or p_filename ~ '[\x00-\x1f<>:"/\\|?*]' or p_filename ~ '[. ]$'
    or split_part(upper(p_filename), '.', 1) ~ '^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$'
    then raise exception '文件名不适用于 Windows，请重命名后上传'; end if;
  if p_size is null or p_size not between 1 and 10485760 then raise exception '文件大小须为 1 字节至 10 MB'; end if;
  if p_teacher_name is null or char_length(btrim(p_teacher_name)) not between 1 and 40 then raise exception '请填写教师姓名'; end if;
  if coalesce(cardinality(p_classrooms), 0) not between 1 and 7 or
    (select count(distinct id) from public.classrooms where id = any(p_classrooms)) <> cardinality(p_classrooms)
    then raise exception '请选择有效的班级'; end if;
  -- Reservations share the same cap as stored files, including concurrent uploads.
  perform pg_advisory_xact_lock(7419682);
  select * into v from public.file_transfers where id = p_id;
  if found then
    if v.created_by <> auth.uid() or v.filename <> p_filename or v.size_bytes <> p_size
      or v.classrooms <> p_classrooms or v.teacher_name <> btrim(p_teacher_name) then raise exception '请求编号冲突'; end if;
    if v.deleted_at is not null or v.expires_at <= clock_timestamp()
      or (v.sent_at is null and v.created_at <= clock_timestamp() - interval '1 hour') then raise exception '上传已过期，请重新选择文件'; end if;
    return jsonb_build_object('path', v.object_path, 'sent', v.sent_at is not null, 'uploaded', exists(
      select 1 from storage.objects where bucket_id = 'classroom-files' and name = v.object_path and (metadata->>'size')::bigint = v.size_bytes));
  end if;
  if (select coalesce(sum(size_bytes), 0) from public.file_transfers f where deleted_at is null
      or exists(select 1 from storage.objects o where o.bucket_id = 'classroom-files' and o.name = f.object_path)) + p_size > 209715200
    then raise exception '临时文件已达 200 MB，请等待自动清理后重试'; end if;
  insert into public.file_transfers(id, filename, size_bytes, classrooms, teacher_name, created_by)
    values(p_id, p_filename, p_size, p_classrooms, btrim(p_teacher_name), auth.uid()) returning * into v;
  return jsonb_build_object('path', v.object_path, 'sent', false, 'uploaded', false);
end $$;

create or replace function public.send_file_transfer(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.file_transfers;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  select * into v from public.file_transfers where id = p_id and created_by = auth.uid() for update;
  if not found then raise exception '上传记录不存在'; end if;
  if v.sent_at is not null then return v.id; end if;
  if v.size_bytes > 10485760 then raise exception '文件大小须为 1 字节至 10 MB'; end if;
  if v.deleted_at is not null or v.created_at <= clock_timestamp() - interval '1 hour' then raise exception '上传已过期，请重新选择文件'; end if;
  if not exists(select 1 from storage.objects where bucket_id = 'classroom-files' and name = v.object_path
    and (metadata->>'size')::bigint = v.size_bytes) then raise exception '文件尚未上传完成'; end if;
  perform id from public.classrooms where id = any(v.classrooms) order by id for update;
  if exists(select 1 from public.classrooms where id = any(v.classrooms) and device_id is null)
    then raise exception '所选班级尚未绑定电脑'; end if;
  update public.file_transfers set sent_at = clock_timestamp(), expires_at = clock_timestamp() + interval '24 hours' where id = p_id;
  insert into public.file_deliveries(transfer_id, classroom_id, device_id)
    select p_id, id, device_id from public.classrooms where id = any(v.classrooms);
  return p_id;
end $$;

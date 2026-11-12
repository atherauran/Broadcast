create table public.file_transfers (
  id uuid primary key,
  filename text not null check (char_length(filename) between 1 and 180),
  size_bytes bigint not null check (size_bytes between 1 and 20971520),
  object_path text generated always as (id::text || '/file') stored unique,
  classrooms text[] not null,
  teacher_name text not null,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default clock_timestamp(),
  sent_at timestamptz,
  expires_at timestamptz not null default clock_timestamp() + interval '24 hours',
  deleted_at timestamptz
);
create table public.file_deliveries (
  id uuid primary key default gen_random_uuid(),
  transfer_id uuid not null references public.file_transfers(id) on delete cascade,
  classroom_id text not null references public.classrooms(id),
  device_id uuid references public.devices(id) on delete set null,
  received_at timestamptz,
  downloaded_at timestamptz,
  failed_at timestamptz,
  saved_name text,
  error text,
  unique(transfer_id, classroom_id)
);
create index file_transfers_created_idx on public.file_transfers(created_at desc, id);
create index file_deliveries_device_idx on public.file_deliveries(device_id, transfer_id);
alter table public.file_transfers enable row level security;
alter table public.file_deliveries enable row level security;
create policy read_file_transfers on public.file_transfers for select to authenticated using (public.is_admin());
create policy read_file_deliveries on public.file_deliveries for select to authenticated
  using (public.is_admin() or (public.owns_device(device_id) and classroom_id = public.device_classroom()));
grant select on public.file_transfers, public.file_deliveries to authenticated;
grant all on public.file_transfers, public.file_deliveries to service_role;

create function public.prepare_file_transfer(p_id uuid, p_filename text, p_size bigint, p_classrooms text[], p_teacher_name text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v public.file_transfers;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  if p_filename is null or char_length(p_filename) not between 1 and 180
    or p_filename ~ '[\x00-\x1f<>:"/\\|?*]' or p_filename ~ '[. ]$'
    or split_part(upper(p_filename), '.', 1) ~ '^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$'
    then raise exception '文件名不适用于 Windows，请重命名后上传'; end if;
  if p_size is null or p_size not between 1 and 20971520 then raise exception '文件大小须为 1 字节至 20 MB'; end if;
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

create function public.send_file_transfer(p_id uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare v public.file_transfers;
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  select * into v from public.file_transfers where id = p_id and created_by = auth.uid() for update;
  if not found then raise exception '上传记录不存在'; end if;
  if v.sent_at is not null then return v.id; end if;
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

create function public.pending_file_transfers() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('server_now', clock_timestamp(), 'items', coalesce((
    select jsonb_agg(jsonb_build_object('delivery_id', d.id, 'transfer_id', f.id, 'filename', f.filename,
      'size_bytes', f.size_bytes, 'object_path', f.object_path, 'expires_at', f.expires_at) order by f.created_at, f.id)
    from public.file_deliveries d join public.file_transfers f on f.id = d.transfer_id
    where public.owns_device(d.device_id) and d.classroom_id = public.device_classroom()
      and d.downloaded_at is null and d.failed_at is null and f.deleted_at is null and f.expires_at > clock_timestamp()
  ), '[]'::jsonb))
$$;

create function public.ack_file_delivery(p_delivery uuid, p_event text, p_at timestamptz, p_error text default null, p_saved_name text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.file_deliveries;
begin
  select * into v from public.file_deliveries where id = p_delivery for update;
  if not found or not public.owns_device(v.device_id) or v.classroom_id is distinct from public.device_classroom()
    then raise exception '无权提交此设备回执'; end if;
  if p_at is null or p_at > clock_timestamp() + interval '5 seconds' then raise exception '回执时间无效'; end if;
  if p_event = 'received' then
    update public.file_deliveries set received_at = coalesce(received_at, p_at) where id = p_delivery;
  elsif p_event = 'downloaded' then
    if p_saved_name is null or char_length(p_saved_name) not between 1 and 240 then raise exception '缺少保存文件名'; end if;
    update public.file_deliveries set received_at = coalesce(received_at, p_at), downloaded_at = coalesce(downloaded_at, p_at),
      saved_name = coalesce(saved_name, p_saved_name) where id = p_delivery and failed_at is null;
  elsif p_event = 'failed' then
    update public.file_deliveries set failed_at = coalesce(failed_at, p_at), error = coalesce(error, left(coalesce(p_error, '下载失败'), 300))
      where id = p_delivery and downloaded_at is null;
  else raise exception '未知回执类型'; end if;
end $$;

create function public.file_transfer_history(p_before timestamptz default null, p_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_admin() then raise exception '需要管理员验证'; end if;
  return coalesce((select jsonb_agg(to_jsonb(f) || jsonb_build_object('deliveries', (
    select jsonb_agg(to_jsonb(d) order by d.classroom_id) from public.file_deliveries d where d.transfer_id = f.id
  )) order by f.created_at desc) from (
    select * from public.file_transfers where sent_at is not null and (p_before is null or created_at < p_before) and (p_id is null or id = p_id)
    order by created_at desc limit 20
  ) f), '[]'::jsonb);
end $$;

insert into storage.buckets(id, name, public, file_size_limit)
values ('classroom-files', 'classroom-files', false, 20971520);
create policy upload_classroom_files on storage.objects for insert to authenticated with check (
  bucket_id = 'classroom-files' and public.is_admin() and exists (
    select 1 from public.file_transfers f where f.object_path = name and f.created_by = auth.uid()
      and f.sent_at is null and f.deleted_at is null and f.created_at > clock_timestamp() - interval '1 hour'
  )
);
create function public.can_download_classroom_file(p_path text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.file_transfers f join public.file_deliveries d on d.transfer_id = f.id
    where f.object_path = p_path and f.deleted_at is null and f.expires_at > clock_timestamp()
      and public.owns_device(d.device_id) and d.classroom_id = public.device_classroom()
      and d.downloaded_at is null and d.failed_at is null)
$$;
create policy download_classroom_files on storage.objects for select to authenticated
  using (bucket_id = 'classroom-files' and public.can_download_classroom_file(name));

revoke execute on function public.prepare_file_transfer(uuid,text,bigint,text[],text), public.send_file_transfer(uuid),
  public.pending_file_transfers(), public.ack_file_delivery(uuid,text,timestamptz,text,text), public.file_transfer_history(timestamptz,uuid),
  public.can_download_classroom_file(text) from public, anon;
grant execute on function public.prepare_file_transfer(uuid,text,bigint,text[],text), public.send_file_transfer(uuid),
  public.pending_file_transfers(), public.ack_file_delivery(uuid,text,timestamptz,text,text), public.file_transfer_history(timestamptz,uuid),
  public.can_download_classroom_file(text) to authenticated, service_role;
alter publication supabase_realtime add table public.file_transfers, public.file_deliveries;

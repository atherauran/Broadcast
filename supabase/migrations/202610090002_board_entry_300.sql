-- Board entries may be up to 300 characters, matching fullscreen broadcasts.
create or replace function public.display_content(p_kind text, p_content jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_title text; v_entries jsonb; v_text text;
begin
  if jsonb_typeof(p_content) is distinct from 'object' then raise exception '显示内容无效'; end if;
  if p_kind = 'board' then
    v_title := btrim(coalesce(p_content->>'title', ''));
    if v_title = '' then v_title := '公告'; end if;
    if char_length(v_title) > 30 then raise exception '标题最多 30 字'; end if;
    if jsonb_typeof(p_content->'entries') is distinct from 'array' then raise exception '请填写公告内容'; end if;
    select jsonb_agg(btrim(e) order by n) into v_entries
      from jsonb_array_elements_text(p_content->'entries') with ordinality as t(e, n) where btrim(e) <> '';
    if coalesce(jsonb_array_length(v_entries), 0) not between 1 and 12 then raise exception '公告需要 1–12 条'; end if;
    if exists(select 1 from jsonb_array_elements_text(v_entries) e where char_length(e) > 300) then raise exception '每条公告最多 300 字'; end if;
    if jsonb_typeof(p_content->'speak') is distinct from 'boolean' then raise exception '请选择是否朗读'; end if;
    if jsonb_typeof(p_content->'voice_type') is distinct from 'number'
      or (p_content->>'voice_type') not in ('101001','101004','101011','101013','101016') then raise exception '音色无效'; end if;
    return jsonb_build_object('title', v_title, 'entries', v_entries, 'speak', (p_content->'speak')::boolean,
      'voice_type', (p_content->>'voice_type')::int);
  elsif p_kind = 'note' then
    v_text := btrim(coalesce(p_content->>'text', ''));
    if char_length(v_text) not between 1 and 60 then raise exception '便签内容需要 1–60 字'; end if;
    if coalesce(p_content->>'color', '') not in ('yellow','blue','green','pink') then raise exception '便签颜色无效'; end if;
    return jsonb_build_object('text', v_text, 'color', p_content->>'color');
  elsif p_kind = 'countdown' then
    v_text := btrim(coalesce(p_content->>'label', ''));
    if char_length(v_text) > 20 then raise exception '倒计时名称最多 20 字'; end if;
    if jsonb_typeof(coalesce(p_content->'fullscreen', 'false')) <> 'boolean' then raise exception '倒计时显示方式无效'; end if;
    return jsonb_build_object('label', v_text, 'fullscreen', coalesce((p_content->'fullscreen')::boolean, false));
  end if;
  raise exception '显示类型无效';
end $$;


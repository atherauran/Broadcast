-- remove_display_items replaced remove_display_item; no client calls the old one any more.
drop function public.remove_display_item(uuid, boolean);

-- The school day has eight lessons, and only Wednesday has a ninth (starting 16:15 after its shorter break).
-- Only the untouched seed row is corrected; a bell table someone has saved is left alone.
update public.lesson_bells set days = jsonb_build_array(
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05','16:15-16:55'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05'),
  jsonb_build_array('08:30-09:10','09:25-10:05','10:20-11:00','11:15-11:50','12:40-13:20','13:35-14:15','14:30-15:10','15:25-16:05'))
where only_row and updated_by is null;

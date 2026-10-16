import { createClient } from '@supabase/supabase-js';
import type { BirthdayList, BoardDraftRow, Broadcast, Classroom, DisplayItem, Feedback, Schedule } from './domain';
export const configured = !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
export const supabase = configured ? createClient(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_ANON_KEY) : null;
export const adminEmail = import.meta.env.VITE_ADMIN_EMAIL || 'admin@broadcast.local';
export const maintainerEmail = import.meta.env.VITE_MAINTAINER_EMAIL || 'maintainer@broadcast.local';
export async function rpc<T>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error('广播服务尚未配置');
  const { data, error } = await supabase.rpc(name, args);
  if (error) throw new Error(error.message);
  return data as T;
}
export const getClassrooms = () => rpc<{ server_now: string; classrooms: Classroom[] }>('classroom_status');
export const getHistory = (before: string | null = null, id: string | null = null) =>
  rpc<Broadcast[]>('broadcast_history', { p_before: before, p_id: id });
export async function getSchedules(): Promise<Schedule[]> {
  if (!supabase) throw new Error('广播服务尚未配置');
  const { data, error } = await supabase.from('schedules').select('classroom_id, days, teacher_name, updated_at');
  if (error) throw new Error(error.message);
  return data;
}
export async function getBirthdays(): Promise<BirthdayList[]> {
  if (!supabase) throw new Error('广播服务尚未配置');
  const { data, error } = await supabase.from('birthdays').select('classroom_id, students, teacher_name, updated_at');
  if (error) throw new Error(error.message);
  return data;
}
export async function getBoardDrafts(): Promise<BoardDraftRow[]> {
  if (!supabase) throw new Error('广播服务尚未配置');
  const { data, error } = await supabase.from('board_drafts').select('id, content, classrooms, ends_at, teacher_name, updated_at');
  if (error) throw new Error(error.message);
  return data;
}
export async function getFeedback(): Promise<Feedback[]> {
  if (!supabase) throw new Error('广播服务尚未配置');
  const { data, error } = await supabase.from('feedback')
    .select('id, kind, body, teacher_name, status, created_at, updated_at, replied_at, feedback_comments(id, body, teacher_name, maintainer, created_at)')
    .order('created_at', { ascending: false }).order('created_at', { referencedTable: 'feedback_comments' });
  if (error) throw new Error(error.message);
  return data as Feedback[];
}
export const getOverview = () => rpc<{ server_now: string; items: DisplayItem[] }>('display_overview');
// A retry of the same logical request keeps its ID, so a lost response never creates a duplicate.
export async function once<T>(key: string, fingerprint: unknown, action: (id: string) => Promise<T>): Promise<T> {
  const print = JSON.stringify(fingerprint);
  let attempt: { fingerprint: string; id: string } | null = null;
  try { attempt = JSON.parse(localStorage.getItem(key) || 'null'); } catch { /* Ignore invalid local storage. */ }
  if (attempt?.fingerprint !== print) attempt = { fingerprint: print, id: crypto.randomUUID() };
  localStorage.setItem(key, JSON.stringify(attempt));
  const result = await action(attempt.id);
  localStorage.removeItem(key);
  return result;
}

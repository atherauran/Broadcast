import type { BannerPosition, Emotion, NoteColor } from '@/lib/domain';

export interface AlertDraft { body: string; repeatCount: number; autoClose: boolean; emotion: Emotion; voiceType: number; sourceId: string | null }
export interface BannerDraft { body: string; emotion: Emotion; position: BannerPosition }
export interface BoardDraft { title: string; entries: string[]; speak: boolean; voiceType: number; endAt: string }
export interface NoteDraft { text: string; color: NoteColor; endAt: string }
export interface CountdownDraft { label: string; mode: 'duration' | 'until'; minutes: number; until: string; fullscreen: boolean }
export interface Drafts { alert: AlertDraft; banner: BannerDraft; board: BoardDraft; note: NoteDraft; countdown: CountdownDraft }
export type Patch = <K extends keyof Drafts>(kind: K, change: Partial<Drafts[K]>) => void;

// An empty endAt means "end of today", evaluated when sending so a page left open overnight stays correct.
export const initialDrafts = (): Drafts => ({
  alert: { body: localStorage.getItem('broadcast-draft') || '', repeatCount: 1, autoClose: true, emotion: 'normal', voiceType: 101001, sourceId: null },
  banner: { body: '', emotion: 'normal', position: 'top' },
  board: { title: '', entries: [''], speak: false, voiceType: 101001, endAt: '' },
  note: { text: '', color: 'yellow', endAt: '' },
  countdown: { label: '', mode: 'duration', minutes: 25, until: '', fullscreen: false },
});

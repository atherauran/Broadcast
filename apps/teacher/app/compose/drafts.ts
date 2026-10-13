import type { BannerPosition, BoardTheme, Emotion, NoteColor } from '@/lib/domain';

export interface AlertDraft { body: string; repeatCount: number; autoClose: boolean; emotion: Emotion; voiceType: number; sourceId: string | null }
export interface BannerDraft { body: string; emotion: Emotion; position: BannerPosition }
// publishAt is empty to publish right away; draftId is the saved board being edited, if any.
export interface BoardDraft {
  title: string; entries: string[]; endAt: string; theme: BoardTheme; publishAt: string; draftId: string | null;
}
export interface NoteDraft { text: string; color: NoteColor; endAt: string }
export interface CountdownDraft { label: string; mode: 'duration' | 'until' | 'days'; minutes: number; until: string; date: string; fullscreen: boolean }
export interface Drafts { alert: AlertDraft; banner: BannerDraft; board: BoardDraft; note: NoteDraft; countdown: CountdownDraft }
export type Patch = <K extends keyof Drafts>(kind: K, change: Partial<Drafts[K]>) => void;

// What a board composer returns to after sending, saving or leaving a saved board; the theme stays as chosen.
export const blankBoard = (): Partial<BoardDraft> => ({ title: '', entries: [''], endAt: '', publishAt: '', draftId: null });

// An empty endAt means "end of the day it starts", evaluated when sending so a page left open overnight stays correct.
export const initialDrafts = (): Drafts => ({
  alert: { body: localStorage.getItem('broadcast-draft') || '', repeatCount: 1, autoClose: true, emotion: 'normal', voiceType: 101001, sourceId: null },
  banner: { body: '', emotion: 'normal', position: 'top' },
  board: { title: '', entries: [''], endAt: '', theme: 'plain', publishAt: '', draftId: null },
  note: { text: '', color: 'yellow', endAt: '' },
  countdown: { label: '', mode: 'duration', minutes: 25, until: '', date: '', fullscreen: false },
});

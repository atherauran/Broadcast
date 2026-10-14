import { useRef, useState } from 'react';
import { Camera } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { loadOcr, readImage, type OcrLine } from '@/lib/ocr';

// Reads a photo on this device; nothing is uploaded. The result only fills the editor, so the teacher checks it before saving.
export function PhotoImport({ disabled, onLines, onError }: { disabled: boolean; onLines: (lines: OcrLine[]) => void; onError: (message: string) => void }) {
  const [state, setState] = useState<'' | 'loading' | 'reading'>('');
  const input = useRef<HTMLInputElement>(null);
  async function pick(file: File) {
    onError('');
    try {
      setState('loading');
      const read = await loadOcr();
      setState('reading');
      onLines(await read(await readImage(file)));
    } catch (e) { onError(e instanceof Error ? e.message : '识别失败'); }
    finally { setState(''); if (input.current) input.current.value = ''; }
  }
  return <>
    <input ref={input} type="file" accept="image/*" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void pick(file); }} />
    <Button type="button" variant="outline" className="action photo-import" disabled={disabled || !!state} onClick={() => input.current?.click()}>
      <Camera size={17} />{state === 'loading' ? '加载识别模型…' : state === 'reading' ? '识别中…' : '拍照识别'}
    </Button>
  </>;
}

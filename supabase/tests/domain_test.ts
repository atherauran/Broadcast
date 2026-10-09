import { validateTargets } from '../functions/_shared/domain.ts';
function rejects(fn: () => unknown) { try { fn(); } catch { return; } throw new Error('Expected rejection'); }
Deno.test('classroom validation', () => {
  if (validateTargets(['8-1', '8-6']).length !== 2) throw new Error('Assertion failed');
  rejects(() => validateTargets([])); rejects(() => validateTargets(['8-1', '8-1'])); rejects(() => validateTargets(['8-7']));
});

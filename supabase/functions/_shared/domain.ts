export const CLASSROOMS = ['8-1', '8-2', '8-3', '8-4', '8-5', '8-6', 'Test'] as const;

export function validateTargets(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > CLASSROOMS.length ||
    value.some((id) => !CLASSROOMS.includes(id)) || new Set(value).size !== value.length) {
    throw new Error('请选择有效的班级');
  }
  return value;
}

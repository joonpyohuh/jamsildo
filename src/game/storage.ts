let owner = '';
const memory = new Map<string, string>();
export function useSaveOwner(id: string): void { owner = id; }
const key = (name: string): string => owner ? `jamsildo.${owner}.${name}` : `jamsildo.${name}`;
export function readSave(name = 'campaign'): string | null {
  let value: string | null = memory.get(key(name)) ?? null;
  if (!memory.has(key(name))) try { value = localStorage.getItem(key(name)); } catch { /* 기기 저장이 차단되어도 현재 탭과 계정 저장은 유지한다. */ }
  return name === 'campaign' && value === 'null' ? null : value;
}
export function writeSave(value: string, name = 'campaign'): boolean {
  try { localStorage.setItem(key(name), value); memory.delete(key(name)); return true; }
  catch { memory.set(key(name), value); return false; }
}

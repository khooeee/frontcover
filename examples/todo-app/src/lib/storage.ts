import type { Todo } from '../types';

const KEY = 'todos';

export function loadTodos(): Todo[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Stored todos are not a list');
    }
    return parsed;
  } catch (error) {
    console.warn('Discarding unreadable todos', error);
    localStorage.removeItem(KEY);
    return [];
  }
}

export function saveTodos(todos: Todo[]): void {
  localStorage.setItem(KEY, JSON.stringify(todos));
}

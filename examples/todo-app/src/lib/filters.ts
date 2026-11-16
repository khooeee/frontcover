import type { Filter, Todo } from '../types';

export function applyFilter(todos: Todo[], filter: Filter): Todo[] {
  switch (filter) {
    case 'active':
      return todos.filter((todo) => !todo.done);
    case 'done':
      return todos.filter((todo) => todo.done);
    default:
      return todos;
  }
}

export function summarize(todos: Todo[]): string {
  const remaining = todos.filter((todo) => !todo.done).length;
  if (todos.length === 0) return 'Nothing to do';
  if (remaining === 0) return 'All done';
  return remaining === 1 ? '1 item left' : `${remaining} items left`;
}

import { lazy, Suspense, useEffect, useState, type FormEvent } from 'react';
import { TodoItem } from './components/TodoItem';
import { applyFilter, summarize } from './lib/filters';
import { loadTodos, saveTodos } from './lib/storage';
import type { Filter, Todo } from './types';

const Settings = lazy(() => import('./pages/Settings'));

const FILTERS: Filter[] = ['all', 'active', 'done'];

export function App() {
  const [todos, setTodos] = useState<Todo[]>(loadTodos);
  const [filter, setFilter] = useState<Filter>('all');
  const [title, setTitle] = useState('');
  const [error, setError] = useState('');
  const [page, setPage] = useState<'todos' | 'settings'>('todos');

  useEffect(() => {
    saveTodos(todos);
  }, [todos]);

  function addTodo(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Enter a title first');
      return;
    }
    if (todos.some((todo) => todo.title === trimmed)) {
      setError(`"${trimmed}" is already on the list`);
      return;
    }
    setTodos([...todos, { id: crypto.randomUUID(), title: trimmed, done: false }]);
    setTitle('');
    setError('');
  }

  function toggleTodo(id: string) {
    setTodos(todos.map((todo) => (todo.id === id ? { ...todo, done: !todo.done } : todo)));
  }

  function deleteTodo(id: string) {
    setTodos(todos.filter((todo) => todo.id !== id));
  }

  function renameTodo(id: string, newTitle: string) {
    setTodos(todos.map((todo) => (todo.id === id ? { ...todo, title: newTitle } : todo)));
  }

  return (
    <main>
      <nav>
        <button onClick={() => setPage('todos')}>Todos</button>
        <button onClick={() => setPage('settings')}>Settings</button>
      </nav>

      {page === 'settings' ? (
        <Suspense fallback={<p>Loading…</p>}>
          <Settings onClearAll={() => setTodos([])} />
        </Suspense>
      ) : (
        <section>
          <h1>Todos</h1>
          <form onSubmit={addTodo}>
            <input
              aria-label="New todo"
              placeholder="What needs doing?"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
            <button type="submit">Add</button>
          </form>
          {error && <p role="alert">{error}</p>}

          <div role="group" aria-label="Filter">
            {FILTERS.map((name) => (
              <button key={name} aria-pressed={filter === name} onClick={() => setFilter(name)}>
                {name}
              </button>
            ))}
          </div>

          <ul>
            {applyFilter(todos, filter).map((todo) => (
              <TodoItem
                key={todo.id}
                todo={todo}
                onToggle={toggleTodo}
                onDelete={deleteTodo}
                onRename={renameTodo}
              />
            ))}
          </ul>
          <p>{summarize(todos)}</p>
        </section>
      )}
    </main>
  );
}

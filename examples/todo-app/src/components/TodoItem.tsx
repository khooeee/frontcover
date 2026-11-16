import { useState } from 'react';
import type { Todo } from '../types';

interface Props {
  todo: Todo;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

export function TodoItem({ todo, onToggle, onDelete, onRename }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(todo.title);

  function commit() {
    const title = draft.trim();
    if (title && title !== todo.title) {
      onRename(todo.id, title);
    } else {
      setDraft(todo.title);
    }
    setEditing(false);
  }

  if (editing) {
    return (
      <li>
        <input
          aria-label="Edit title"
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === 'Enter') commit();
            if (event.key === 'Escape') {
              setDraft(todo.title);
              setEditing(false);
            }
          }}
        />
      </li>
    );
  }

  return (
    <li>
      <label>
        <input type="checkbox" checked={todo.done} onChange={() => onToggle(todo.id)} />
        <span style={{ textDecoration: todo.done ? 'line-through' : 'none' }}>{todo.title}</span>
      </label>
      <button onClick={() => setEditing(true)}>Rename</button>
      <button onClick={() => onDelete(todo.id)}>Delete</button>
    </li>
  );
}

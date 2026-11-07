/** Todos in the order /todo shows them (and ↑↓ walks them): open ones
 *  first, then done ones, each group in its stored order. */
export function orderedTodos(todos) {
    return [...todos.filter(t => !t.done), ...todos.filter(t => t.done)];
}

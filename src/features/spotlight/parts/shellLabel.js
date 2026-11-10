/** What a spotlight shell (/shell) is called: the command it was started
 *  with, else the folder its shell reports (its title), else "Shell". */
export function shellLabel(shell) {
    if (shell.command) return shell.command;
    const title = (shell.title || '').replace(/[\\/]+$/, '');
    return title ? title.split(/[\\/]/).pop() || title : 'Shell';
}

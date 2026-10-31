import { spawn } from 'node:child_process';
/** The command could not be started at all - most likely it is not installed. */
export class CommandNotFoundError extends Error {
    command;
    constructor(command) {
        super(`${command} was not found on PATH`);
        this.command = command;
    }
}
/** The real runner: `child_process.spawn`, inheriting this process's environment. */
export const spawnRunner = (invocation) => new Promise((done, fail) => {
    const child = spawn(invocation.command, [...invocation.args], {
        cwd: invocation.cwd,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
        if (invocation.stream)
            process.stdout.write(chunk);
    });
    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
        if (invocation.stream)
            process.stderr.write(chunk);
    });
    child.on('error', (cause) => fail(cause.code === 'ENOENT' ? new CommandNotFoundError(invocation.command) : cause));
    child.on('close', (code, signal) => done({ exitCode: code ?? (signal ? 128 : 1), stdout, stderr }));
});

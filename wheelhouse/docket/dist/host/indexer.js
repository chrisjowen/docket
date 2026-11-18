import { rebuild } from '../commands/rebuild.js';
import { sync } from '../commands/sync.js';
import { SyncBusyError, SyncRunner } from '../open/sync-run.js';
export class ProjectIndexer {
    /** Runs the syncs, and reports the latest and how each instance stands (`GET /api/sync`). */
    runner;
    #wanted = false;
    #fresh = false;
    #draining = null;
    #timer = null;
    constructor(options) {
        const runSync = options.runSync ?? sync;
        const runRebuild = options.runRebuild ?? rebuild;
        this.runner = new SyncRunner(options.cwd, (syncOptions) => {
            if (!this.#fresh)
                return runSync(syncOptions);
            this.#fresh = false;
            return runRebuild(syncOptions);
        });
        const intervalMs = options.intervalMs ?? 60_000;
        if (intervalMs > 0) {
            this.#timer = setInterval(() => this.kick(), intervalMs);
            this.#timer.unref();
        }
    }
    /** Brings the projections up to the files soon: now, or once the sync running finishes. */
    kick() {
        this.#wanted = true;
        this.#draining ??= this.#drain().finally(() => {
            this.#draining = null;
        });
    }
    async #drain() {
        while (this.#wanted) {
            this.#wanted = false;
            await this.runner.settled();
            try {
                this.runner.start(null);
            }
            catch (cause) {
                if (!(cause instanceof SyncBusyError))
                    throw cause;
                this.#wanted = true;
                continue;
            }
            await this.runner.settled();
        }
    }
    /** Resolves once every write so far is projected (or its sync has failed). */
    async idle() {
        while (this.#draining)
            await this.#draining;
        await this.runner.settled();
        return this.runner.current;
    }
    /** Resets every instance and projects everything again, after any sync running; the run, once done. */
    async rebuild() {
        await this.idle();
        this.#fresh = true;
        this.kick();
        return this.idle();
    }
    /** Stops syncing on the interval, and waits for a sync running to finish. */
    async close() {
        if (this.#timer)
            clearInterval(this.#timer);
        this.#timer = null;
        await this.idle();
    }
}

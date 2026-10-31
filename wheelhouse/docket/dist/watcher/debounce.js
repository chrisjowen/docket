export const createDebouncer = (delayMs, run) => {
    const timers = new Map();
    return {
        schedule(key) {
            clearTimeout(timers.get(key));
            timers.set(key, setTimeout(() => {
                timers.delete(key);
                run(key);
            }, delayMs));
        },
        cancel() {
            for (const timer of timers.values())
                clearTimeout(timer);
            timers.clear();
        }
    };
};

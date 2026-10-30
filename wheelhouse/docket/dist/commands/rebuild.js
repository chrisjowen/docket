import { reconcile } from './sync.js';
/**
 * Reset each adapter instance - or only those `adapters` names - and project
 * every canonical input into it (spec §39). Logically `rm -rf .docket/.index
 * && docket sync`, but routed through each instance's projection port, so
 * non-file stores are reset too - each in its own configured namespace only.
 * Instances not named keep their projection and their manifest.
 */
export const rebuild = (options = {}) => reconcile({ ...options, fresh: true });

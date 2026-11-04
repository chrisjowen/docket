import { CLOUD_WORKSPACE_PATTERN, DEFAULT_CLOUD_URL } from '../bundled/adapter-kit/dist/index.js';
import { loadConfig } from '../config/loader.js';
/** The module a `cloud` adapter instance names, which `docket cloud link` writes. */
export const CLOUD_ADAPTER_MODULE = '@docket/adapter-cloud';
/** The instance id `docket cloud link` gives the cloud adapter. */
export const CLOUD_ADAPTER_ID = 'cloud';
export const parseWorkspace = (value) => {
    if (!CLOUD_WORKSPACE_PATTERN.test(value)) {
        throw new Error(`"${value}" is not <org>/<workspace>: give it as the cloud's URLs do, e.g. acme/platform.`);
    }
    const [org, workspace] = value.split('/');
    return { org, workspace };
};
/** The project's cloud link, when it has one: its first adapter instance of the cloud module. */
export const cloudLinkOf = (resolved) => {
    const entry = resolved.config.adapters.find((adapter) => adapter.module === CLOUD_ADAPTER_MODULE);
    if (entry === undefined)
        return undefined;
    const config = (entry.config ?? {});
    if (typeof config.workspace !== 'string') {
        throw new Error(`Adapter "${entry.id}" (${CLOUD_ADAPTER_MODULE}) has no workspace: run \`docket cloud link <org>/<workspace>\` again.`);
    }
    return {
        id: entry.id,
        url: typeof config.url === 'string' ? config.url : DEFAULT_CLOUD_URL,
        ...parseWorkspace(config.workspace),
        ...(typeof config.tokenEnv === 'string' ? { tokenEnv: config.tokenEnv } : {})
    };
};
/** The project at or above `cwd`, and its cloud link - which must exist. */
export const requireCloudLink = async (cwd) => {
    const resolved = await loadConfig(cwd);
    const link = cloudLinkOf(resolved);
    if (link === undefined) {
        throw new Error(`Not linked to a cloud workspace: run \`docket cloud link <org>/<workspace>\` first, then \`docket cloud login\`.`);
    }
    return { resolved, link };
};

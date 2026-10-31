export const error = (code, message, where = {}) => ({ severity: 'error', code, message, ...where });
export const warning = (code, message, where = {}) => ({ severity: 'warning', code, message, ...where });
export const hasErrors = (diagnostics) => diagnostics.some((d) => d.severity === 'error');

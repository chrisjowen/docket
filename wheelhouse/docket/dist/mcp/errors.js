/** JSON-RPC's error codes. */
export const PARSE_ERROR = -32700;
export const INVALID_REQUEST = -32600;
export const METHOD_NOT_FOUND = -32601;
export const INVALID_PARAMS = -32602;
export const RESOURCE_NOT_FOUND = -32002;
/** An error the MCP server answers as a JSON-RPC error with its code. */
export class RpcError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
/** A tool was called with arguments it does not take: answered as JSON-RPC's invalid params. */
export class InvalidArgumentsError extends RpcError {
    constructor(message) {
        super(INVALID_PARAMS, message);
    }
}

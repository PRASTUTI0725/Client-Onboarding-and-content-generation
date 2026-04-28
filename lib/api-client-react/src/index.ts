export * from "./generated/api";
export * from "./generated/api.schemas";
export {
  setBaseUrl,
  setAuthTokenGetter,
  setDefaultHeaders,
  customFetch,
} from "./custom-fetch";
export type { AuthTokenGetter, ErrorType } from "./custom-fetch";
export { ApiError, ResponseParseError } from "./custom-fetch";

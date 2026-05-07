import { getRequestContextFromHeaders } from "@selectdb/auth";

export function getRequestContext(headers: Headers) {
  return getRequestContextFromHeaders(headers);
}

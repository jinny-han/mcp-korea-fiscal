export interface ResultCodeClassification {
  /** True if this code represents a successful response (incl. empty). */
  ok: boolean;
  /** True if response is INFO-200 "no data" — successful but no rows. */
  empty: boolean;
  /** True if the error is transient (server/db/sql) and worth retrying. */
  retryable: boolean;
}

/**
 * Classifies Korean public-fiscal API result codes.
 *
 * Both 열린재정 (kofin) and 지방재정365 (lofin) follow the same
 * INFO-XXX/ERROR-XXX convention. This is a single source of truth.
 */
export function classifyResultCode(resultCode: string): ResultCodeClassification {
  if (resultCode === "INFO-000") {
    return { ok: true, empty: false, retryable: false };
  }
  if (resultCode === "INFO-200") {
    return { ok: true, empty: true, retryable: false };
  }
  // 5xx-class server/db/sql errors are transient
  const numeric = resultCode.replace(/^[A-Z]+-/, "");
  if (["500", "600", "601"].includes(numeric)) {
    return { ok: false, empty: false, retryable: true };
  }
  // All other codes (auth, limits, missing params, unknown) are terminal
  return { ok: false, empty: false, retryable: false };
}

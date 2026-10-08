import https from "node:https";

export function requestWithInsecureTls(target: URL, requestSignal?: AbortSignal) {
  return new Promise<{ statusCode: number }>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout;
    let request: ReturnType<typeof https.request>;

    const cleanup = () => {
      clearTimeout(timeout);
      requestSignal?.removeEventListener("abort", abort);
    };
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };
    const abort = () => {
      finish(() => {
        request.destroy();
        reject(new Error("Health check aborted"));
      });
    };

    request = https.request(target, { method: "GET", rejectUnauthorized: false }, (response) => {
      const statusCode = response.statusCode ?? 0;
      response.resume();
      response.once("end", () => finish(() => resolve({ statusCode })));
      response.once("error", (error) => finish(() => reject(error)));
    });
    timeout = setTimeout(() => {
      finish(() => {
        request.destroy();
        reject(new Error("Health check timed out"));
      });
    }, 4500);
    request.once("error", (error) => {
      finish(() => reject(error));
    });
    requestSignal?.addEventListener("abort", abort, { once: true });
    if (requestSignal?.aborted) {
      abort();
      return;
    }
    request.once("close", cleanup);
    request.end();
  });
}

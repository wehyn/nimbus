import https from "node:https";
import type { IncomingMessage } from "node:http";

export function requestWithInsecureTls(target: URL, requestSignal?: AbortSignal) {
  return new Promise<{ statusCode: number }>((resolve, reject) => {
    let settled = false;
    let timeout: NodeJS.Timeout;
    let request: ReturnType<typeof https.request>;
    let response: IncomingMessage | undefined;

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

    request = https.request(target, { method: "GET", rejectUnauthorized: false }, (incomingResponse) => {
      response = incomingResponse;
      const statusCode = incomingResponse.statusCode ?? 0;
      incomingResponse.resume();
      incomingResponse.once("end", () => finish(() => resolve({ statusCode })));
      incomingResponse.once("error", (error) => finish(() => reject(error)));
      incomingResponse.once("close", () => {
        if (!incomingResponse.complete) finish(() => reject(new Error("Health check response closed")));
      });
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
    request.once("close", () => {
      if (!response || !response.complete) finish(() => reject(new Error("Health check request closed")));
    });
    request.end();
  });
}

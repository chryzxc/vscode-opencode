import * as inspector from "node:inspector";

type NetworkDataReceivedPayload = {
  /**
   * The affected Node builds expose this as a listener for the incoming
   * response event, rather than the public protocol-event emitter. Those
   * listeners require the response chunk in `data`.
   */
  data?: unknown;
  dataLength?: unknown;
  encodedDataLength?: unknown;
  [key: string]: unknown;
};

type NetworkDataReceived = (params: NetworkDataReceivedPayload) => void;

type InspectorNetwork = {
  dataReceived?: NetworkDataReceived;
};

let installed = false;

/**
 * Shields the extension host from a Node inspector compatibility bug.
 *
 * Some VS Code/Electron Node builds enable experimental network inspection but
 * emit malformed HTTP `Network.dataReceived` events. Depending on the exact
 * embedded Node version, the event can omit either the response chunk (`data`)
 * or protocol byte counts. Node then throws from its inspector bridge while
 * merely observing a response. This is unrelated to the response itself and
 * can flood the Extension Host log during ordinary background requests.
 */
export function installInspectorNetworkCompatibility(): void {
  if (installed) {
    return;
  }
  installed = true;

  // The Node type declarations do not expose the experimental Network domain,
  // even though it is available at runtime in the affected extension hosts.
  const network = (inspector as unknown as { Network: InspectorNetwork }).Network;
  if (!network || typeof network.dataReceived !== "function") {
    return;
  }
  const originalDataReceived = network.dataReceived;

  network.dataReceived = (params: NetworkDataReceivedPayload) => {
    // In the affected VS Code/Electron Node builds this function is an
    // internal response-data listener. Calling it without a usable chunk
    // causes the runtime's `originalDataReceived` to throw "Missing data in
    // event". Node's internal `broadcastToFrontend` validates `data` with a
    // truthy check, so ANY falsy value (undefined, null, "", 0, false, NaN)
    // triggers the throw — not just absent keys. Reject falsy chunks here and
    // leave the HTTP response itself untouched; these are diagnostic events
    // for DevTools only and suppressing them does not affect real traffic.
    if (!params || !params.data) {
      return;
    }

    const normalized = { ...params };

    if (typeof normalized.dataLength !== "number") {
      normalized.dataLength = 0;
    }
    if (typeof normalized.encodedDataLength !== "number") {
      normalized.encodedDataLength = normalized.dataLength;
    }

    try {
      originalDataReceived(normalized);
    } catch (error) {
      // Belt-and-suspenders guard: the affected runtime's internal validation
      // can still reject chunks that pass our truthy check (e.g. wrong-typed
      // data or version-specific protocol checks such as
      // "Expected data to be Uint8Array in event"). These TypeErrors are all
      // diagnostic-event validation failures and do not affect the HTTP
      // response itself, so swallow them to keep the Extension Host log clean.
      if (error instanceof TypeError && /in event/i.test(String(error.message))) {
        return;
      }
      throw error;
    }
  };
}

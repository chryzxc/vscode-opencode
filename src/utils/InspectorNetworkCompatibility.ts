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
    // internal response-data listener. Calling it without a chunk causes the
    // runtime's `originalDataReceived` to throw "Missing data in event".
    // There is no valid inspector event to reconstruct without that chunk, so
    // discard only the malformed diagnostic event and leave the HTTP response
    // itself untouched.
    // Checking only for the key is insufficient: the affected runtime can
    // produce `{ data: undefined }`, which still reaches its internal
    // listener and throws "Missing data in event". Empty chunks remain valid,
    // so reject only absent or nullish data.
    if (!params || params.data === undefined || params.data === null) {
      return;
    }

    const normalized = { ...params };

    if (typeof normalized.dataLength !== "number") {
      normalized.dataLength = 0;
    }
    if (typeof normalized.encodedDataLength !== "number") {
      normalized.encodedDataLength = normalized.dataLength;
    }

    originalDataReceived(normalized);
  };
}

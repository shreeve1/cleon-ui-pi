import { SdkSessionManager } from './sdk-session-manager.js';

const sdkSessionManager = new SdkSessionManager();
await sdkSessionManager.start();

export function getSdkSessionManager() {
  return sdkSessionManager;
}

export default sdkSessionManager;

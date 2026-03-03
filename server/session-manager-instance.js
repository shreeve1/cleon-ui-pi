import { RpcSessionManager } from './rpc-session-manager.js';

const rpcSessionManager = new RpcSessionManager();
await rpcSessionManager.start();

export function getRpcSessionManager() {
  return rpcSessionManager;
}

export default rpcSessionManager;

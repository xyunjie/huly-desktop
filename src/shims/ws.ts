/** Stub so the Node WebSocket factory inside `@hcengineering/api-client` can be bundled. */
export default class NodeWebSocket {
  constructor() {
    throw new Error("Huly Desk 在窗口里使用浏览器 WebSocket，不会加载 Node 的 ws 包。");
  }
}

import type { ClientMsg, ServerMsg } from '@fabrika/shared';

export class Net {
  private ws?: WebSocket;
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: () => void = () => {};

  connect(): Promise<void> {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/ws`);
    this.ws = ws;
    return new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error('Sunucuya bağlanılamadı'));
      ws.onmessage = (ev) => {
        try {
          this.onMessage(JSON.parse(ev.data));
        } catch (err) {
          console.error(err);
        }
      };
      ws.onclose = () => this.onClose();
    });
  }

  send(msg: ClientMsg) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws?.close();
  }
}

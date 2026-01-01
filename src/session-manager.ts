import { ChromeClient } from "./chrome-client.js";
import { StateManager } from "./state.js";
import { clearDomainPages } from "./page-manager.js";

interface Session {
  chrome: ChromeClient;
  state: StateManager;
}

export class SessionManager {
  private sessions = new Map<string, Session>();
  private connecting = new Map<string, Promise<Session>>();

  async get(sessionId: string): Promise<Session> {
    const existing = this.sessions.get(sessionId);
    if (existing) return existing;

    // Avoid duplicate connections for the same sessionId
    const pending = this.connecting.get(sessionId);
    if (pending) return pending;

    const promise = this.create(sessionId);
    this.connecting.set(sessionId, promise);
    try {
      const session = await promise;
      return session;
    } finally {
      this.connecting.delete(sessionId);
    }
  }

  private async create(sessionId: string): Promise<Session> {
    const chrome = new ChromeClient();
    await chrome.connect();
    const state = new StateManager();
    const session = { chrome, state };
    this.sessions.set(sessionId, session);
    return session;
  }

  async destroy(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (session) {
      await session.chrome.disconnect();
      this.sessions.delete(sessionId);
      clearDomainPages();
    }
  }

  async destroyAll(): Promise<void> {
    const promises = [...this.sessions.entries()].map(([id]) => this.destroy(id));
    await Promise.all(promises);
  }

  list(): string[] {
    return [...this.sessions.keys()];
  }
}

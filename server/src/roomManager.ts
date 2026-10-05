import type { Persistence } from './persistence';
import { Room } from './room';
import { World } from './sim/world';

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export class RoomManager {
  rooms = new Map<string, Room>();

  constructor(private persistence: Persistence | undefined, private cheats: boolean, private speed = 1) {}

  private newCode(): string {
    for (;;) {
      let c = '';
      for (let i = 0; i < 5; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
      if (!this.rooms.has(c) && !this.persistence?.exists(c)) return c;
    }
  }

  create(): Room {
    const code = this.newCode();
    const seed = Math.floor(Math.random() * 2 ** 31);
    const room = new Room(code, new World(seed), this.persistence, this.cheats, this.speed);
    this.rooms.set(code, room);
    room.save();
    return room;
  }

  get(code: string): Room | undefined {
    const c = code.toUpperCase().trim();
    let room = this.rooms.get(c);
    if (room) return room;
    const data = this.persistence?.load(c);
    if (!data) return undefined;
    room = new Room(c, World.fromSave(data), this.persistence, this.cheats, this.speed);
    this.rooms.set(c, room);
    return room;
  }

  shutdown() {
    for (const r of this.rooms.values()) r.shutdown();
  }
}

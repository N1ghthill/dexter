import fs from 'node:fs';
import path from 'node:path';
import type { ChatTurn, LongTermMemory, MemorySnapshot, SessionSummary } from '@shared/contracts';

interface MediumMemoryFile {
  sessions: Record<string, SessionSummary>;
}

interface LongMemoryFile {
  data: LongTermMemory;
}

const DEFAULT_LONG_MEMORY: LongTermMemory = {
  profile: {},
  preferences: {},
  notes: []
};

export class MemoryStore {
  private readonly shortTerm = new Map<string, ChatTurn[]>();
  private readonly shortLimit = 24;
  private readonly mediumFilePath: string;
  private readonly longFilePath: string;

  constructor(baseDir: string) {
    const memoryDir = path.join(baseDir, 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    this.mediumFilePath = path.join(memoryDir, 'medium-memory.json');
    this.longFilePath = path.join(memoryDir, 'long-memory.json');

    this.ensureFiles();
  }

  pushTurn(sessionId: string, turn: ChatTurn): void {
    const turns = this.shortTerm.get(sessionId) ?? [];
    turns.push(turn);

    if (turns.length > this.shortLimit) {
      turns.splice(0, turns.length - this.shortLimit);
    }

    this.shortTerm.set(sessionId, turns);
    this.updateMediumMemory(sessionId, turns);
  }

  getShortContext(sessionId: string): ChatTurn[] {
    return this.shortTerm.get(sessionId) ?? [];
  }

  getLongMemory(): LongTermMemory {
    const file = this.readLongFile();
    return file.data;
  }

  addLongNote(note: string): void {
    const trimmed = note.trim();
    if (!trimmed) {
      return;
    }

    const file = this.readLongFile();
    file.data.notes.push(trimmed);
    fs.writeFileSync(this.longFilePath, JSON.stringify(file, null, 2), 'utf-8');
  }

  clearSession(sessionId: string): void {
    this.shortTerm.delete(sessionId);
  }

  snapshot(): MemorySnapshot {
    const medium = this.readMediumFile();
    const long = this.readLongFile();

    let shortCount = 0;
    for (const turns of this.shortTerm.values()) {
      shortCount += turns.length;
    }

    return {
      shortTermTurns: shortCount,
      mediumTermSessions: Object.keys(medium.sessions).length,
      longTermFacts:
        Object.keys(long.data.profile).length +
        Object.keys(long.data.preferences).length +
        long.data.notes.length
    };
  }

  isHealthy(): boolean {
    try {
      this.readMediumFile();
      this.readLongFile();
      return true;
    } catch {
      return false;
    }
  }

  private ensureFiles(): void {
    if (!fs.existsSync(this.mediumFilePath)) {
      const initial: MediumMemoryFile = { sessions: {} };
      fs.writeFileSync(this.mediumFilePath, JSON.stringify(initial, null, 2), 'utf-8');
    }

    if (!fs.existsSync(this.longFilePath)) {
      const initial: LongMemoryFile = { data: DEFAULT_LONG_MEMORY };
      fs.writeFileSync(this.longFilePath, JSON.stringify(initial, null, 2), 'utf-8');
    }
  }

  private updateMediumMemory(sessionId: string, turns: ChatTurn[]): void {
    const medium = this.readMediumFile();
    medium.sessions[sessionId] = {
      sessionId,
      updatedAt: new Date().toISOString(),
      sample: turns.slice(-6).map((t) => `${t.role}: ${truncate(t.content, 120)}`)
    };

    fs.writeFileSync(this.mediumFilePath, JSON.stringify(medium, null, 2), 'utf-8');
  }

  private readMediumFile(): MediumMemoryFile {
    return JSON.parse(fs.readFileSync(this.mediumFilePath, 'utf-8')) as MediumMemoryFile;
  }

  private readLongFile(): LongMemoryFile {
    return JSON.parse(fs.readFileSync(this.longFilePath, 'utf-8')) as LongMemoryFile;
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}...`;
}

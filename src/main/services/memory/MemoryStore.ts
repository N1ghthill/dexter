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
const LONG_NOTES_LIMIT = 400;
const LONG_NOTE_MAX_CHARS = 600;

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
    const turns = this.shortTerm.get(sessionId) ?? [];
    return turns.slice();
  }

  getLongMemory(): LongTermMemory {
    const file = this.readLongFile();
    return cloneLongMemory(file.data);
  }

  addLongNote(note: string): void {
    const normalized = normalizeLongNote(note);
    if (!normalized) {
      return;
    }

    const file = this.readLongFile();
    if (file.data.notes[file.data.notes.length - 1] === normalized) {
      return;
    }

    file.data.notes.push(normalized);
    if (file.data.notes.length > LONG_NOTES_LIMIT) {
      file.data.notes.splice(0, file.data.notes.length - LONG_NOTES_LIMIT);
    }
    fs.writeFileSync(this.longFilePath, JSON.stringify(file, null, 2), 'utf-8');
  }

  clearSession(sessionId: string): void {
    this.shortTerm.delete(sessionId);

    const medium = this.readMediumFile();
    if (!medium.sessions[sessionId]) {
      return;
    }

    delete medium.sessions[sessionId];
    fs.writeFileSync(this.mediumFilePath, JSON.stringify(medium, null, 2), 'utf-8');
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
      const initial: LongMemoryFile = { data: cloneLongMemory(DEFAULT_LONG_MEMORY) };
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
    try {
      const parsed = JSON.parse(fs.readFileSync(this.mediumFilePath, 'utf-8')) as Partial<MediumMemoryFile>;
      const sessions = sanitizeSessions(parsed.sessions);
      return { sessions };
    } catch {
      const fallback: MediumMemoryFile = { sessions: {} };
      fs.writeFileSync(this.mediumFilePath, JSON.stringify(fallback, null, 2), 'utf-8');
      return fallback;
    }
  }

  private readLongFile(): LongMemoryFile {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.longFilePath, 'utf-8')) as Partial<LongMemoryFile>;
      return {
        data: sanitizeLongMemory(parsed.data)
      };
    } catch {
      const fallback: LongMemoryFile = { data: cloneLongMemory(DEFAULT_LONG_MEMORY) };
      fs.writeFileSync(this.longFilePath, JSON.stringify(fallback, null, 2), 'utf-8');
      return fallback;
    }
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) {
    return value;
  }

  return `${value.slice(0, max - 1)}...`;
}

function sanitizeSessions(input: unknown): Record<string, SessionSummary> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const out: Record<string, SessionSummary> = {};

  for (const [sessionId, raw] of Object.entries(input)) {
    if (!raw || typeof raw !== 'object') {
      continue;
    }

    const value = raw as Partial<SessionSummary>;
    if (
      typeof value.sessionId !== 'string' ||
      typeof value.updatedAt !== 'string' ||
      !Number.isFinite(Date.parse(value.updatedAt)) ||
      !Array.isArray(value.sample)
    ) {
      continue;
    }

    out[sessionId] = {
      sessionId: value.sessionId,
      updatedAt: value.updatedAt,
      sample: value.sample.filter((item): item is string => typeof item === 'string')
    };
  }

  return out;
}

function cloneLongMemory(input: LongTermMemory): LongTermMemory {
  return {
    profile: { ...input.profile },
    preferences: { ...input.preferences },
    notes: input.notes.slice()
  };
}

function sanitizeLongMemory(input: unknown): LongTermMemory {
  if (!input || typeof input !== 'object') {
    return {
      profile: {},
      preferences: {},
      notes: []
    };
  }

  const value = input as Partial<LongTermMemory>;

  return {
    profile: sanitizeRecord(value.profile),
    preferences: sanitizeRecord(value.preferences),
    notes: sanitizeNotes(value.notes)
  };
}

function sanitizeRecord(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object') {
    return {};
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === 'string') {
      out[key] = value;
    }
  }

  return out;
}

function sanitizeNotes(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const out: string[] = [];
  for (const raw of input) {
    const normalized = normalizeLongNote(raw);
    if (!normalized) {
      continue;
    }

    if (out[out.length - 1] === normalized) {
      continue;
    }

    out.push(normalized);
  }

  if (out.length > LONG_NOTES_LIMIT) {
    return out.slice(out.length - LONG_NOTES_LIMIT);
  }

  return out;
}

function normalizeLongNote(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return truncate(trimmed, LONG_NOTE_MAX_CHARS);
}

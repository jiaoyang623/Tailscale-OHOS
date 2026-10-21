import { fileIo } from '@kit.CoreFileKit';
import { hilog } from '@kit.PerformanceAnalysisKit';
import { DiagnosticEventStore } from './DiagnosticEventStore';
import { StoragePaths } from './StoragePaths';

const DOMAIN: number = 0x0000;
const TAG: string = 'MeshArcLedger';
const MAX_ENTRIES: number = 512;
const MAX_BYTES: number = 64 * 1024;
const MAX_SESSION_ID_LENGTH: number = 64;
const MAX_PHASE_LENGTH: number = 32;

/**
 * Why a session ended. The list is closed: a reason from outside it is stored
 * as unknown, and the phase then names the missing evidence. A reader can
 * therefore group every end without guessing at free text.
 */
export enum SessionEndReason {
  USER_STOP = 'user_stop',
  EXTENSION_DESTROYED = 'extension_destroyed',
  EXTENSION_CRASH = 'extension_crash',
  HANDOFF_TIMEOUT = 'handoff_timeout',
  SYSTEM_STOPPED = 'system_stopped',
  NETWORK_LOST = 'network_lost',
  UNKNOWN = 'unknown'
}

export enum SessionLedgerKind {
  END = 'end',
  OBSERVED = 'observed'
}

export const SESSION_END_REASONS: string[] = [
  SessionEndReason.USER_STOP,
  SessionEndReason.EXTENSION_DESTROYED,
  SessionEndReason.EXTENSION_CRASH,
  SessionEndReason.HANDOFF_TIMEOUT,
  SessionEndReason.SYSTEM_STOPPED,
  SessionEndReason.NETWORK_LOST,
  SessionEndReason.UNKNOWN
];

export interface SessionLedgerEntry {
  timestampMs: number;
  writer: string;
  sessionId: string;
  kind: SessionLedgerKind;
  reason: SessionEndReason;
  phase: string;
  code: number;
}

/**
 * The append-only record of session ends.
 *
 * Two processes write it: the extension records the end it caused, and the app
 * records the end it observed. Each writer appends to a file it owns, so a
 * compaction never rewrites the other writer's file. Both read every ledger
 * file to decide duplication, and both share one reason vocabulary. The reader
 * merges the files by timestamp. Each file is bounded, so a long-lived
 * installation cannot grow the ledger without limit.
 *
 * The ledger holds no addresses and no identity fields. A phase is reduced to
 * letters, digits, underscore and hyphen; a session id is refused unless it is
 * an opaque token. Diagnostics are written separately and are best-effort.
 */
export class SessionLedger {
  static recordEnd(filesDir: string, writer: string, sessionId: string,
    reason: string, phase: string, code: number, nowMs: number): boolean {
    return SessionLedger.append(filesDir, SessionLedgerKind.END, writer, sessionId,
      reason, phase, code, nowMs);
  }

  static recordObserved(filesDir: string, writer: string, sessionId: string,
    reason: string, phase: string, code: number, nowMs: number): boolean {
    return SessionLedger.append(filesDir, SessionLedgerKind.OBSERVED, writer, sessionId,
      reason, phase, code, nowMs);
  }

  /**
   * Reads every writer file, merges the entries by timestamp, and keeps one
   * entry per session and kind. A torn last line is not an entry.
   */
  static read(filesDir: string): SessionLedgerEntry[] {
    const merged: SessionLedgerEntry[] = [];
    const paths: string[] = SessionLedger.ledgerPaths(filesDir);
    for (const path of paths) {
      try {
        if (fileIo.accessSync(path)) {
          const parsed: SessionLedgerEntry[] = SessionLedger.parse(fileIo.readTextSync(path));
          for (const entry of parsed) {
            merged.push(entry);
          }
        }
      } catch (_error) {
        // An unreadable file contributes no entries.
      }
    }
    merged.sort((left: SessionLedgerEntry, right: SessionLedgerEntry) =>
      left.timestampMs - right.timestampMs);
    const seen: string[] = [];
    const unique: SessionLedgerEntry[] = [];
    for (const entry of merged) {
      const key: string = `${entry.sessionId}|${entry.kind}`;
      if (!seen.includes(key)) {
        seen.push(key);
        unique.push(entry);
      }
    }
    return unique;
  }

  /** The latest end across every writer, for the reader in the other process. */
  static readEndFile(filesDir: string): SessionLedgerEntry | undefined {
    let best: SessionLedgerEntry | undefined = undefined;
    const paths: string[] = SessionLedger.endPaths(filesDir);
    for (const path of paths) {
      const candidate: SessionLedgerEntry | undefined = SessionLedger.readEnd(path);
      if (candidate !== undefined) {
        if (best === undefined) {
          best = candidate;
        } else if (candidate.timestampMs > best.timestampMs) {
          best = candidate;
        }
      }
    }
    return best;
  }

  /** The reader takes the end once, so a restart cannot observe it twice. */
  static clearEndFile(filesDir: string): void {
    const paths: string[] = SessionLedger.endPaths(filesDir);
    for (const path of paths) {
      try {
        if (fileIo.accessSync(path)) {
          fileIo.unlinkSync(path);
        }
      } catch (_error) {
        // A leftover end is still deduplicated by the ledger itself.
      }
    }
  }

  private static append(filesDir: string, kind: SessionLedgerKind, writer: string,
    sessionId: string, reason: string, phase: string, code: number, nowMs: number): boolean {
    const safeSessionId: string = SessionLedger.safeSessionId(sessionId);
    if (safeSessionId.length === 0) {
      return false;
    }
    const safeReason: string = SESSION_END_REASONS.includes(reason) ? reason : SessionEndReason.UNKNOWN;
    const safePhase: string = safeReason === reason ?
      SessionLedger.safePhase(phase) : 'reason_invalid';
    const entry: SessionLedgerEntry = {
      timestampMs: Number.isFinite(nowMs) && nowMs > 0 ? nowMs : Date.now(),
      writer: SessionLedger.safeWriter(writer),
      sessionId: safeSessionId,
      kind: kind,
      reason: safeReason as SessionEndReason,
      phase: safePhase,
      code: Number.isFinite(code) ? code : 0
    };
    // A writer touches only its own file. Deduplication still reads every
    // writer file, because either process can observe the same end.
    const path: string = StoragePaths.vpnSessionLedgerPathFor(filesDir, entry.writer);
    let existing: string = '';
    try {
      if (fileIo.accessSync(path)) {
        existing = fileIo.readTextSync(path);
      }
    } catch (_error) {
      existing = '';
    }
    const entries: SessionLedgerEntry[] = SessionLedger.parse(existing);
    const all: SessionLedgerEntry[] = SessionLedger.read(filesDir);
    for (const item of all) {
      if (item.sessionId === entry.sessionId && item.kind === entry.kind) {
        return false;
      }
    }
    // A torn tail - a write that stopped midway - is removed before the new
    // line is appended, so it can never become a half entry.
    const clean: string = existing.length === 0 || existing.endsWith('\n') ?
      existing : SessionLedger.withoutTornTail(existing);
    if (clean !== existing) {
      if (!SessionLedger.writeText(path, clean)) {
        return false;
      }
    }
    if (!SessionLedger.appendText(path, `${JSON.stringify(entry)}\n`)) {
      return false;
    }
    SessionLedger.compact(filesDir, path, entries.concat([entry]));
    if (kind === SessionLedgerKind.END) {
      SessionLedger.writeEndFile(filesDir, entry.writer, entry);
    }
    DiagnosticEventStore.record(filesDir, entry.writer,
      kind === SessionLedgerKind.END ? 'vpn_session_end' : 'vpn_session_end_observed',
      entry.phase, entry.code);
    return true;
  }

  private static compact(filesDir: string, path: string, entries: SessionLedgerEntry[]): void {
    let retained: SessionLedgerEntry[] = entries.length > MAX_ENTRIES ?
      entries.slice(entries.length - MAX_ENTRIES) : entries.slice(0);
    while (retained.length > 1 &&
      SessionLedger.textOf(retained).length > MAX_BYTES) {
      retained = retained.slice(1);
    }
    const text: string = SessionLedger.textOf(retained);
    try {
      if (SessionLedger.readText(path) !== text) {
        SessionLedger.writeText(path, text);
      }
    } catch (_error) {
      hilog.error(DOMAIN, TAG, 'Session ledger compaction failed');
    }
  }

  private static ledgerPaths(filesDir: string): string[] {
    return [
      StoragePaths.vpnSessionLedgerPathFor(filesDir, 'vpn'),
      StoragePaths.vpnSessionLedgerPathFor(filesDir, 'ui'),
      StoragePaths.vpnSessionLedgerPath(filesDir)
    ];
  }

  private static endPaths(filesDir: string): string[] {
    return [
      StoragePaths.vpnSessionEndPathFor(filesDir, 'vpn'),
      StoragePaths.vpnSessionEndPathFor(filesDir, 'ui'),
      StoragePaths.vpnSessionEndPath(filesDir)
    ];
  }

  private static readEnd(path: string): SessionLedgerEntry | undefined {
    try {
      if (!fileIo.accessSync(path)) {
        return undefined;
      }
      const text: string = fileIo.readTextSync(path);
      if (text.trim().length === 0) {
        return undefined;
      }
      const parsed: SessionLedgerEntry = JSON.parse(text) as SessionLedgerEntry;
      if (typeof parsed.sessionId !== 'string' ||
        SessionLedger.safeSessionId(parsed.sessionId).length === 0 ||
        !Number.isFinite(parsed.timestampMs)) {
        return undefined;
      }
      return parsed;
    } catch (_error) {
      return undefined;
    }
  }

  private static writeEndFile(filesDir: string, writer: string, entry: SessionLedgerEntry): void {
    const path: string = StoragePaths.vpnSessionEndPathFor(filesDir, writer);
    const temporaryPath: string = `${path}.tmp`;
    try {
      const file: fileIo.File = fileIo.openSync(temporaryPath,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      try {
        fileIo.writeSync(file.fd, JSON.stringify(entry));
      } finally {
        fileIo.closeSync(file);
      }
      fileIo.renameSync(temporaryPath, path);
    } catch (_error) {
      // The ledger itself already holds the end; this file is a convenience.
    }
  }

  private static parse(text: string): SessionLedgerEntry[] {
    const result: SessionLedgerEntry[] = [];
    if (text.length === 0) {
      return result;
    }
    text.split('\n').forEach((line: string) => {
      if (line.trim().length === 0) {
        return;
      }
      try {
        const parsed: SessionLedgerEntry = JSON.parse(line) as SessionLedgerEntry;
        if (typeof parsed.sessionId !== 'string' ||
          SessionLedger.safeSessionId(parsed.sessionId).length === 0 ||
          (parsed.kind !== SessionLedgerKind.END && parsed.kind !== SessionLedgerKind.OBSERVED) ||
          typeof parsed.reason !== 'string' || !Number.isFinite(parsed.timestampMs)) {
          return;
        }
        result.push(parsed);
      } catch (_error) {
        // A torn or damaged line is not an entry.
      }
    });
    return result;
  }

  private static withoutTornTail(text: string): string {
    const cut: number = text.lastIndexOf('\n');
    return cut < 0 ? '' : text.substring(0, cut + 1);
  }

  private static textOf(entries: SessionLedgerEntry[]): string {
    if (entries.length === 0) {
      return '';
    }
    return `${entries.map((entry: SessionLedgerEntry) => JSON.stringify(entry)).join('\n')}\n`;
  }

  private static readText(path: string): string {
    if (!fileIo.accessSync(path)) {
      return '';
    }
    return fileIo.readTextSync(path);
  }

  private static writeText(path: string, content: string): boolean {
    let file: fileIo.File | undefined = undefined;
    try {
      file = fileIo.openSync(path,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.TRUNC);
      fileIo.writeSync(file.fd, content);
      return true;
    } catch (_error) {
      return false;
    } finally {
      if (file !== undefined) {
        try {
          fileIo.closeSync(file);
        } catch (_closeError) {
          // The descriptor may already be closed after a platform write failure.
        }
      }
    }
  }

  private static appendText(path: string, content: string): boolean {
    let file: fileIo.File | undefined = undefined;
    try {
      file = fileIo.openSync(path,
        fileIo.OpenMode.CREATE | fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.APPEND);
      fileIo.writeSync(file.fd, content);
      return true;
    } catch (_error) {
      return false;
    } finally {
      if (file !== undefined) {
        try {
          fileIo.closeSync(file);
        } catch (_closeError) {
          // The descriptor may already be closed after a platform write failure.
        }
      }
    }
  }

  private static safeSessionId(value: string): string {
    if (typeof value !== 'string') {
      return '';
    }
    const trimmed: string = value.trim();
    return /^[A-Za-z0-9_-]{1,64}$/.test(trimmed) && trimmed.length <= MAX_SESSION_ID_LENGTH ?
      trimmed : '';
  }

  private static safeWriter(value: string): string {
    if (typeof value !== 'string') {
      return 'ui';
    }
    const normalized: string = value.trim().toLowerCase();
    return normalized === 'vpn' ? 'vpn' : 'ui';
  }

  private static safePhase(value: string): string {
    if (typeof value !== 'string') {
      return 'unknown';
    }
    const normalized: string = value.trim().toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .substring(0, MAX_PHASE_LENGTH);
    return normalized.length === 0 ? 'unknown' : normalized;
  }
}
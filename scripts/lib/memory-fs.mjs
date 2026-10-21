// In-memory stand-in for @kit.CoreFileKit's fileIo.
//
// The file-backed services (intent, ledger, power stage) take all their I/O
// through fileIo. A host test supplies this object instead, so the service
// logic under test is the real source and only the platform boundary is a
// stub. Paths are plain strings and map entries hold whole file contents.

export function memoryFileIo(initial = {}) {
  const OpenMode = {
    READ_WRITE: 0o2,
    WRITE_ONLY: 0o1,
    CREATE: 0o100,
    TRUNC: 0o1000,
    APPEND: 0o2000
  };
  const io = {
    files: new Map(Object.entries(initial)),
    failWrites: false,
    writes: 0,
    OpenMode,
    accessSync: (path) => io.files.has(path),
    readTextSync: (path) => {
      if (!io.files.has(path)) {
        throw new Error(`No such file: ${path}`);
      }
      return io.files.get(path);
    },
    openSync: (path, mode) => {
      if (io.failWrites) {
        throw new Error('The write is denied');
      }
      if (!io.files.has(path)) {
        io.files.set(path, '');
      }
      if ((mode & OpenMode.TRUNC) !== 0) {
        io.files.set(path, '');
      }
      // A real descriptor is a number. This stub uses the path as its
      // descriptor so a service that writes file.fd still works here.
      return { fd: path, path, append: (mode & OpenMode.APPEND) !== 0 };
    },
    writeSync: (file, content) => {
      if (io.failWrites) {
        throw new Error('The write is denied');
      }
      const key = typeof file === 'string' ? file : file.path;
      const append = typeof file === 'string' ? false : file.append;
      const current = io.files.get(key) ?? '';
      io.files.set(key, append ? current + String(content) : String(content));
      io.writes++;
    },
    closeSync: () => {},
    renameSync: (from, to) => {
      if (io.failWrites) {
        throw new Error('The write is denied');
      }
      if (!io.files.has(from)) {
        throw new Error(`No such file: ${from}`);
      }
      io.files.set(to, io.files.get(from));
      io.files.delete(from);
    },
    unlinkSync: (path) => {
      io.files.delete(path);
    },
    statSync: (path) => ({ size: (io.files.get(path) ?? '').length })
  };
  return io;
}

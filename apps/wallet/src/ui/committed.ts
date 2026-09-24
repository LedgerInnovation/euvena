import { useCallback, useRef, useState } from "react";

/**
 * A value held on the device, with writes applied one after another.
 *
 * Each write reads the value the previous write committed, so two taps in
 * flight cannot build on the same old value and lose each other's change. The
 * device is written before the screen changes, so a value the user sees is a
 * value the device holds. A write rejects on failure and the caller reports
 * it; the queue itself carries on. After a failed read, writes refuse until
 * the app restarts, since a value that could not be read must not be written
 * over. A store whose value the user can retype may instead allow writing
 * after a failed read; the first write that succeeds clears the failure.
 */
export interface CommittedStore<T> {
  value: T;
  /** Whether the stored value could not be read. */
  loadFailed: boolean;
  /** Takes the value read from the device. */
  loaded: (value: T) => void;
  /** Records that the device could not be read. */
  failed: () => void;
  /** Queues a write of the updated value. Rejects when it could not be written. */
  commit: (update: (current: T) => T) => Promise<void>;
}

export function useCommittedStore<T>(
  initial: T,
  save: (value: T) => Promise<void>,
  options: { writeAfterFailedRead?: boolean } = {},
): CommittedStore<T> {
  const { writeAfterFailedRead = false } = options;
  const [value, setValue] = useState<T>(initial);
  const [loadFailed, setLoadFailed] = useState(false);
  const committed = useRef<T>(initial);
  const readFailed = useRef(false);
  const writes = useRef<Promise<void>>(Promise.resolve());

  const loaded = useCallback((stored: T) => {
    committed.current = stored;
    setValue(stored);
  }, []);

  const failed = useCallback(() => {
    if (!writeAfterFailedRead) readFailed.current = true;
    setLoadFailed(true);
  }, [writeAfterFailedRead]);

  const commit = useCallback(
    (update: (current: T) => T) => {
      const write = writes.current.then(async () => {
        if (readFailed.current) throw new Error("the stored value was not read");
        const next = update(committed.current);
        await save(next);
        committed.current = next;
        setValue(next);
        setLoadFailed(false);
      });
      writes.current = write.catch(() => undefined);
      return write;
    },
    [save],
  );

  return { value, loadFailed, loaded, failed, commit };
}

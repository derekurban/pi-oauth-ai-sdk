declare module "proper-lockfile" {
  interface LockOptions {
    realpath?: boolean;
    retries?: {
      retries?: number;
      factor?: number;
      minTimeout?: number;
      maxTimeout?: number;
      randomize?: boolean;
    };
    stale?: number;
  }

  type ReleaseFn = () => Promise<void>;

  const lockfile: {
    lock(file: string, options?: LockOptions): Promise<ReleaseFn>;
  };

  export default lockfile;
}

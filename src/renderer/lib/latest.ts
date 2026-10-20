/**
 * Applies only the answer to the latest request: a slower answer to an earlier one (another report clicked,
 * another profile opened) is dropped instead of showing under the wrong item.
 */
export function latestOnly() {
  let current = 0;
  return async <T>(request: Promise<T>, apply: (value: T) => void): Promise<void> => {
    const mine = ++current;
    const value = await request;
    if (mine === current) apply(value);
  };
}

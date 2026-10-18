// A slow poll must finish before another poll can invalidate its response.
export function singleFlight(operation) {
  let pending;
  return (...args) => {
    if (!pending) {
      pending = Promise.resolve().then(() => operation(...args)).finally(() => { pending = null; });
    }
    return pending;
  };
}

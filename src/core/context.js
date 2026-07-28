export function createApplicationContext(initial = {}) {
  let snapshot = Object.freeze({ ...initial });
  const subscribers = new Set();

  return Object.freeze({
    get current() {
      return snapshot;
    },
    update(patch) {
      const previous = snapshot;
      snapshot = Object.freeze({ ...snapshot, ...patch });
      subscribers.forEach((subscriber) => {
        subscriber(snapshot, previous);
      });
      return snapshot;
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  });
}

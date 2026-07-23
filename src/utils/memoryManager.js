const heapdump = require('heapdump');

class MemoryManager {
  constructor() {
    this.heapSnapshotInterval = null;
    this.leakedReferences = new WeakMap();
  }

  startMonitoring(intervalMs = 3600000) {
    this.heapSnapshotInterval = setInterval(() => {
      const snapshotPath = `/tmp/heapdump-${Date.now()}.heapsnapshot`;
      heapdump.writeSnapshot(snapshotPath, (err) => {
        if (err) {
          console.error('Failed to write heap snapshot:', err);
        } else {
          console.log('Heap snapshot saved to:', snapshotPath);
        }
      });
    }, intervalMs);
  }

  stopMonitoring() {
    if (this.heapSnapshotInterval) {
      clearInterval(this.heapSnapshotInterval);
      this.heapSnapshotInterval = null;
    }
  }

  trackReference(key, value) {
    if (this.leakedReferences.has(key)) {
      console.warn('Potential memory leak detected for key:', key);
    }
    this.leakedReferences.set(key, value);
  }

  releaseReference(key) {
    this.leakedReferences.delete(key);
  }

  clearAllReferences() {
    this.leakedReferences = new WeakMap();
  }
}

module.exports = MemoryManager;
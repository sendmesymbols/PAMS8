export default class LRUCache<K, V> {
    private cache = new Map<K, V>();
    private maxSize: number;
    private hits = 0;
    private misses = 0;

    constructor(maxSize = 100) {
        this.maxSize = maxSize;
    }

    setMaxSize(newSize: number) {
        this.maxSize = newSize;
        while (this.cache.size > newSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
    }

    getStats() {
        return { hits: this.hits, misses: this.misses };
    }

    get(key: K): V | undefined {
        if (this.cache.has(key)) {
            this.hits++;
            const value = this.cache.get(key)!;
            this.cache.delete(key);
            this.cache.set(key, value); // move to end
            return value;
        }
        this.misses++;
        return undefined;
    }

    set(key: K, value: V) {
        if (this.cache.has(key)) this.cache.delete(key);
        else if (this.cache.size >= this.maxSize) {
            const oldestKey = this.cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.cache.delete(oldestKey);
            }
        }
        this.cache.set(key, value);
    }
}

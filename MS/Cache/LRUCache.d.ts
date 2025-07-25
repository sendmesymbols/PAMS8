export default class LRUCache<K, V> {
    private cache;
    private maxSize;
    private hits;
    private misses;
    constructor(maxSize?: number);
    setMaxSize(newSize: number): void;
    getStats(): {
        hits: number;
        misses: number;
    };
    get(key: K): V | undefined;
    set(key: K, value: V): void;
}

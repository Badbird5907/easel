"""MP3 starter code: a hash table with separate chaining."""


class HashTable:
    def __init__(self, capacity: int = 8) -> None:
        self._buckets: list[list[tuple[str, object]]] = [[] for _ in range(capacity)]
        self._size = 0

    def _index(self, key: str) -> int:
        return hash(key) % len(self._buckets)

    def put(self, key: str, value: object) -> None:
        bucket = self._buckets[self._index(key)]
        for i, (existing, _) in enumerate(bucket):
            if existing == key:
                bucket[i] = (key, value)
                return
        bucket.append((key, value))
        self._size += 1
        # TODO: resize when the load factor passes 0.75

    def get(self, key: str) -> object:
        for existing, value in self._buckets[self._index(key)]:
            if existing == key:
                return value
        raise KeyError(key)

    def __len__(self) -> int:
        return self._size

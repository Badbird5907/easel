# MP3: Hash Tables

Implement a hash table with **separate chaining** and *linear probing*.

## Getting started

1. Download `starter-code.zip` and unzip it.
2. Open `hash_table.py`.
3. Run the tests with `python -m pytest`.

## What to submit

- `hash_table.py` with every `TODO` finished
- A short write-up comparing the two strategies

> Tip: resize when the load factor passes 0.75.

```python
table = HashTable()
table.put("key", 42)
assert table.get("key") == 42
```

Questions go to the [course forum](https://example.edu/forum).

---

Due Friday at 11:59 PM.

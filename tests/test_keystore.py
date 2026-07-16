from backseat.keys import KeyStore, _FileBackend, mask_key


class DictBackend:
    def __init__(self):
        self.data = {}

    def get(self, name):
        return self.data.get(name)

    def set(self, name, value):
        self.data[name] = value


def test_empty_store():
    store = KeyStore(backend=DictBackend())
    assert store.load("google") == []


def test_add_and_load_preserves_order():
    store = KeyStore(backend=DictBackend())
    assert store.add("google", "key-a")
    assert store.add("google", "key-b")
    assert store.load("google") == ["key-a", "key-b"]


def test_add_duplicate_returns_false():
    store = KeyStore(backend=DictBackend())
    store.add("google", "key-a")
    assert not store.add("google", "key-a")
    assert store.load("google") == ["key-a"]


def test_providers_are_isolated():
    store = KeyStore(backend=DictBackend())
    store.add("google", "g-key")
    store.add("anthropic", "a-key")
    assert store.load("google") == ["g-key"]
    assert store.load("anthropic") == ["a-key"]


def test_remove_by_exact_value():
    store = KeyStore(backend=DictBackend())
    store.add("google", "key-a")
    assert store.remove("google", "key-a")
    assert store.load("google") == []


def test_remove_by_masked_form():
    store = KeyStore(backend=DictBackend())
    full = "AIzaSyB-1234567890abcdefghij"
    store.add("google", full)
    assert store.remove("google", mask_key(full))
    assert store.load("google") == []


def test_remove_missing_returns_false():
    store = KeyStore(backend=DictBackend())
    assert not store.remove("google", "nope")


def test_file_backend_round_trip(tmp_path):
    path = tmp_path / "keys.json"
    store = KeyStore(backend=_FileBackend(path))
    store.add("google", "key-a")
    # a fresh store reading the same file sees the key
    again = KeyStore(backend=_FileBackend(path))
    assert again.load("google") == ["key-a"]

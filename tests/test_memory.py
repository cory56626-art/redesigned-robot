from backseat.memory import Memory


def test_stores_turns_in_order():
    mem = Memory()
    mem.add("user", "hi")
    mem.add("assistant", "hey")
    msgs = mem.messages()
    assert [(m.role, m.text) for m in msgs] == [("user", "hi"), ("assistant", "hey")]


def test_trims_to_max_turns_keeping_newest():
    mem = Memory(max_turns=4)
    for i in range(10):
        mem.add("user", f"q{i}")
        mem.add("assistant", f"a{i}")
    msgs = mem.messages()
    assert len(msgs) == 4
    assert [m.text for m in msgs] == ["q8", "a8", "q9", "a9"]


def test_messages_returns_a_copy():
    mem = Memory()
    mem.add("user", "hi")
    mem.messages().append("garbage")
    assert len(mem.messages()) == 1


def test_clear():
    mem = Memory()
    mem.add("user", "hi")
    mem.clear()
    assert mem.messages() == []

import io

import pytest

PIL = pytest.importorskip("PIL")
from PIL import Image

from backseat.capture.change import dhash, dhash_jpeg, hamming


def gradient(direction=1, size=64):
    row = bytes(x if direction > 0 else size - 1 - x for x in range(size))
    return Image.frombytes("L", (size, size), row * size).convert("RGB")


def as_jpeg(img, quality=70):
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def test_identical_images_hash_identically():
    assert dhash(gradient()) == dhash(gradient())


def test_opposite_scenes_are_far_apart():
    distance = hamming(dhash(gradient(1)), dhash(gradient(-1)))
    assert distance > 40  # near-total change on a 64-bit hash


def test_jpeg_artifacts_do_not_register_as_change():
    img = gradient()
    distance = hamming(dhash(img), dhash_jpeg(as_jpeg(img)))
    assert distance < 4


def test_recompression_of_same_scene_stays_below_threshold():
    img = gradient()
    a = dhash_jpeg(as_jpeg(img, quality=70))
    b = dhash_jpeg(as_jpeg(img, quality=40))
    assert hamming(a, b) < 8  # default change_threshold


def test_hamming_counts_bits():
    assert hamming(0, 0) == 0
    assert hamming(0b1010, 0b0101) == 4
    assert hamming(0, (1 << 64) - 1) == 64

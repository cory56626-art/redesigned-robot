"""Perceptual-hash scene-change detection.

dHash: downscale to (size+1) x size grayscale, compare each pixel to its
right neighbor -> one bit each -> a 64-bit fingerprint (for size=8). Two
frames of the same scene hash nearly identically even through JPEG
artifacts; a real scene change flips many bits. Hamming distance between
hashes is the "how much changed" signal the director runs on.

Costs microseconds and no API tokens — this is what lets Backseat watch
every few seconds but only spend a request when something happened.
"""

from __future__ import annotations

import io

HASH_SIZE = 8  # 8x8 -> 64-bit hash


def dhash(image, size: int = HASH_SIZE) -> int:
    """Difference-hash a PIL image into an int with size*size bits."""
    gray = image.convert("L").resize((size + 1, size), 2)  # 2 = BILINEAR
    pixels = gray.tobytes()  # row-major luminance bytes
    bits = 0
    for row in range(size):
        for col in range(size):
            left = pixels[row * (size + 1) + col]
            right = pixels[row * (size + 1) + col + 1]
            bits = (bits << 1) | (right > left)
    return bits


def dhash_jpeg(data: bytes, size: int = HASH_SIZE) -> int:
    """dhash straight from JPEG bytes (what the capture loop produces)."""
    from PIL import Image

    return dhash(Image.open(io.BytesIO(data)), size)


def hamming(a: int, b: int) -> int:
    """Number of differing bits between two hashes (0..64 for 8x8)."""
    return (a ^ b).bit_count()

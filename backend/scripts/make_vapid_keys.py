"""Print a new VAPID key pair for Web Push, as the two .env lines.

    cd backend
    .venv/bin/python scripts/make_vapid_keys.py

Copy both lines into backend/.env yourself; this script writes no file.

- VAPID_PUBLIC_KEY: the uncompressed P-256 public key (65 bytes) in URL-safe
  base64 without padding, the form the browser's applicationServerKey takes.
  The back end serves it at GET /api/push/public-key.
- VAPID_PRIVATE_KEY: the raw 32-byte private key in the same encoding, which
  pywebpush reads as is. A secret: never commit it.

A new pair makes every stored subscription useless: each phone must
subscribe again (the phone page does so when it sees a different key).
"""

import base64

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def make_keys() -> tuple[str, str]:
    """A new (public, private) pair, both URL-safe base64."""
    key = ec.generate_private_key(ec.SECP256R1())
    private = key.private_numbers().private_value.to_bytes(32, "big")
    public = key.public_key().public_bytes(serialization.Encoding.X962,
                                           serialization.PublicFormat.UncompressedPoint)
    return b64url(public), b64url(private)


def main() -> None:
    public, private = make_keys()
    print(f"VAPID_PUBLIC_KEY={public}")
    print(f"VAPID_PRIVATE_KEY={private}")


if __name__ == "__main__":
    main()

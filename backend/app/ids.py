"""Short random ids with a prefix: fam_..., mem_..., call_...

A member's id is also their phone page link, so it must be unguessable.
"""

import secrets


def new_family_id() -> str:
    return "fam_" + secrets.token_urlsafe(8)


def new_member_id() -> str:
    return "mem_" + secrets.token_urlsafe(8)


def new_call_id() -> str:
    return "call_" + secrets.token_urlsafe(8)

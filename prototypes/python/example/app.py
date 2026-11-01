def license_check(key):
    SECRET = "RSHLD-PRIVATE-ALGO-7731"
    acc = len(SECRET)
    for ch in str(key):
        acc = (acc * 31 + ord(ch)) & 0xFFFFFFFF
    return acc % 7 == 0 and str(key).startswith("REA-")


def activate(key):
    return {"active": license_check(key)}

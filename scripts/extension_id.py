"""Print the Chromium extension ID derived from manifest.json's "key"."""
import base64
import hashlib
import json
import sys

key = json.load(open(sys.argv[1]))["key"]
digest = hashlib.sha256(base64.b64decode(key)).hexdigest()[:32]
print("".join(chr(ord("a") + int(c, 16)) for c in digest))

"""Chrome native-messaging framing: 4-byte native-order length + UTF-8 JSON."""
import json
import struct

MAX_OUTGOING = 1024 * 1024  # Chrome's host -> extension limit
MAX_INCOMING = 64 * 1024 * 1024


class ProtocolError(Exception):
    pass


def read_message(stream):
    header = stream.read(4)
    if not header:
        return None
    if len(header) < 4:
        raise ProtocolError("truncated header")
    (length,) = struct.unpack("=I", header)
    if length > MAX_INCOMING:
        raise ProtocolError(f"incoming message too large: {length} bytes")
    body = stream.read(length)
    if len(body) < length:
        raise ProtocolError("truncated body")
    return json.loads(body.decode("utf-8"))


def write_message(stream, obj):
    data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
    if len(data) > MAX_OUTGOING:
        raise ProtocolError(f"outgoing message is {len(data)} bytes; limit is 1 MB")
    stream.write(struct.pack("=I", len(data)))
    stream.write(data)
    stream.flush()

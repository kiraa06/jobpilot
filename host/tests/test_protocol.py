import io
import struct
import unittest

from jobpilot.protocol import ProtocolError, read_message, write_message


class ProtocolTest(unittest.TestCase):
    def test_round_trip(self):
        buf = io.BytesIO()
        write_message(buf, {"action": "ping", "text": "₹ é"})
        buf.seek(0)
        self.assertEqual(read_message(buf), {"action": "ping", "text": "₹ é"})

    def test_header_is_native_uint32_length(self):
        buf = io.BytesIO()
        write_message(buf, {"a": 1})
        raw = buf.getvalue()
        (length,) = struct.unpack("=I", raw[:4])
        self.assertEqual(length, len(raw) - 4)

    def test_eof_returns_none(self):
        self.assertIsNone(read_message(io.BytesIO(b"")))

    def test_truncated_body_raises(self):
        buf = io.BytesIO(struct.pack("=I", 10) + b'{"a":')
        with self.assertRaises(ProtocolError):
            read_message(buf)

    def test_outgoing_over_1mb_raises(self):
        with self.assertRaises(ProtocolError):
            write_message(io.BytesIO(), {"blob": "x" * (1024 * 1024)})


if __name__ == "__main__":
    unittest.main()

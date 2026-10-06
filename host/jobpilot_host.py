"""JobPilot native-messaging host. One request per process (one port per job)."""
import logging
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from jobpilot import actions, config  # noqa: E402
from jobpilot.protocol import ProtocolError, read_message, write_message  # noqa: E402


def main():
    root = config.home()
    root.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=root / "host.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
    )
    stdin, stdout = sys.stdin.buffer, sys.stdout.buffer
    try:
        msg = read_message(stdin)
    except ProtocolError as exc:
        write_message(stdout, actions.err("BAD_REQUEST", str(exc)))
        return
    if msg is None:
        return

    cancel = threading.Event()
    box = {}

    def work():
        box["response"] = actions.handle(msg, config.load(), cancel)

    def watch_stdin():
        # Extension disconnecting (EOF) or sending {"action":"cancel"} cancels the job.
        try:
            while True:
                nxt = read_message(stdin)
                if nxt is None or nxt.get("action") == "cancel":
                    break
        except Exception:
            pass
        cancel.set()

    worker = threading.Thread(target=work, daemon=True)
    worker.start()
    threading.Thread(target=watch_stdin, daemon=True).start()
    worker.join()
    logging.info("action=%s ok=%s", msg.get("action"), box["response"].get("ok"))
    try:
        write_message(stdout, box["response"])
    except (BrokenPipeError, ProtocolError) as exc:
        logging.warning("could not deliver response: %s", exc)


if __name__ == "__main__":
    main()

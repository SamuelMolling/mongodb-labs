import argparse
import logging

import uvicorn

from .app import Node, create_app


def main():
    ap = argparse.ArgumentParser(description="model serving node")
    ap.add_argument("--port", type=int, default=8031)
    ap.add_argument("--node-id", default=None)
    args = ap.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s", datefmt="%H:%M:%S")
    node = Node(args.node_id or f"node-{args.port}", args.port)
    uvicorn.run(create_app(node), host="0.0.0.0", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()

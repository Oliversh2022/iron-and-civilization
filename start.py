import argparse
import functools
import http.server
from pathlib import Path
import threading
import webbrowser


class GameHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html'}

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


class GameServer(http.server.ThreadingHTTPServer):
    allow_reuse_address = False
    allow_reuse_port = False


def main():
    parser = argparse.ArgumentParser(description='铁与文明 — 本机静态服务器')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    handler = functools.partial(GameHandler, directory=str(Path(__file__).resolve().parent))
    try:
        server = GameServer(('127.0.0.1', args.port), handler)
    except OSError as error:
        print(f'本地服务启动失败：{error}\n可尝试：python start.py --port 8766')
        return 1
    url = f'http://127.0.0.1:{args.port}/'
    print(f'铁与文明已启动：{url}\n仅限本机访问，按 Ctrl+C 停止服务。', flush=True)
    if not args.no_browser:
        threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == '__main__':
    raise SystemExit(main())

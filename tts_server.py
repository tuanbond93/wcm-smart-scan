import http.server
import socketserver
import urllib.request
import urllib.parse
import os

PORT = 8000

class SmartScanHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        parsed_url = urllib.parse.urlparse(self.path)
        if parsed_url.path == '/api/tts':
            query_params = urllib.parse.parse_qs(parsed_url.query)
            text_list = query_params.get('text', [])
            if not text_list:
                self.send_response(400)
                self.end_headers()
                return
            
            text = text_list[0]
            # Safely print for Windows console
            print(f"Generating TTS for: {text.encode('ascii', errors='ignore').decode('ascii')}")
            
            # Fetch from Google Translate TTS API (Vietnamese female voice)
            google_tts_url = "https://translate.google.com/translate_tts?" + urllib.parse.urlencode({
                "ie": "UTF-8",
                "tl": "vi",
                "client": "tw-ob",
                "q": text
            })
            
            try:
                # Custom User-Agent and NO Referer header to bypass Google's 403 hotlinking block
                req = urllib.request.Request(
                    google_tts_url, 
                    headers={
                        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
                    }
                )
                with urllib.request.urlopen(req) as response:
                    audio_data = response.read()
                
                self.send_response(200)
                self.send_header('Content-Type', 'audio/mpeg')
                self.send_header('Access-Control-Allow-Origin', '*')
                self.end_headers()
                self.wfile.write(audio_data)
            except Exception as e:
                print(f"Error fetching TTS from Google: {e}")
                self.send_response(500)
                self.end_headers()
        else:
            # Serve static files normally
            super().do_GET()

# Run the server
socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("", PORT), SmartScanHandler) as httpd:
    print(f"WCM Smart Scan server running at http://localhost:{PORT}")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass

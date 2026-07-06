from http.server import BaseHTTPRequestHandler
import urllib.request
import urllib.parse

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query parameters
        parsed_url = urllib.parse.urlparse(self.path)
        query_params = urllib.parse.parse_qs(parsed_url.query)
        text_list = query_params.get('text', [])
        
        if not text_list:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Missing 'text' parameter")
            return
        
        text = text_list[0]
        
        # Google Translate TTS API URL
        google_tts_url = "https://translate.google.com/translate_tts?" + urllib.parse.urlencode({
            "ie": "UTF-8",
            "tl": "vi",
            "client": "tw-ob",
            "q": text
        })
        
        try:
            # Fetch audio with custom User-Agent and NO Referer header
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
            self.send_response(500)
            self.end_headers()
            self.wfile.write(str(e).encode('utf-8'))

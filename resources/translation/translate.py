#!/usr/bin/env python3
"""
Translation service using argos-translate
Communicates via JSON over stdin/stdout

Commands:
  {"cmd": "init", "userLanguage": "en"}  - Initialize and download models
  {"cmd": "detect", "text": "..."}       - Detect language
  {"cmd": "translate", "text": "...", "from": "es", "to": "en"} - Translate text
  {"cmd": "quit"}                        - Exit cleanly
"""

import sys
import json
import argostranslate.package
import argostranslate.translate
from langdetect import detect, detect_langs, LangDetectException

# Track installed language pairs
installed_pairs = set()

def send_response(data):
    """Send JSON response to stdout"""
    print(json.dumps(data), flush=True)

def send_error(message):
    """Send error response"""
    send_response({"error": message})

def send_progress(step, total, message):
    """Send progress update"""
    send_response({"progress": step, "total": total, "message": message})

def initialize(user_language="en"):
    """Download and install Spanish <-> English models"""
    global installed_pairs

    try:
        # Step 1: Update package index
        send_progress(1, 4, "Fetching package index...")
        argostranslate.package.update_package_index()
        available_packages = argostranslate.package.get_available_packages()

        # Step 2: Download Spanish -> English
        send_progress(2, 4, "Downloading Spanish → English...")
        es_en = next(
            (p for p in available_packages if p.from_code == "es" and p.to_code == "en"),
            None
        )
        if es_en:
            argostranslate.package.install_from_path(es_en.download())
            installed_pairs.add(("es", "en"))

        # Step 3: Download English -> Spanish
        send_progress(3, 4, "Downloading English → Spanish...")
        en_es = next(
            (p for p in available_packages if p.from_code == "en" and p.to_code == "es"),
            None
        )
        if en_es:
            argostranslate.package.install_from_path(en_es.download())
            installed_pairs.add(("en", "es"))

        # Step 4: Complete
        send_progress(4, 4, "Ready!")

        send_response({
            "success": True,
            "installed": list(installed_pairs)
        })
    except Exception as e:
        send_error(f"Failed to initialize: {str(e)}")

def detect_language(text):
    """Detect the language of text"""
    try:
        if len(text.strip()) < 3:
            send_response({"language": None, "confidence": 0})
            return

        detected = detect_langs(text)
        if detected:
            best = detected[0]
            send_response({
                "language": best.lang,
                "confidence": best.prob
            })
        else:
            send_response({"language": None, "confidence": 0})
    except LangDetectException:
        send_response({"language": None, "confidence": 0})
    except Exception as e:
        send_error(f"Detection failed: {str(e)}")

def translate_text(text, from_lang, to_lang):
    """Translate text from one language to another"""
    try:
        # Get installed languages
        installed_languages = argostranslate.translate.get_installed_languages()

        # Find source and target languages
        source_lang = next(
            (lang for lang in installed_languages if lang.code == from_lang),
            None
        )
        target_lang = next(
            (lang for lang in installed_languages if lang.code == to_lang),
            None
        )

        if not source_lang or not target_lang:
            send_error(f"Language pair {from_lang} -> {to_lang} not installed")
            return

        # Get translation
        translation = source_lang.get_translation(target_lang)
        if not translation:
            send_error(f"No translation available for {from_lang} -> {to_lang}")
            return

        result = translation.translate(text)
        send_response({
            "translatedText": result,
            "from": from_lang,
            "to": to_lang
        })
    except Exception as e:
        send_error(f"Translation failed: {str(e)}")

def main():
    """Main loop - read commands from stdin, write responses to stdout"""
    # Signal ready
    send_response({"status": "ready"})

    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue

        try:
            cmd = json.loads(line)
        except json.JSONDecodeError:
            send_error("Invalid JSON")
            continue

        command = cmd.get("cmd")

        if command == "init":
            initialize(cmd.get("userLanguage", "en"))
        elif command == "detect":
            detect_language(cmd.get("text", ""))
        elif command == "translate":
            translate_text(
                cmd.get("text", ""),
                cmd.get("from", ""),
                cmd.get("to", "")
            )
        elif command == "quit":
            send_response({"status": "goodbye"})
            break
        else:
            send_error(f"Unknown command: {command}")

if __name__ == "__main__":
    main()

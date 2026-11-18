# 🐉 PurpleWren: Privacy-First and Proton-Themed Browser, With all the Features of Chrome and the Privacy of Proton

A Proton-themed, privacy-first desktop browser built on Electron.
Open source, runs 100% locally, Startpage as the default search engine.

> **Unofficial fan project.** PurpleWren is not affiliated with, endorsed by,
> or connected to Proton AG. "Proton", "Lumo", "SimpleLogin" and related marks
> belong to Proton AG. Map data © OpenStreetMap contributors (ODbL).

## Features

- **Proton dark theme** (#6d4aff accent) with a purple-dragon brand icon
- **Startpage** default search (DuckDuckGo / Brave / Google selectable)
- **Tracker & ad blocker** (~90-domain list) + **strict mode** (blocks all
  third-party requests) with session/all-time **privacy statistics**
- **Anti-fingerprinting**: spoofed timezone, locale, platform, hardware,
  screen metrics, randomized canvas/audio noise, masked WebGL, geolocation
  denial, optional WebRTC disabling
- **Incognito tabs** (ephemeral, in-memory sessions) and **Tor tabs**
  (SOCKS5 via system Tor daemon on 127.0.0.1:9050, hardened UA)
- **Lumo sidebar** — persistent Proton Lumo session in a quarter-window dock
- **Proton hub dock** — Mail · Docs · Sheets · Drive · Meet with single
  sign-on (shared session partition), plus a dedicated Mail button
- **SimpleLogin alias generator** — create a forwarding alias per site
- **Proton VPN toolbar toggle** — drives the official Proton VPN CLI
- **WrenMaps** — OpenStreetMap maps with Nominatim search and an
  "Ask Lumo about this place" hook
- **Dashboard widgets** on the start page: privacy stats, weather
  (Open-Meteo, open data, no key), headlines (RSS)
- **Dock tools**: offline Calculator, offline File Converter
  (CSV↔JSON, JSON pretty/minify, Markdown→HTML, Base64, PNG↔JPEG)

## Requirements

- Node.js ≥ 18 and npm
- Optional: `tor` daemon (for Tor tabs), Proton VPN CLI (for the VPN toggle),
  SimpleLogin API key (for aliases)

## Run from source

```bash
npm install
npm start
```

## Build installers

```bash
# Linux (build on Linux):
npm run dist:linux      # → dist/PurpleWren-x.y.z.AppImage

# Windows (build on Windows):
npm run dist:win        # → dist/ NSIS installer + portable .exe
```

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl/Cmd+T | New tab |
| Ctrl/Cmd+Shift+T | New incognito tab |
| Ctrl/Cmd+W | Close tab |
| Ctrl/Cmd+L | Focus address bar |
| Ctrl/Cmd+D | Bookmark page |
| Ctrl/Cmd+H | History panel |
| Ctrl/Cmd+J | Lumo dock |
| Ctrl/Cmd+M | WrenMaps |
| Ctrl/Cmd+Shift+C | Calculator dock |
| Ctrl/Cmd+Shift+F | File-converter dock |
| Ctrl/Cmd+Shift+P | Proton hub dock |
| Ctrl/Cmd+, | Settings |
| Ctrl+Alt+Y | New Tor tab |

## Privacy notes

Anti-fingerprinting raises the cost of tracking substantially but no tool —
including Brave and Tor Browser — makes fingerprinting literally impossible.
Tor tabs require the Tor daemon to be running separately; PurpleWren does not
bundle it. The Proton VPN integration controls the official CLI (system-wide
tunnel); a browser tab cannot create a VPN tunnel itself.

## License

MIT — see [LICENSE](LICENSE).

-- LICENSE --
MIT License

Copyright (c) 2026 PurpleWren contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

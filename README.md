# Poly Score

Chrome extension that overlays **MLB score timelines** on [Polymarket](https://polymarket.com) sports charts for **completed games**.

## Features

- Score markers on price charts (hover for inning + score)
- Collapsible score timeline table below each chart
- Works on individual game pages and the MLB games list
- Only shows for **FINAL** games (no live-game overlays)
- Dark glass UI aligned with Polymarket

## Install (developer mode)

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder: `Poly Score Extension`

## Supported pages

- `https://polymarket.com/sports/mlb/mlb-*-*-*` (game pages)
- `https://polymarket.com/sports/mlb/games` (games list — open **Graph** on a FINAL game)

## Data source

Scores and play times come from the public [MLB Stats API](https://statsapi.mlb.com) (no API key required).

## Usage

1. Navigate to a completed MLB game on Polymarket
2. Expand **Moneyline**, **Spreads**, or **Totals** charts (game page)
3. Or open the **Graph** tab on a FINAL game card (list page)
4. Score markers and timeline appear automatically

## Project structure

```
manifest.json
src/
  teams.js         — team abbreviation mapping
  mlb-api.js       — MLB schedule + scoring events
  chart-detector.js — chart & page detection
  overlay.js       — UI overlay
  content.js       — main entry
  styles.css       — modern dark theme
icons/
```

## Roadmap

- [ ] NBA, NFL, and other sports
- [ ] Popup settings (toggle markers/table)

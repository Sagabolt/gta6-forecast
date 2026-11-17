# GTA VI Twitch CCU forecast

[![gta6-twitch-ccu-forecast-01](https://make.fun/badge/gta6-twitch-ccu-forecast-01.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![rank](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Sagabolt/gta6-forecast/rank.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)
[![reward](https://make.fun/badge/gta6-twitch-ccu-forecast-01/Sagabolt/gta6-forecast/reward.svg)](https://make.fun/bounty/gta6-twitch-ccu-forecast-01)

Entry for [gta6-twitch-ccu-forecast-01](https://make.fun/bounty/gta6-twitch-ccu-forecast-01): forecast how many people watch Grand Theft Auto VI live on Twitch in each hour of its release day (2026-11-19 UTC), as five quantiles per hour, from the first hour's viewer count.

## The model

For each hour h = 2..24, the forecast takes the median log-ratio ln(y_h / y_1) over past big launches whose release-day hour-1 audience was within a factor 4 of this case's hour-1 print, and spreads the five quantiles around that median with the cross-launch standard deviation of the same log-ratios (spread = max(0.15, 0.9 * sd)). The launch-day audience curve therefore dips early and ramps later the way past launches actually did, instead of assuming every hour stays at hour 1 like the house baseline, and the spread is honest about how much launches disagree with each other. The target's own pre-release category history is excluded from the pool — it is not a launch curve. If no comparable reports a given hour, that hour falls back to the house baseline spread.

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=<kit>/input MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` is Node 22, standard library only. It reads every `*.in` case in `MAKEFUN_INPUT_DIR` (else `/input`) and writes `<id>.out` to `MAKEFUN_OUTPUT_DIR` (else `/output`), one JSON line of `{"hours": [{"hour": h, "q": [q05, q25, q50, q75, q95]}, ...]}` for hours 2..24. Deterministic: same input bytes give the same output bytes.

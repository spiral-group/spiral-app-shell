#!/usr/bin/env bash
# The layout lab's verdicts, grouped per module and box, from the app log.
#   scripts/lab-report.sh [udid] [lines]
D=${1:-35046324-CEC2-4EBA-B2BF-56D0938CE31D}
L=$(ls -t ~/Library/Developer/CoreSimulator/Devices/$D/data/Containers/Shared/AppGroup/*/Library/Logs/com.veruslogistics.messenger/console.*.log | head -1)
rg -n "\[SpiralApp/lab\] module|\[spiral-app\] (lab page|layout)" -A 8 "$L" \
  | rg "\[SpiralApp/lab\] module|lab page|layout (row|expanded)|\[(overflow|clipped|tiny-text|small-hit|ragged-grid|not-square|corner|contrast|frame|collapsed|overlap)\]" \
  | sed 's/.*\[SpiralApp\/lab\] /## /; s/.*\[spiral-app\] //; s/ | SpiralAppWebViewHost.*//; s/ | SpiralAppLayoutLabScreen.*//; s/^[0-9]*-  /  /' \
  | tail -${2:-200}

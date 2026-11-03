#!/bin/zsh
# Usage: measure.sh <label> <command...>
# Starts the shell, times it to a usable overview, waits 10 s idle, then sums
# memory over the shell's process tree plus any WebKit helpers it started.
set -u
label=$1; shift
usable=$(mktemp -u /tmp/oriel-usable.XXXX)
before=$(pgrep -f 'com.apple.WebKit' | sort)
start=$(python3 -c 'import time;print(time.time())')
ORIEL_USABLE=$usable "$@" >/tmp/oriel-$label.log 2>&1 &
pid=$!
until [[ -s $usable ]]; do sleep 0.005; done
end=$(cat $usable)
sleep 10
tree() { local p=$1; echo $p; for c in $(pgrep -P $p); do tree $c; done; }
pids=($(tree $pid) $(comm -13 <(echo "$before") <(pgrep -f 'com.apple.WebKit' | sort)))
rss=0; fp=0
for p in $pids; do
  r=$(ps -o rss= -p $p | tr -d ' '); rss=$((rss + ${r:-0}))
  f=$(footprint -p $p 2>/dev/null | awk '/phys_footprint:/ {v=$2; if ($3=="MB") v*=1024; if ($3=="GB") v*=1048576; print int(v); exit}'); fp=$((fp + ${f:-0}))
  name=$(ps -o comm= -p $p)
  echo "  $p ${name:t} rss=${r}K footprint=${f}K"
done
python3 -c "print('$label usable_ms', round(($end-$start)*1000), 'rss_mb', round($rss/1024), 'footprint_mb', round($fp/1024))"
kill -TERM $pid; wait $pid 2>/dev/null
rm -f $usable

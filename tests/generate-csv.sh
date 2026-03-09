#!/bin/bash
# Generate CSV test data for Pinot stress testing
# Usage: ./generate-csv.sh <num_rows> <output_file>

NUM_ROWS=${1:-10000}
OUTPUT_FILE=${2:-/tmp/stress_test_10k.csv}

echo "Generating $NUM_ROWS rows to $OUTPUT_FILE..."

# Header
echo "eventId,userId,eventType,value,timestamp" > "$OUTPUT_FILE"

EVENT_TYPES=("click" "view" "purchase" "search" "login" "logout" "signup" "update" "delete" "share")
BASE_TS=1709913600000  # 2024-03-08 in millis

# Use awk for fast generation
awk -v rows="$NUM_ROWS" -v base_ts="$BASE_TS" 'BEGIN {
  srand(42);
  split("click,view,purchase,search,login,logout,signup,update,delete,share", types, ",");
  for (i = 1; i <= rows; i++) {
    uid = sprintf("user_%05d", int(rand() * 10000));
    etype = types[int(rand() * 10) + 1];
    val = rand() * 1000;
    ts = base_ts + int(rand() * 86400000 * 30);
    printf "evt_%09d,%s,%s,%.2f,%d\n", i, uid, etype, val, ts;
  }
}' >> "$OUTPUT_FILE"

echo "Done. File size: $(wc -c < "$OUTPUT_FILE") bytes, $(wc -l < "$OUTPUT_FILE") lines"

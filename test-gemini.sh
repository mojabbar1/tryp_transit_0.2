#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

# Get the API key from .env file
if [ -f "$SCRIPT_DIR/src/.env" ]; then
  GEMINI_API_KEY=$(grep GEMINI_API_KEY "$SCRIPT_DIR/src/.env" | cut -d '=' -f2 | tr -d '"')
  echo "Found Gemini API key in $SCRIPT_DIR/src/.env"
else
  echo "$SCRIPT_DIR/src/.env file not found. Please provide API key as argument."
  exit 1
fi

# Remove quotes if present
GEMINI_API_KEY=$(echo $GEMINI_API_KEY | tr -d '"' | tr -d "'")

echo "Testing Gemini API with key: ${GEMINI_API_KEY:0:5}..."

# Run the test script
node "$SCRIPT_DIR/test-gemini.js" "$GEMINI_API_KEY"
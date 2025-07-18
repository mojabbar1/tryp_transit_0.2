#!/bin/bash

# Get the directory of the script
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"

echo "Installing dependencies for Gemini test script..."
cd "$SCRIPT_DIR"
npm install --no-save @google/generative-ai

echo "Dependencies installed. You can now run ./test-gemini.sh"
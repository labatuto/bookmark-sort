#!/bin/bash

# Start Bookmark Sort with ngrok tunnel for mobile access
# Usage: ./start-mobile.sh

set -e

echo "Building frontend..."
npm run build

echo ""
echo "Starting server in background..."
npm run start &
SERVER_PID=$!

# Wait for server to start
sleep 2

echo ""
echo "Starting ngrok tunnel..."
echo "================================================"
echo "Your mobile URL will appear below."
echo "Open this URL on your phone to access the app."
echo "================================================"
echo ""

# Start ngrok and keep it in foreground
ngrok http 3001

# Cleanup on exit
kill $SERVER_PID 2>/dev/null

#!/bin/sh
# Builds standalone executables that embed the whole game.
set -e
cd "$(dirname "$0")"
mkdir -p dist
GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "dist/RoadToBerlin44.exe" launcher.go
GOOS=darwin  GOARCH=arm64 go build -trimpath -ldflags "-s -w" -o "dist/RoadToBerlin44-mac" launcher.go
GOOS=linux   GOARCH=amd64 go build -trimpath -ldflags "-s -w" -o "dist/RoadToBerlin44-linux" launcher.go
ls -lh dist

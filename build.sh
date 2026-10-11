#!/bin/sh
set -eu
cd "$(dirname "$0")"
CGO_ENABLED=0 GOOS=darwin GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o 定点-Apple芯片 .
CGO_ENABLED=0 GOOS=darwin GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o 定点-Intel芯片 .
chmod +x 启动定点.command 定点-Apple芯片 定点-Intel芯片 platform-tools/adb
printf '%s\n' 'Mac 两个版本已构建。双击「启动定点.command」开始使用。'

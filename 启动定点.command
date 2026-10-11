#!/bin/zsh
cd "${0:A:h}" || exit 1
if [[ "$(uname -m)" == "arm64" ]]; then
  launcher="./定点-Apple芯片"
else
  launcher="./定点-Intel芯片"
fi
if [[ ! -x "$launcher" ]]; then
  print "启动程序不存在，请重新解压完整文件夹。"
  read "?按回车关闭…"
  exit 1
fi
"$launcher"
result=$?
if [[ $result -ne 0 ]]; then
  print "启动失败。请检查上面的提示。"
  read "?按回车关闭…"
fi
exit $result

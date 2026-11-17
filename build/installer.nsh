!macro customInstall
  ; Windows 安装目录若继承 AppContainer ACL，Chromium 沙箱可能无法读取。
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant *S-1-15-2-1:(OI)(CI)(RX) /T /C'
  nsExec::ExecToLog 'icacls "$INSTDIR" /grant *S-1-15-2-2:(OI)(CI)(RX) /T /C'
!macroend

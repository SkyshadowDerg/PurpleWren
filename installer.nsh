; Clean up protocol registration on uninstall
!macro customUnInstall
  DeleteRegKey HKCU "Software\Classes\PurpleWren"
!macroend
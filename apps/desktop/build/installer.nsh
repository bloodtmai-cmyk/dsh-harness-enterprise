!ifndef BUILD_UNINSTALLER
  # The nsisunz plug-in used by electron-builder's useZip mode can reject the
  # embedded payload on Windows. Ask the stock installApplicationFiles macro to
  # use NSIS's built-in File extraction instead: it writes directly to INSTDIR
  # without the ZIP plug-in or the default 7z staging/copy pass.
  !ifndef APP_BUILD_DIR
    !define APP_BUILD_DIR "${PROJECT_DIR}/../../.artifacts/desktop/win-unpacked"
  !endif
!endif

!macro repairInterruptedInstaller
  # Only these two release candidates could register a truncated uninstaller.
  # Keep every normal release on electron-builder's standard uninstall path.
  ReadRegStr $R9 HKCU "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
  ${If} $R9 == "0.1.0-rc.5"
  ${OrIf} $R9 == "0.1.0-rc.6"
    DeleteRegValue HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  ${EndIf}
!macroend

!macro preInit
  !ifndef BUILD_UNINSTALLER
    # rc.5/rc.6 could leave a registered but truncated uninstaller when their
    # two-stage install was interrupted. Preserve the recorded install path,
    # but skip that damaged binary so this installer can repair in place and
    # write a fresh uninstall entry. preInit runs before electron-builder sets
    # the registry view, so inspect both views and leave x64 installers on 64.
    ${If} ${RunningX64}
      SetRegView 64
      !insertmacro repairInterruptedInstaller
    ${EndIf}
    SetRegView 32
    !insertmacro repairInterruptedInstaller
    ${If} ${RunningX64}
      SetRegView 64
    ${EndIf}
  !endif
!macroend

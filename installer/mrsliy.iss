; Inno Setup 7 打包脚本 · MR·SLIY 代码优化智能体桌面端
; 编译: "C:\Program Files\Inno Setup 7\ISCC.exe" d:\Final\final\installer\mrsliy.iss

#define MyAppName "MR·SLIY 代码优化智能体"
#define MyAppExeName "mrsliy-desktop.exe"
#define MyAppVersion "0.0.2"
#define ProjRoot "d:\Final\final"

[Setup]
AppId={{7D9E4F21-6C3A-4B8E-9A12-3F5D8B0C2E47}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher=MR·SLIY
DefaultDirName={autopf}\MRSLIY
DefaultGroupName=MR·SLIY
UninstallDisplayName={#MyAppName}
UninstallDisplayIcon={app}\{#MyAppExeName}
OutputDir={#ProjRoot}\installer
OutputBaseFilename=MRSLIY-Setup-{#MyAppVersion}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
SetupIconFile={#ProjRoot}\src-tauri\icons\icon.ico

[Languages]
Name: "chinesesimplified"; MessagesFile: "compiler:Languages\ChineseSimplified.isl"

[Tasks]
Name: "desktopicon"; Description: "创建桌面快捷方式"; GroupDescription: "附加任务:"

[Files]
; 主程序（release 构建产物，前端资源已嵌入）
Source: "{#ProjRoot}\src-tauri\target\release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; 内置 Node 运行时（安装版不依赖系统 node）
Source: "{#ProjRoot}\installer\staging\node.exe"; DestDir: "{app}\runtime"; Flags: ignoreversion
; sidecar 与 Node 后端
Source: "{#ProjRoot}\sidecar.js"; DestDir: "{app}"; Flags: ignoreversion
; MCP 服务器独立入口（stdio 模式，供 Claude Desktop / Cursor 等客户端接入）
Source: "{#ProjRoot}\mcp-server.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjRoot}\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#ProjRoot}\.env.example"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#ProjRoot}\README.md"; DestDir: "{app}"; Flags: ignoreversion skipifsourcedoesntexist
Source: "{#ProjRoot}\src\*"; DestDir: "{app}\src"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#ProjRoot}\database\*"; DestDir: "{app}\database"; Flags: ignoreversion recursesubdirs createallsubdirs skipifsourcedoesntexist; Excludes: "*.db,*.db-shm,*.db-wal"
Source: "{#ProjRoot}\scripts\*"; DestDir: "{app}\scripts"; Flags: ignoreversion recursesubdirs createallsubdirs
; 生产依赖（含 tree-sitter wasm 与原生模块，与内置 node ABI 匹配）
Source: "{#ProjRoot}\node_modules\*"; DestDir: "{app}\node_modules"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "立即运行 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "taskkill"; Parameters: "/f /im {#MyAppExeName}"; RunOnceId: "KillApp"; Flags: runhidden

[Code]
// 安装/卸载前结束主程序；sidecar 携带父进程 watchdog，主程序退出后 3 秒内自动退出
procedure Sleep(ms: Integer); external 'Sleep@kernel32.dll stdcall';

procedure KillRunningApp();
var
  ResultCode: Integer;
begin
  Exec('taskkill', '/f /im {#MyAppExeName}', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  // 等待 sidecar watchdog 退出，避免覆盖 runtime\node.exe 时撞文件锁
  Sleep(3500);
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssInstall then
    KillRunningApp();
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
    KillRunningApp();
end;

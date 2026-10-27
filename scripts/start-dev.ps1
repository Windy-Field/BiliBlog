# 登录 Windows 后启动本地开发服务，端口已占用时直接结束
$projectDirectory = Split-Path -Parent $PSScriptRoot
$vitePath = Join-Path $projectDirectory 'node_modules\vite\bin\vite.js'
$nodePath = 'D:\node\node.exe'

if (-not (Test-Path -LiteralPath $nodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        exit 1
    }
    $nodePath = $nodeCommand.Source
}

if (-not (Test-Path -LiteralPath $vitePath)) {
    exit 1
}

# 先检查端口，避免登录或手动重复运行时启动第二个服务
$connection = New-Object System.Net.Sockets.TcpClient
$portOccupied = $false
try {
    $connection.Connect('127.0.0.1', 5173)
    $portOccupied = $true
} catch {
    $portOccupied = $false
} finally {
    $connection.Dispose()
}

if ($portOccupied) {
    exit 0
}

$logDirectory = Join-Path $env:LOCALAPPDATA 'biliblog'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$outputLog = Join-Path $logDirectory 'dev-server.log'
$errorLog = Join-Path $logDirectory 'dev-server-error.log'
$quotedVitePath = '"' + $vitePath + '"'
$serverArguments = @($quotedVitePath, '--host', '127.0.0.1', '--port', '5173', '--strictPort')

# 后台启动并记录输出，不弹终端窗口；严格固定端口，不自动改用其他端口
Start-Process -FilePath $nodePath -ArgumentList $serverArguments -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog

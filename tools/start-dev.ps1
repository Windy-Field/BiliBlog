# 启动本地服务，传入 OpenBrowser 时在服务就绪后打开首页
param(
    [switch]$OpenBrowser
)

$serverPort = 5173
$preferredNodePath = 'D:\node\node.exe'
$maxReadyAttempts = 20
$readyTimeoutSeconds = 2
$readyPollMilliseconds = 250
$homeUrl = "http://127.0.0.1:$serverPort/index.html"
$projectDirectory = Split-Path -Parent $PSScriptRoot
$vitePath = Join-Path $projectDirectory 'node_modules\vite\bin\vite.js'
$nodePath = $preferredNodePath

if (-not (Test-Path -LiteralPath $nodePath)) {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($null -eq $nodeCommand) {
        Write-Host '找不到 Node.js，请安装 Node.js 后重试'
        exit 1
    }
    $nodePath = $nodeCommand.Source
}

if (-not (Test-Path -LiteralPath $vitePath)) {
    Write-Host '找不到 Vite，请先在项目目录运行 npm install'
    exit 1
}

# 先检查端口，避免登录或手动重复运行时启动第二个服务
$connection = New-Object System.Net.Sockets.TcpClient
$portOccupied = $false
try {
    $connection.Connect('127.0.0.1', $serverPort)
    $portOccupied = $true
} catch {
    $portOccupied = $false
} finally {
    $connection.Dispose()
}

if (-not $portOccupied) {
    $logDirectory = Join-Path $env:LOCALAPPDATA 'biliblog'
    $outputLog = Join-Path $logDirectory 'dev-server.log'
    $errorLog = Join-Path $logDirectory 'dev-server-error.log'
    $quotedVitePath = '"' + $vitePath + '"'
    $serverArguments = @($quotedVitePath, '--host', '127.0.0.1', '--port', [string]$serverPort, '--strictPort')

    # 复用开机启动方式，在后台运行并记录日志
    try {
        New-Item -ItemType Directory -Path $logDirectory -Force -ErrorAction Stop | Out-Null
        Start-Process -FilePath $nodePath -ArgumentList $serverArguments -WorkingDirectory $projectDirectory -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -ErrorAction Stop
    } catch {
        Write-Host '启动失败，请检查 Node.js 和本机日志目录'
        Write-Host $_.Exception.Message
        exit 1
    }
}

# 确认端口提供的是小B书首页，避免误打开占用相同端口的其他项目
$ready = $false
for ($attempt = 0; $attempt -lt $maxReadyAttempts; $attempt = $attempt + 1) {
    try {
        $response = Invoke-WebRequest -Uri $homeUrl -UseBasicParsing -TimeoutSec $readyTimeoutSeconds -ErrorAction Stop
        # Vite 的 HTML 使用 UTF-8，旧版 PowerShell 不一定能自动识别编码
        $responseBytes = $response.RawContentStream.ToArray()
        $responseText = [System.Text.Encoding]::UTF8.GetString($responseBytes)
        if ($response.StatusCode -eq 200 -and $responseText -match '<title>首页 - 小B书</title>') {
            $ready = $true
            break
        }
        Write-Host '5173 端口已被其他页面占用，请先关闭对应服务'
        exit 1
    } catch {
        Start-Sleep -Milliseconds $readyPollMilliseconds
    }
}

if (-not $ready) {
    Write-Host '首页暂时无法打开，请查看 %LOCALAPPDATA%\biliblog 中的启动日志'
    exit 1
}

if ($OpenBrowser) {
    try {
        Start-Process -FilePath $homeUrl -ErrorAction Stop
    } catch {
        Write-Host "服务已经启动，请在浏览器打开 $homeUrl"
        exit 1
    }
}

exit 0

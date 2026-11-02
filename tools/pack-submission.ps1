# 检查当前项目并生成源码提交包；成功时返回 0，失败时返回 1。
$ErrorActionPreference = 'Stop'

# 提交目录、包内根目录和选取范围集中放在这里，方便以后调整。
$outputFolder = 'submissions'
$archiveRoot = 'BiliBlog'
$sourceFolders = @('scripts', 'styles', 'tools', 'assets', 'screenshots', 'docs', 'public')
$requiredFolders = @('scripts', 'styles', 'tools', 'assets', 'screenshots')
$requiredFiles = @(
    'README.md', 'project-structure.md', 'package.json', 'package-lock.json',
    'vite.config.js', '.env.example', '.gitignore', 'LICENSE',
    'openapi.json', 'index.html', 'login.html', 'register.html', 'publish.html',
    'drafts.html', 'profile.html', 'settings.html'
)
$excludedFolders = @('node_modules', 'dist', '.git', '.claude', '.codex', '.vscode', 'coverage', 'submissions')
$excludedExtensions = @('.zip', '.7z', '.rar', '.log', '.tmp', '.bak', '.pem', '.key', '.pfx', '.p12', '.cmd', '.bat', '.ps1')
$excludedNames = @('Thumbs.db', '.DS_Store')
$projectDirectory = Split-Path -Parent $PSScriptRoot

# 检查路径是否为符号链接或目录联接，防止打包时读到项目外的文件。
function Assert-RegularPath {
    param([string]$Path)

    $item = Get-Item -LiteralPath $Path -Force
    $linkFlag = $item.Attributes -band [System.IO.FileAttributes]::ReparsePoint
    if ($linkFlag -ne 0) {
        throw "不能打包链接路径，请先确认它的实际内容：$Path"
    }
}

# 检查给定文件名是否应被排除，返回 true 表示允许打包。
function Test-SubmissionFile {
    param([string]$Name)

    if ($excludedNames -contains $Name) {
        return $false
    }
    if ($Name -like '.env*' -and $Name -ne '.env.example') {
        return $false
    }
    $extension = [System.IO.Path]::GetExtension($Name)
    if ($excludedExtensions -contains $extension) {
        return $false
    }
    return $true
}

# 递归选取目录中的文件，把相对路径加入 Files；忽略依赖和本机配置。
function Add-SubmissionFolder {
    param([string]$RelativeFolder, [System.Collections.Generic.List[string]]$Files)

    $absoluteFolder = Join-Path $projectDirectory $RelativeFolder
    Assert-RegularPath $absoluteFolder
    $entries = Get-ChildItem -LiteralPath $absoluteFolder -Force
    foreach ($entry in $entries) {
        $relativePath = Join-Path $RelativeFolder $entry.Name
        if ($entry.PSIsContainer) {
            if ($excludedFolders -notcontains $entry.Name) {
                Add-SubmissionFolder $relativePath $Files
            }
        } elseif (Test-SubmissionFile $entry.Name) {
            Assert-RegularPath $entry.FullName
            $Files.Add($relativePath)
        }
    }
}

# 执行 npm 的一个命令，退出码不是 0 时立即停止打包。
function Invoke-NpmStep {
    param([string]$Step)

    if ($Step -eq 'ci') {
        & $npmPath ci
    } else {
        & $npmPath run $Step
    }
    if ($LASTEXITCODE -ne 0) {
        throw "npm $Step 未通过，已停止打包。"
    }
}

# 对输入流计算 SHA-256，返回十六进制摘要，供压缩前后逐个文件核对。
function Get-StreamDigest {
    param([System.IO.Stream]$Stream)

    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        $digest = $algorithm.ComputeHash($Stream)
        return [System.BitConverter]::ToString($digest)
    } finally {
        $algorithm.Dispose()
    }
}

# 读取待打包文件的字节；仅在包内移除依赖 Windows 脚本的打包命令，本地文件保持原样。
function Get-SubmissionBytes {
    param([string]$RelativePath)

    $sourcePath = Join-Path $projectDirectory $RelativePath
    if ($RelativePath -eq 'package.json') {
        $sourceText = [System.IO.File]::ReadAllText($sourcePath)
        $package = ConvertFrom-Json -InputObject $sourceText
        $package.scripts.PSObject.Properties.Remove('package')
        $packageText = ConvertTo-Json -InputObject $package -Depth 10
        $encoding = New-Object System.Text.UTF8Encoding($false)
        return ,($encoding.GetBytes($packageText))
    }
    return ,([System.IO.File]::ReadAllBytes($sourcePath))
}

# 把选取的文件直接写入 ZIP，保留相对目录；文件名使用通用的正斜杠。
function Write-SubmissionArchive {
    param([string]$ArchivePath, [System.Collections.Generic.List[string]]$Files)

    $archive = [System.IO.Compression.ZipFile]::Open($ArchivePath, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($relativePath in $Files) {
            $portablePath = $relativePath.Replace('\', '/')
            $entryName = $archiveRoot + '/' + $portablePath
            $bytes = Get-SubmissionBytes $relativePath
            $entry = $archive.CreateEntry($entryName)
            $entryStream = $entry.Open()
            try {
                $entryStream.Write($bytes, 0, $bytes.Length)
            } finally {
                $entryStream.Dispose()
            }
        }
    } finally {
        $archive.Dispose()
    }
}

# 解压读取每个 ZIP 条目并对照提交内容，确认路径、数量和文件内容都正确。
function Test-SubmissionArchive {
    param([string]$ArchivePath, [System.Collections.Generic.List[string]]$Files)

    $archive = [System.IO.Compression.ZipFile]::OpenRead($ArchivePath)
    try {
        if ($archive.Entries.Count -ne $Files.Count) {
            throw '压缩包文件数量与选取清单不一致。'
        }
        foreach ($relativePath in $Files) {
            $portablePath = $relativePath.Replace('\', '/')
            $entryName = $archiveRoot + '/' + $portablePath
            $entry = $archive.GetEntry($entryName)
            if ($null -eq $entry) {
                throw "压缩包缺少文件：$entryName"
            }
            $bytes = Get-SubmissionBytes $relativePath
            $fileStream = New-Object System.IO.MemoryStream
            try {
                $fileStream.Write($bytes, 0, $bytes.Length)
                $fileStream.Position = 0
                $fileDigest = Get-StreamDigest $fileStream
            } finally {
                $fileStream.Dispose()
            }
            $entryStream = $entry.Open()
            try {
                $entryDigest = Get-StreamDigest $entryStream
            } finally {
                $entryStream.Dispose()
            }
            if ($fileDigest -ne $entryDigest) {
                throw "压缩包内文件内容不一致：$entryName"
            }
        }
    } finally {
        $archive.Dispose()
    }
}

$pendingArchive = $null
$exitCode = 0
Push-Location -LiteralPath $projectDirectory
try {
    Write-Host '正在检查提交所需的文件……'
    foreach ($file in $requiredFiles) {
        $absolutePath = Join-Path $projectDirectory $file
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Leaf)) {
            throw "缺少提交所需文件：$file"
        }
        Assert-RegularPath $absolutePath
    }
    foreach ($folder in $requiredFolders) {
        $absolutePath = Join-Path $projectDirectory $folder
        if (-not (Test-Path -LiteralPath $absolutePath -PathType Container)) {
            throw "缺少提交所需目录：$folder"
        }
    }

    $npmCommand = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($null -eq $npmCommand) {
        throw '找不到 npm，请先安装 Node.js 并重新运行。'
    }
    $npmPath = $npmCommand.Source
    $vitePath = Join-Path $projectDirectory 'node_modules\vite\bin\vite.js'
    if (-not (Test-Path -LiteralPath $vitePath -PathType Leaf)) {
        Write-Host '首次运行，正在按锁文件安装依赖……'
        Invoke-NpmStep 'ci'
    }
    Invoke-NpmStep 'check'
    Invoke-NpmStep 'build'

    # 只从指定文件和源码目录取内容，输出目录和根目录的旧 ZIP 不会进入包内。
    $files = New-Object 'System.Collections.Generic.List[string]'
    foreach ($file in $requiredFiles) {
        $files.Add($file)
    }
    $rootDocuments = Get-ChildItem -LiteralPath $projectDirectory -Filter '*.md' -File
    foreach ($document in $rootDocuments) {
        if (-not $files.Contains($document.Name)) {
            Assert-RegularPath $document.FullName
            $files.Add($document.Name)
        }
    }
    foreach ($folder in $sourceFolders) {
        $absolutePath = Join-Path $projectDirectory $folder
        if (Test-Path -LiteralPath $absolutePath -PathType Container) {
            Add-SubmissionFolder $folder $files
        }
    }

    $outputDirectory = Join-Path $projectDirectory $outputFolder
    New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
    Assert-RegularPath $outputDirectory
    $identifier = [System.Guid]::NewGuid()
    $runName = $identifier.ToString('N')
    $timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $archiveName = $archiveRoot + '-' + $timestamp + '-' + $runName.Substring(0, 8) + '.zip'
    $archivePath = Join-Path $outputDirectory $archiveName
    $pendingArchive = Join-Path $outputDirectory ('.pending-' + $runName + '.zip')

    # 先写临时 ZIP，核对成功后才用正式名称显示，避免把失败产物误当成提交包。
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    Write-SubmissionArchive $pendingArchive $files
    Test-SubmissionArchive $pendingArchive $files
    Move-Item -LiteralPath $pendingArchive -Destination $archivePath
    $archiveFile = Get-Item -LiteralPath $archivePath
    $sizeMegabytes = [Math]::Round($archiveFile.Length / 1MB, 2)
    Write-Host ''
    Write-Host "打包完成，共 $($files.Count) 个文件，$sizeMegabytes MB"
    Write-Host "可提交的压缩包：$archivePath"
} catch {
    Write-Host ('打包失败：' + $_.Exception.Message) -ForegroundColor Red
    $exitCode = 1
} finally {
    if ($null -ne $pendingArchive -and (Test-Path -LiteralPath $pendingArchive)) {
        Remove-Item -LiteralPath $pendingArchive -Force
    }
    Pop-Location
}
exit $exitCode
